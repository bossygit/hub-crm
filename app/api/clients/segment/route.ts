import { NextRequest, NextResponse } from 'next/server'
import { authorizeManager } from '@/lib/auth/serverGuard'
import { computeClientSegmentation, segmentBreakdown, SEGMENT_META } from '@/lib/clients/segmentation'

// Recalcule la segmentation de tous les clients (RFM : récence, fréquence,
// montant) et met à jour les colonnes `segment`, `segment_score`,
// `orders_count`, `lifetime_value`, `last_order_at`.
//
// POST { dryRun?: boolean }

export async function POST(req: NextRequest) {
  try {
    const auth = await authorizeManager(req)
    if ('error' in auth) return auth.error
    const { client } = auth

    let body: { dryRun?: boolean } = {}
    try { body = await req.json() } catch { /* corps vide accepté */ }
    const dryRun = !!body.dryRun

    const [clientsRes, invoicesRes, paymentsRes] = await Promise.all([
      client.from('clients').select('id, name, created_at'),
      client.from('invoices').select('id, client_id, date, status, total'),
      client.from('invoice_payments').select('invoice_id, amount'),
    ])

    const firstError = clientsRes.error || invoicesRes.error || paymentsRes.error
    if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

    const rows = computeClientSegmentation(
      (clientsRes.data || []) as { id: string; created_at?: string | null }[],
      (invoicesRes.data || []) as { id: string; client_id?: string | null; date: string; status: string; total: number }[],
      (paymentsRes.data || []) as { invoice_id: string; amount: number }[],
    )

    const breakdown = segmentBreakdown(rows).map(b => ({
      segment: b.segment,
      label: SEGMENT_META[b.segment].label,
      count: b.count,
      revenue: b.revenue,
    }))

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        clients: rows.length,
        segmented: rows.filter(r => r.segment !== 'prospect' || r.ordersCount > 0).length,
        breakdown,
      })
    }

    const updatedAt = new Date().toISOString()
    let updated = 0
    let failed = 0

    for (const row of rows) {
      const { error } = await client
        .from('clients')
        .update({
          segment: row.segment,
          segment_score: row.score,
          orders_count: row.ordersCount,
          lifetime_value: row.lifetimeValue,
          last_order_at: row.lastOrderAt,
          segment_updated_at: updatedAt,
        })
        .eq('id', row.clientId)

      if (error) failed++
      else updated++
    }

    return NextResponse.json({ ok: true, updated, failed, clients: rows.length, breakdown })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erreur serveur' }, { status: 500 })
  }
}
