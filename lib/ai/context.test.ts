import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildBusinessSnapshot, snapshotToPrompt, type BusinessData } from './context.ts'

const now = new Date(2026, 8, 15) // 15/09/2026

const data: BusinessData = {
  invoices: [
    { id: 'i1', invoice_number: 'F1', client_id: 'c1', due_date: '2026-09-20', date: '2026-09-05', status: 'approved', total: 500_000 },
    { id: 'i2', invoice_number: 'F2', client_id: 'c1', due_date: '2026-08-25', date: '2026-08-10', status: 'paid', total: 300_000 },
    { id: 'i3', invoice_number: 'F3', client_id: 'c2', due_date: '2026-08-01', date: '2026-09-01', status: 'partial', total: 200_000 },
    { id: 'i4', invoice_number: 'F4', client_id: 'c2', due_date: null, date: '2026-07-01', status: 'draft', total: 999_999 },
    { id: 'i5', invoice_number: 'F5', client_id: null, due_date: null, date: '2026-03-01', status: 'cancelled', total: 1_000 },
  ],
  payments: [{ invoice_id: 'i3', amount: 50_000 }],
  products: [
    { id: 'p1', name: 'Arachides', quantity: 85, unit: 'kg', threshold_alert: 100, price_per_unit: 250, category: 'Épicerie' },
    { id: 'p2', name: 'Riz', quantity: 500, unit: 'kg', threshold_alert: 100, price_per_unit: 300, category: 'Céréales' },
  ],
  clients: [
    { id: 'c1', name: 'Alpha', segment: 'vip' },
    { id: 'c2', name: 'Beta', segment: 'fidele' },
    { id: 'c3', name: 'Gamma', segment: 'prospect' },
  ],
  purchases: [
    { id: 'pa', status: 'draft', subtotal: 100_000 },
    { id: 'pb', status: 'approved', subtotal: 50_000 },
  ],
  portalOrders: [
    { id: 'o1', status: 'nouvelle', total_amount: 10_000 },
    { id: 'o2', status: 'livree', total_amount: 20_000 },
  ],
}

describe('buildBusinessSnapshot', () => {
  const snapshot = buildBusinessSnapshot(data, now)

  it('calcule le CA du mois, de l’année et sur 12 mois', () => {
    assert.equal(snapshot.revenue.monthTtc, 700_000)
    assert.equal(snapshot.revenue.yearTtc, 1_000_000)
    assert.equal(snapshot.revenue.last12mTtc, 1_000_000)
    assert.equal(snapshot.revenue.monthly.length, 12)
  })

  it('calcule les créances et les retards', () => {
    assert.equal(snapshot.receivables.openCount, 2)
    assert.equal(snapshot.receivables.openAmount, 650_000)
    assert.equal(snapshot.receivables.overdueCount, 1)
    assert.equal(snapshot.receivables.overdueAmount, 150_000)
    assert.equal(snapshot.receivables.oldestOverdueDays, 45)
  })

  it('nomme les principaux retards (client + facture)', () => {
    assert.equal(snapshot.receivables.overdueTop.length, 1)
    assert.deepEqual(snapshot.receivables.overdueTop[0], {
      invoiceNumber: 'F3', clientName: 'Beta', days: 45, amount: 150_000,
    })
  })

  it('compte les factures par statut', () => {
    assert.equal(snapshot.invoices.total, 5)
    assert.equal(snapshot.invoices.byStatus.approved, 1)
    assert.equal(snapshot.invoices.byStatus.draft, 1)
    assert.equal(snapshot.invoices.pendingCount, 0)
  })

  it('valorise le stock et liste les alertes', () => {
    assert.equal(snapshot.stock.productCount, 2)
    assert.equal(snapshot.stock.stockValue, 171_250)
    assert.equal(snapshot.stock.lowCount, 1)
    assert.deepEqual(snapshot.stock.lowItems[0], { name: 'Arachides', quantity: 85, unit: 'kg', threshold: 100 })
  })

  it('segmente les clients et calcule le top', () => {
    assert.equal(snapshot.clients.total, 3)
    const segments = Object.fromEntries(snapshot.clients.bySegment.map(s => [s.segment, s.count]))
    assert.deepEqual(segments, { vip: 1, fidele: 1, actif: 0, inactif: 0, prospect: 1 })
    assert.deepEqual(snapshot.clients.top[0], { name: 'Alpha', revenue: 800_000 })
  })

  it('résume les achats en cours et les commandes portail', () => {
    assert.equal(snapshot.purchases.openCount, 1)
    assert.equal(snapshot.purchases.openAmount, 100_000)
    assert.equal(snapshot.portalOrders.total, 2)
    assert.equal(snapshot.portalOrders.byStatus.livree, 1)
  })

  it('supporte des données vides', () => {
    const empty = buildBusinessSnapshot({ invoices: [], payments: [], products: [], clients: [] }, now)
    assert.equal(empty.revenue.last12mTtc, 0)
    assert.equal(empty.receivables.openCount, 0)
    assert.equal(empty.stock.lowCount, 0)
    assert.deepEqual(empty.clients.top, [])
  })
})

describe('snapshotToPrompt', () => {
  it('rend un bloc factuel exploitable par le modèle', () => {
    const text = snapshotToPrompt(buildBusinessSnapshot(data, now))
    assert.match(text, /DONNÉES CRM/)
    assert.match(text, /Chiffre d'affaires/)
    assert.match(text, /Créances/)
    assert.match(text, /Arachides/)
    assert.match(text, /Alpha/)
    assert.match(text, /FCFA/)
    assert.match(text, /Meilleurs clients/)
    assert.match(text, /Principaux retards/)
  })
})
