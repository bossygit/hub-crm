import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildMonthJournal, resolveMonth } from './journal.ts'

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    invoice_number: 'FAC-2026-0001',
    date: '2026-09-10',
    status: 'approved',
    subtotal: 1000,
    discount: 0,
    tax_amount: 180,
    total: 1180,
    client_id: 'c1',
    ...overrides,
  }
}

const client = { id: 'c1', name: 'Coopérative du Pool', tax_id: 'CG-123' }

describe('resolveMonth', () => {
  it('keeps a valid YYYY-MM query', () => {
    assert.equal(resolveMonth('2026-08'), '2026-08')
  })

  it('falls back to the current UTC month when missing or invalid', () => {
    const now = new Date()
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    assert.equal(resolveMonth(undefined), expected)
    assert.equal(resolveMonth('nope'), expected)
    assert.equal(resolveMonth('2026-13'), expected)
  })
})

describe('buildMonthJournal sales', () => {
  it('excludes invoices outside the month', () => {
    const journal = buildMonthJournal(
      [invoice({ date: '2026-08-31' }), invoice({ id: 'inv-2', invoice_number: 'FAC-2026-0002', date: '2026-09-01' })],
      [client],
      [],
      '2026-09',
    )
    assert.equal(journal.sales.length, 1)
    assert.equal(journal.sales[0].invoiceNumber, 'FAC-2026-0002')
  })

  it('excludes draft, pending and cancelled invoices even in the month', () => {
    const journal = buildMonthJournal(
      [
        invoice({ id: 'd', status: 'draft' }),
        invoice({ id: 'p', status: 'pending' }),
        invoice({ id: 'x', status: 'cancelled' }),
        invoice({ id: 'ok', invoice_number: 'FAC-OK', status: 'paid' }),
      ],
      [client],
      [],
      '2026-09',
    )
    assert.equal(journal.sales.length, 1)
    assert.equal(journal.sales[0].invoiceNumber, 'FAC-OK')
    assert.equal(journal.sales[0].statusLabel, 'Payée')
  })

  it('fills client, NIF, HT after discount, and French status', () => {
    const journal = buildMonthJournal(
      [invoice({ subtotal: 1000, discount: 100, tax_amount: 162, total: 1062, status: 'partial' })],
      [client],
      [],
      '2026-09',
    )
    assert.equal(journal.sales[0].clientName, 'Coopérative du Pool')
    assert.equal(journal.sales[0].nif, 'CG-123')
    assert.equal(journal.sales[0].ht, 900)
    assert.equal(journal.sales[0].discount, 100)
    assert.equal(journal.sales[0].statusLabel, 'Partielle')
  })

  it('uses all payments for collected and floors the balance at 0', () => {
    const journal = buildMonthJournal(
      [invoice()],
      [client],
      [
        { invoice_id: 'inv-1', amount: 800, payment_date: '2026-08-01', method: 'virement', reference: 'A' },
        { invoice_id: 'inv-1', amount: 500, payment_date: '2026-10-01', method: 'espèces', reference: null },
      ],
      '2026-09',
    )
    assert.equal(journal.sales[0].collected, 1300)
    assert.equal(journal.sales[0].balance, 0)
  })
})

describe('buildMonthJournal receipts', () => {
  it('includes a payment in the month even if the invoice is from another month', () => {
    const journal = buildMonthJournal(
      [invoice({ date: '2026-08-15' })],
      [client],
      [{ invoice_id: 'inv-1', amount: 200, payment_date: '2026-09-05', method: 'virement', reference: 'VIR-1' }],
      '2026-09',
    )
    assert.equal(journal.sales.length, 0)
    assert.equal(journal.receipts.length, 1)
    assert.equal(journal.receipts[0].invoiceNumber, 'FAC-2026-0001')
    assert.equal(journal.receipts[0].amount, 200)
    assert.equal(journal.receipts[0].reference, 'VIR-1')
  })

  it('excludes a payment outside the month even if the invoice is in the month', () => {
    const journal = buildMonthJournal(
      [invoice()],
      [client],
      [{ invoice_id: 'inv-1', amount: 200, payment_date: '2026-10-01', method: 'virement', reference: null }],
      '2026-09',
    )
    assert.equal(journal.receipts.length, 0)
  })

  it('keeps an orphan payment with empty invoice fields', () => {
    const journal = buildMonthJournal(
      [],
      [],
      [{ invoice_id: 'missing', amount: 50, payment_date: '2026-09-12', method: 'chèque', reference: null }],
      '2026-09',
    )
    assert.equal(journal.receipts[0].invoiceNumber, '')
    assert.equal(journal.receipts[0].clientName, '')
    assert.equal(journal.receipts[0].nif, '')
    assert.equal(journal.receipts[0].amount, 50)
  })
})

describe('buildMonthJournal totals', () => {
  it('sums month KPIs from the two journals and keeps all-time HT and pending', () => {
    const journal = buildMonthJournal(
      [
        invoice({ subtotal: 1000, discount: 0, tax_amount: 180, total: 1180 }),
        invoice({
          id: 'inv-aug',
          invoice_number: 'FAC-AUG',
          date: '2026-08-01',
          subtotal: 2000,
          tax_amount: 360,
          total: 2360,
        }),
        invoice({ id: 'pend', status: 'pending', date: '2026-09-20', total: 99 }),
      ],
      [client],
      [
        { invoice_id: 'inv-1', amount: 180, payment_date: '2026-09-20', method: 'virement', reference: null },
        { invoice_id: 'inv-aug', amount: 500, payment_date: '2026-09-21', method: 'espèces', reference: null },
      ],
      '2026-09',
    )
    assert.equal(journal.monthHt, 1000)
    assert.equal(journal.monthTtc, 1180)
    assert.equal(journal.monthVat, 180)
    assert.equal(journal.monthCollected, 680)
    assert.equal(journal.monthOutstanding, 1000)
    assert.equal(journal.cumulativeHt, 3000)
    assert.equal(journal.pendingCount, 1)
  })
})
