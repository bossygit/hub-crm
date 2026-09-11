import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  lowStockProducts,
  suggestedReorderQuantity,
  buildLowStockAlerts,
  hasRecentAlert,
  alertKey,
  stockAlertMessage,
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
