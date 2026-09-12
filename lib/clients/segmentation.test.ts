import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  recencyScore,
  clientScore,
  classifyClient,
  computeClientSegmentation,
  segmentBreakdown,
  SEGMENT_THRESHOLDS,
  type SegmentationClient,
} from './segmentation.ts'

const now = new Date(2026, 8, 15) // 15/09/2026

describe('recencyScore', () => {
  it('est maximal sous 30 jours et nul au-delà d un an', () => {
    assert.equal(recencyScore(0), 100)
    assert.equal(recencyScore(30), 100)
    assert.equal(recencyScore(365), 0)
    assert.equal(recencyScore(500), 0)
    assert.equal(recencyScore(null), 0)
  })

  it('décroît entre les deux bornes', () => {
    const mid = recencyScore(200)
    assert.ok(mid > 0 && mid < 100)
    assert.ok(recencyScore(100) > mid)
  })
})

describe('clientScore', () => {
  it('vaut 0 sans commande', () => {
    assert.equal(clientScore({ ordersCount: 0, lifetimeValue: 5_000_000, recencyDays: 1 }), 0)
  })

  it('combine récence, fréquence et montant', () => {
    const score = clientScore({ ordersCount: 3, lifetimeValue: 1_200_000, recencyDays: 14 })
    assert.equal(score, 88)
  })

  it('reste borné à 100', () => {
    const score = clientScore({ ordersCount: 50, lifetimeValue: 99_000_000, recencyDays: 0 })
    assert.ok(score <= 100)
  })
})

describe('classifyClient', () => {
  const base = { lifetimeValue: 0, recencyDays: null, createdAt: '2026-01-01', now }

  it('classe VIP et fidèle selon les seuils', () => {
    assert.equal(classifyClient({ ...base, ordersCount: 3, lifetimeValue: SEGMENT_THRESHOLDS.vipRevenue }), 'vip')
    assert.equal(classifyClient({ ...base, ordersCount: 1, lifetimeValue: SEGMENT_THRESHOLDS.loyalRevenue }), 'fidele')
    assert.equal(classifyClient({ ...base, ordersCount: 3, lifetimeValue: 10_000 }), 'fidele')
  })

  it('distingue actif et inactif par la récence', () => {
    assert.equal(classifyClient({ ...base, ordersCount: 1, lifetimeValue: 50_000, recencyDays: 20 }), 'actif')
    assert.equal(classifyClient({ ...base, ordersCount: 1, lifetimeValue: 50_000, recencyDays: 200 }), 'inactif')
  })

  it('distingue prospect et inactif sans commande', () => {
    assert.equal(classifyClient({ ordersCount: 0, lifetimeValue: 0, recencyDays: null, createdAt: '2026-09-01', now }), 'prospect')
    assert.equal(classifyClient({ ordersCount: 0, lifetimeValue: 0, recencyDays: null, createdAt: '2024-01-01', now }), 'inactif')
    assert.equal(classifyClient({ ordersCount: 0, lifetimeValue: 0, recencyDays: null, createdAt: null, now }), 'prospect')
  })
})

describe('computeClientSegmentation', () => {
  const clients: SegmentationClient[] = [
    { id: 'c1', created_at: '2026-01-01' },
    { id: 'c2', created_at: '2026-01-01' },
    { id: 'c3', created_at: '2026-09-01' },
    { id: 'c4', created_at: '2024-01-01' },
  ]
  const invoices = [
    { id: 'i1', client_id: 'c1', date: '2026-09-01', status: 'approved', total: 500_000 },
    { id: 'i2', client_id: 'c1', date: '2026-08-01', status: 'partial', total: 400_000 },
    { id: 'i3', client_id: 'c1', date: '2026-07-01', status: 'paid', total: 300_000 },
    { id: 'i4', client_id: 'c2', date: '2026-08-01', status: 'approved', total: 350_000 },
    { id: 'i5', client_id: 'c1', date: '2026-09-10', status: 'draft', total: 9_999_999 },
    { id: 'i6', client_id: null, date: '2026-09-10', status: 'paid', total: 100_000 },
    { id: 'i7', client_id: 'c9', date: '2026-09-10', status: 'paid', total: 100_000 },
  ]
  const payments = [{ invoice_id: 'i1', amount: 200_000 }]

  it('agrège CA, commandes, récence, encours et segment', () => {
    const rows = computeClientSegmentation(clients, invoices, payments, { now })
    const c1 = rows.find(r => r.clientId === 'c1')!
    assert.equal(c1.ordersCount, 3)
    assert.equal(c1.lifetimeValue, 1_200_000)
    assert.equal(c1.lastOrderAt, '2026-09-01')
    assert.equal(c1.recencyDays, 14)
    assert.equal(c1.averageBasket, 400_000)
    // Encours = somme des restes dus : (500k−200k) + 400k + 300k.
    assert.equal(c1.outstanding, 1_000_000)
    assert.equal(c1.segment, 'vip')

    const c2 = rows.find(r => r.clientId === 'c2')!
    assert.equal(c2.segment, 'fidele')
    assert.equal(rows.find(r => r.clientId === 'c3')!.segment, 'prospect')
    assert.equal(rows.find(r => r.clientId === 'c4')!.segment, 'inactif')
  })

  it('ignore les factures non validées et les clients inconnus', () => {
    const rows = computeClientSegmentation(clients, invoices, [], { now })
    assert.equal(rows.reduce((s, r) => s + r.lifetimeValue, 0), 1_550_000)
    assert.equal(rows.length, clients.length)
  })

  it('gère un client sans facture', () => {
    const rows = computeClientSegmentation([{ id: 'solo' }], [], [], { now })
    assert.equal(rows[0].ordersCount, 0)
    assert.equal(rows[0].recencyDays, null)
    assert.equal(rows[0].score, 0)
  })
})

describe('segmentBreakdown', () => {
  it('compte et somme le CA par segment, dans l ordre canonique', () => {
    const rows = computeClientSegmentation(
      [
        { id: 'a', created_at: '2026-01-01' },
        { id: 'b', created_at: '2026-01-01' },
      ],
      [
        { id: '1', client_id: 'a', date: '2026-09-01', status: 'paid', total: 100 },
        { id: '2', client_id: 'b', date: '2026-09-01', status: 'paid', total: 50 },
      ],
      [],
      { now },
    )
    const breakdown = segmentBreakdown(rows)
    assert.deepEqual(breakdown.map(b => b.segment), ['vip', 'fidele', 'actif', 'inactif', 'prospect'])
    const actif = breakdown.find(b => b.segment === 'actif')!
    assert.equal(actif.count, 2)
    assert.equal(actif.revenue, 150)
  })
})
