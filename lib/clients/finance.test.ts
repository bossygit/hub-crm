import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeClientFinance,
  CLIENT_REVENUE_STATUSES,
  type ClientInvoiceInput,
  type ClientPaymentInput,
} from './finance.ts'

function invoice(overrides: Record<string, unknown> = {}): ClientInvoiceInput {
  return {
    id: 'inv-1',
    date: '2026-09-01',
    status: 'approved',
    total: 1180,
    ...overrides,
  } as ClientInvoiceInput
}

function payment(overrides: Record<string, unknown> = {}): ClientPaymentInput {
  return {
    invoice_id: 'inv-1',
    amount: 500,
    payment_date: '2026-09-10',
    ...overrides,
  } as ClientPaymentInput
}

describe('computeClientFinance — facturation', () => {
  it('comptabilise seulement les factures validées (approved/partial/paid) dans le CA', () => {
    const result = computeClientFinance(
      [
        invoice({ id: 'd1', status: 'draft', total: 9999 }),
        invoice({ id: 'p1', status: 'pending', total: 9999 }),
        invoice({ id: 'c1', status: 'cancelled', total: 9999 }),
        invoice({ id: 'a1', status: 'approved', total: 1180 }),
        invoice({ id: 'p2', status: 'partial', total: 2360 }),
        invoice({ id: 'p3', status: 'paid', total: 590 }),
      ],
      [],
    )

    assert.equal(result.invoiceCount, 6)
    assert.equal(result.totalInvoiced, 4130)
    assert.equal(result.totalPaid, 0)
    assert.equal(result.balanceDue, 4130)
  })

  it('cumule les paiements reçus et calcule le solde dû', () => {
    const result = computeClientFinance(
      [
        invoice({ id: 'a1', total: 1180 }),
        invoice({ id: 'p2', status: 'partial', total: 2360 }),
      ],
      [
        payment({ invoice_id: 'a1', amount: 1180 }),
        payment({ invoice_id: 'p2', amount: 1000 }),
      ],
    )

    assert.equal(result.totalInvoiced, 3540)
    assert.equal(result.totalPaid, 2180)
    assert.equal(result.balanceDue, 1360)
  })

  it('ignore les paiements rattachés à des factures non validées (cancelled…)', () => {
    const result = computeClientFinance(
      [invoice({ id: 'c1', status: 'cancelled', total: 5000 })],
      [payment({ invoice_id: 'c1', amount: 2000 })],
    )

    assert.equal(result.totalInvoiced, 0)
    assert.equal(result.totalPaid, 0)
    assert.equal(result.balanceDue, 0)
  })

  it('compte les factures impayées / partiellement payées uniquement', () => {
    const result = computeClientFinance(
      [
        invoice({ id: 'a1', status: 'approved', total: 1180 }),
        invoice({ id: 'p2', status: 'partial', total: 2360 }),
        invoice({ id: 'p3', status: 'paid', total: 590 }),
        invoice({ id: 'p4', status: 'approved', total: 1000 }), // payée mais statut non mis à jour
        invoice({ id: 'd1', status: 'draft', total: 500 }),
      ],
      [
        payment({ invoice_id: 'a1', amount: 500 }),
        payment({ invoice_id: 'p2', amount: 2360 }), // soldée → ne compte pas
        payment({ invoice_id: 'p4', amount: 1000 }),
      ],
    )

    // a1 reste due (680) ; p2 soldée ; p3 déjà payée ; p4 soldée.
    assert.equal(result.outstandingInvoices, 1)
    assert.equal(result.totalInvoiced, 5130)
    assert.equal(result.totalPaid, 3860)
    assert.equal(result.balanceDue, 1270)
  })

  it('ne renvoie jamais un solde négatif en cas de trop-perçu', () => {
    const result = computeClientFinance(
      [invoice({ id: 'a1', total: 1000 })],
      [payment({ invoice_id: 'a1', amount: 1500 })],
    )

    assert.equal(result.balanceDue, 0)
    assert.equal(result.totalPaid, 1500)
    assert.equal(result.outstandingInvoices, 0)
  })

  it('renvoie des zéros propres sur entrées vides', () => {
    const result = computeClientFinance([], [])

    assert.deepEqual(result, {
      totalInvoiced: 0,
      invoiceCount: 0,
      totalPaid: 0,
      balanceDue: 0,
      outstandingInvoices: 0,
      totalPurchased: 0,
      purchaseCount: 0,
      supplierPaid: 0,
      supplierBalanceDue: 0,
    })
  })

  it('résiste aux totaux manquants ou invalides', () => {
    const result = computeClientFinance(
      [invoice({ id: 'a1', total: undefined as unknown as number })],
      [payment({ invoice_id: 'a1', amount: 'abc' as unknown as number })],
    )

    assert.equal(result.totalInvoiced, 0)
    assert.equal(result.totalPaid, 0)
    assert.equal(result.balanceDue, 0)
  })
})

describe('computeClientFinance — volet fournisseur (achats)', () => {
  it('comptabilise les achats commandés ou réceptionnés et leur règlement', () => {
    const result = computeClientFinance([], [], [
      { id: 'ach-1', date: '2026-08-01', status: 'approved', subtotal: 200000 },
      { id: 'ach-2', date: '2026-08-05', status: 'pending', subtotal: 60000 },
      { id: 'ach-3', date: '2026-08-06', status: 'draft', subtotal: 99999 },
      { id: 'ach-4', date: '2026-08-07', status: 'cancelled', subtotal: 99999 },
    ], [
      { purchase_id: 'ach-1', amount: 120000, payment_date: '2026-08-20' },
    ])

    assert.equal(result.totalPurchased, 260000)
    assert.equal(result.purchaseCount, 2)
    assert.equal(result.supplierPaid, 120000)
    assert.equal(result.supplierBalanceDue, 140000)
  })
})

describe('CLIENT_REVENUE_STATUSES', () => {
  it('reflète les statuts de revenu de lib/reports/revenue.ts', () => {
    assert.deepEqual([...CLIENT_REVENUE_STATUSES], ['approved', 'partial', 'paid'])
  })
})
