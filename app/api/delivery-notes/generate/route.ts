import { NextRequest, NextResponse } from 'next/server'
import { authorizeManager } from '@/lib/auth/serverGuard'

// Génération en masse des bons de livraison manquants.
//
// Cible : les factures VALIDÉES (approved / partial / paid) qui n'ont encore
// aucun BL actif (draft / pending / approved). Chaque BL est créé en
// brouillon, avec les lignes copiées de la facture, et reste rattaché à elle
// via documents.invoice_id. Les livraisons partielles restent gérées par la
// page « Nouveau BL » (qui plafonne au restant) — ici on ne crée un BL que
// lorsqu'il n'en existe aucun.
//
// POST { dryRun?: boolean, invoice_ids?: string[] }

const VALIDATED_INVOICE_STATUSES = ['approved', 'partial', 'paid']
const ACTIVE_BL_STATUSES = ['draft', 'pending', 'approved']
const BL_TYPES = ['bon_livraison', 'bon_de_livraison']

type InvoiceItemRow = {
  invoice_id: string
  product_id: string | null
  batch_id: string | null
  name: string
  description: string | null
  quantity: number
  unit: string
  unit_price: number
  subtotal: number | null
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authorizeManager(req)
    if ('error' in auth) return auth.error
    const { client, userId } = auth

    let body: { dryRun?: boolean; invoice_ids?: string[] } = {}
    try { body = await req.json() } catch { /* corps vide accepté */ }

    const dryRun = !!body.dryRun
    const invoiceIds = Array.isArray(body.invoice_ids) && body.invoice_ids.length ? body.invoice_ids : undefined

    let query = client
      .from('invoices')
      .select('id, invoice_number, client_id, status')
      .in('status', VALIDATED_INVOICE_STATUSES)
    if (invoiceIds) query = query.in('id', invoiceIds)

    const { data: invoices, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!invoices || invoices.length === 0) {
      return NextResponse.json({ ok: true, dryRun, candidates: 0, created: 0, skipped: 0, failed: 0 })
    }

    const ids = invoices.map(i => i.id)
    const { data: existingBls } = await client
      .from('documents')
      .select('invoice_id, status')
      .in('type', BL_TYPES)
      .in('invoice_id', ids)
      .in('status', ACTIVE_BL_STATUSES)

    const covered = new Set((existingBls || []).map((b: { invoice_id?: string | null }) => b.invoice_id).filter(Boolean) as string[])
    const missing = invoices.filter(i => !covered.has(i.id))

    if (missing.length === 0) {
      return NextResponse.json({ ok: true, dryRun, candidates: 0, created: 0, skipped: invoices.length, failed: 0 })
    }

    const missingIds = missing.map(i => i.id)
    const { data: items, error: itemsError } = await client
      .from('invoice_items')
      .select('invoice_id, product_id, batch_id, name, description, quantity, unit, unit_price, subtotal, sort_order')
      .in('invoice_id', missingIds)

    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

    const itemsByInvoice = new Map<string, InvoiceItemRow[]>()
    for (const item of (items || []) as InvoiceItemRow[]) {
      const list = itemsByInvoice.get(item.invoice_id)
      if (list) list.push(item)
      else itemsByInvoice.set(item.invoice_id, [item])
    }

    const ready = missing.filter(i => (itemsByInvoice.get(i.id) || []).length > 0)
    const skipped = invoices.length - ready.length

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, candidates: ready.length, created: 0, skipped, failed: 0 })
    }

    let created = 0
    let failed = 0

    for (const invoice of ready) {
      const { data: number } = await client.rpc('generate_document_number', { p_type: 'bon_livraison' })
      const { data: doc, error: docError } = await client
        .from('documents')
        .insert({
          document_number: number,
          title: `BL — ${invoice.invoice_number}`,
          type: 'bon_livraison',
          status: 'draft',
          client_id: invoice.client_id,
          invoice_id: invoice.id,
          content: { notes: 'Généré automatiquement à partir de la facture (phase 2).' },
          created_by: userId,
        })
        .select('id')
        .single()

      if (docError || !doc) { failed++; continue }

      const rows = (itemsByInvoice.get(invoice.id) || []).map((it, idx) => ({
        document_id: doc.id,
        product_id: it.product_id,
        batch_id: it.batch_id,
        name: it.name,
        description: it.description,
        quantity: it.quantity,
        unit: it.unit,
        unit_price: it.unit_price,
        subtotal: it.subtotal,
        sort_order: idx,
      }))

      const { error: linesError } = await client.from('document_items').insert(rows)
      if (linesError) {
        // Évite un document orphelin sans lignes.
        await client.from('documents').delete().eq('id', doc.id)
        failed++
        continue
      }
      created++
    }

    return NextResponse.json({ ok: true, dryRun: false, candidates: ready.length, created, skipped, failed })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erreur serveur' }, { status: 500 })
  }
}
