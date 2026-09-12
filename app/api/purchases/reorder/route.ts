import { NextRequest, NextResponse } from 'next/server'
import { authorizeManager } from '@/lib/auth/serverGuard'
import { buildReorderPlan, openPurchaseProductIds, type StockProduct } from '@/lib/stock/alerts'

// Réapprovisionnement automatique.
//
// Regroupe les produits sous leur seuil d'alerte par fournisseur et crée un
// bon de commande BROUILLON par fournisseur (lignes pré-remplies avec la
// quantité conseillée). Les produits déjà présents dans un achat brouillon ou
// en attente sont ignorés (pas de double commande) ; ceux sans fournisseur
// sont signalés mais non commandés.
//
// POST { dryRun?: boolean, multiplier?: number }

export async function POST(req: NextRequest) {
  try {
    const auth = await authorizeManager(req)
    if ('error' in auth) return auth.error
    const { client, userId } = auth

    let body: { dryRun?: boolean; multiplier?: number } = {}
    try { body = await req.json() } catch { /* corps vide accepté */ }

    const dryRun = !!body.dryRun
    const multiplier = Number(body.multiplier) > 0 ? Number(body.multiplier) : undefined

    const [productsRes, suppliersRes, purchasesRes] = await Promise.all([
      client.from('products').select('id, name, quantity, unit, threshold_alert, price_per_unit, supplier_id'),
      client.from('clients').select('id, name').eq('type', 'fournisseur'),
      client.from('purchases').select('id, status').in('status', ['draft', 'pending']),
    ])

    const firstError = productsRes.error || suppliersRes.error || purchasesRes.error
    if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

    const openPurchaseIds = (purchasesRes.data || []).map(p => p.id)
    let openItems: { purchase_id: string; product_id?: string | null }[] = []
    if (openPurchaseIds.length) {
      const { data } = await client.from('purchase_items').select('purchase_id, product_id').in('purchase_id', openPurchaseIds)
      openItems = (data || []) as { purchase_id: string; product_id?: string | null }[]
    }
    const exclude = openPurchaseProductIds(purchasesRes.data || [], openItems)

    const { plans, withoutSupplier } = buildReorderPlan(
      (productsRes.data || []) as StockProduct[],
      (suppliersRes.data || []) as { id: string; name: string }[],
      { excludeProductIds: exclude, multiplier },
    )

    const summary = plans.map(p => ({
      supplier_id: p.supplier_id,
      supplier_name: p.supplier_name,
      items: p.items.length,
      estimated_total: p.estimated_total,
    }))

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        suppliers: plans.length,
        products: plans.reduce((s, p) => s + p.items.length, 0),
        estimated_total: Math.round(plans.reduce((s, p) => s + p.estimated_total, 0) * 100) / 100,
        withoutSupplier: withoutSupplier.length,
        plans: summary,
      })
    }

    if (plans.length === 0) {
      return NextResponse.json({ ok: true, created: 0, failed: 0, withoutSupplier: withoutSupplier.length, plans: [] })
    }

    const today = new Date().toISOString().slice(0, 10)
    let created = 0
    let failed = 0

    for (const plan of plans) {
      const { data: number } = await client.rpc('generate_purchase_number')
      const { data: purchase, error: purchaseError } = await client
        .from('purchases')
        .insert({
          purchase_number: number,
          supplier_id: plan.supplier_id,
          date: today,
          status: 'draft',
          subtotal: plan.estimated_total,
          notes: 'Réapprovisionnement automatique — produits sous seuil d\u2019alerte (phase 3).',
          created_by: userId,
        })
        .select('id')
        .single()

      if (purchaseError || !purchase) { failed++; continue }

      const rows = plan.items.map((item, index) => ({
        purchase_id: purchase.id,
        product_id: item.product_id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        subtotal: item.estimated_cost,
        sort_order: index,
      }))

      const { error: linesError } = await client.from('purchase_items').insert(rows)
      if (linesError) {
        await client.from('purchases').delete().eq('id', purchase.id)
        failed++
        continue
      }
      created++
    }

    return NextResponse.json({
      ok: true,
      created,
      failed,
      withoutSupplier: withoutSupplier.length,
      plans: summary,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erreur serveur' }, { status: 500 })
  }
}
