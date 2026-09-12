import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  lowStockProducts,
  suggestedReorderQuantity,
  buildLowStockAlerts,
  hasRecentAlert,
  alertKey,
  stockAlertMessage,
  buildReorderPlan,
  openPurchaseProductIds,
  type StockProduct,
} from './alerts.ts'

const product = (over: Partial<StockProduct> = {}): StockProduct => ({
  id: 'p1', name: 'Arachides', quantity: 85, unit: 'kg', threshold_alert: 100, ...over,
})

describe('lowStockProducts', () => {
  it('retient les produits au seuil ou en dessous', () => {
    const rows = lowStockProducts([
      product({ id: 'a', quantity: 85, threshold_alert: 100 }),
      product({ id: 'b', quantity: 100, threshold_alert: 100 }),
      product({ id: 'c', quantity: 101, threshold_alert: 100 }),
      product({ id: 'd', quantity: 0, threshold_alert: 0 }),
    ])
    assert.deepEqual(rows.map(p => p.id), ['a', 'b'])
  })
})

describe('suggestedReorderQuantity', () => {
  it('vise le double du seuil', () => {
    assert.equal(suggestedReorderQuantity(product({ quantity: 85, threshold_alert: 100 })), 115)
    assert.equal(suggestedReorderQuantity(product({ quantity: 0, threshold_alert: 15 })), 30)
    assert.equal(suggestedReorderQuantity(product({ quantity: 50, threshold_alert: 0 })), 0)
  })
})

describe('buildLowStockAlerts', () => {
  it('classe les critiques en premier et calcule l écart', () => {
    const alerts = buildLowStockAlerts([
      product({ id: 'warn', name: 'Feuilles', quantity: 12, threshold_alert: 15 }),
      product({ id: 'crit', name: 'Arachides', quantity: 30, threshold_alert: 100 }),
      product({ id: 'ok', name: 'Riz', quantity: 500, threshold_alert: 100 }),
    ])
    assert.deepEqual(alerts.map(a => a.product.id), ['crit', 'warn'])
    assert.equal(alerts[0].severity, 'critical')
    assert.equal(alerts[0].shortfall, 70)
    assert.equal(alerts[1].severity, 'warning')
  })
})

describe('hasRecentAlert', () => {
  const now = new Date(2026, 8, 11)

  it('détecte une alerte identique récente', () => {
    const existing = [{ type: 'stock_low', reference_id: 'p1', created_at: '2026-09-10T08:00:00Z' }]
    assert.equal(hasRecentAlert(existing, { type: 'stock_low', referenceId: 'p1' }, now), true)
    assert.equal(hasRecentAlert(existing, { type: 'stock_low', referenceId: 'p2' }, now), false)
    assert.equal(hasRecentAlert(existing, { type: 'invoice_overdue', referenceId: 'p1' }, now), false)
  })

  it('oublie une alerte plus vieille que la fenêtre', () => {
    const existing = [{ type: 'stock_low', reference_id: 'p1', created_at: '2026-09-01T08:00:00Z' }]
    assert.equal(hasRecentAlert(existing, { type: 'stock_low', referenceId: 'p1' }, now, 3), false)
    assert.equal(hasRecentAlert(existing, { type: 'stock_low', referenceId: 'p1' }, now, 30), true)
  })
})

describe('alertKey / stockAlertMessage', () => {
  it('construit une clé stable et un message lisible', () => {
    assert.equal(alertKey('stock_low', 'p1'), 'stock_low:p1')
    const msg = stockAlertMessage(buildLowStockAlerts([product()])[0])
    assert.match(msg, /85 kg/)
    assert.match(msg, /seuil 100/)
    assert.match(msg, /115 kg/)
  })
})

describe('buildReorderPlan', () => {
  const suppliers = [
    { id: 's1', name: 'Congo Agro' },
    { id: 's2', name: 'BZV Emballage' },
  ]
  const products: StockProduct[] = [
    product({ id: 'a', name: 'Farine', quantity: 10, threshold_alert: 100, unit: 'kg', price_per_unit: 250, supplier_id: 's1' }),
    product({ id: 'b', name: 'Sachets', quantity: 5, threshold_alert: 20, unit: 'pièce', price_per_unit: 100, supplier_id: 's2' }),
    product({ id: 'c', name: 'Orphelin', quantity: 1, threshold_alert: 10, unit: 'kg', price_per_unit: 50, supplier_id: null }),
    product({ id: 'd', name: 'OK', quantity: 500, threshold_alert: 10, unit: 'kg', supplier_id: 's1' }),
  ]

  it('regroupe par fournisseur et estime le coût', () => {
    const { plans, withoutSupplier } = buildReorderPlan(products, suppliers)
    assert.equal(plans.length, 2)
    assert.deepEqual(withoutSupplier.map(a => a.product.id), ['c'])

    const agro = plans.find(p => p.supplier_id === 's1')!
    assert.equal(agro.supplier_name, 'Congo Agro')
    assert.equal(agro.items.length, 1)
    assert.equal(agro.items[0].quantity, 190) // 100*2 - 10
    assert.equal(agro.items[0].estimated_cost, 47500)
    assert.equal(agro.estimated_total, 47500)

    const emb = plans.find(p => p.supplier_id === 's2')!
    assert.equal(emb.items[0].quantity, 35) // 20*2 - 5
    assert.equal(emb.estimated_total, 3500)
  })

  it('trie les commandes par montant décroissant', () => {
    const { plans } = buildReorderPlan(products, suppliers)
    assert.deepEqual(plans.map(p => p.supplier_id), ['s1', 's2'])
  })

  it('exclut les produits déjà en commande ouverte', () => {
    const { plans, withoutSupplier } = buildReorderPlan(products, suppliers, { excludeProductIds: ['a', 'c'] })
    assert.deepEqual(plans.map(p => p.supplier_id), ['s2'])
    assert.equal(withoutSupplier.length, 0)
  })

  it('nomme les fournisseurs inconnus', () => {
    const { plans } = buildReorderPlan(
      [product({ id: 'x', quantity: 1, threshold_alert: 10, supplier_id: 'inconnu' })],
      [],
    )
    assert.equal(plans[0].supplier_name, 'Fournisseur inconnu')
  })

  it('ignore un produit dont la quantité suggérée est nulle', () => {
    const { plans } = buildReorderPlan(
      [product({ id: 'z', quantity: 100, threshold_alert: 50, supplier_id: 's1' })],
      suppliers,
    )
    assert.equal(plans.length, 0)
  })
})

describe('openPurchaseProductIds', () => {
  it('ne retient que les produits des achats brouillon / en attente', () => {
    const purchases = [
      { id: 'pa', status: 'draft' },
      { id: 'pb', status: 'pending' },
      { id: 'pc', status: 'approved' },
      { id: 'pd', status: 'cancelled' },
    ]
    const items = [
      { purchase_id: 'pa', product_id: 'x' },
      { purchase_id: 'pb', product_id: 'y' },
      { purchase_id: 'pc', product_id: 'z' },
      { purchase_id: 'pd', product_id: 'w' },
      { purchase_id: 'pa', product_id: null },
    ]
    const ids = openPurchaseProductIds(purchases, items)
    assert.deepEqual(Array.from(ids).sort(), ['x', 'y'])
  })
})
