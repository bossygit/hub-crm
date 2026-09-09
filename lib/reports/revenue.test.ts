import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeInvoiceRevenue } from './revenue.ts'

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    status: 'approved',
    subtotal: 1000,
    discount: 0,
    tax_amount: 180,
    total: 1180,
    date: '2026-09-01',
    ...overrides,
  }
}

describe('computeInvoiceRevenue', () => {
  it('counts only approved, partial and paid invoices in revenue', () => {
    const result = computeInvoiceRevenue(
      [
        invoice({ status: 'draft', total: 9999, tax_amount: 999 }),
        invoice({ status: 'pending', total: 9999, tax_amount: 999 }),
        invoice({ status: 'cancelled', total: 9999, tax_amount: 999 }),
        invoice({ status: 'approved', subtotal: 1000, discount: 0, tax_amount: 180, total: 1180 }),
        invoice({ status: 'partial', subtotal: 2000, discount: 0, tax_amount: 360, total: 2360 }),
        invoice({ status: 'paid', subtotal: 500, discount: 0, tax_amount: 90, total: 590 }),
      ],
      '2026-09-01T00:00:00.000Z',
    )

    assert.equal(result.cumulativeHt, 3500)
    assert.equal(result.collectedVat, 630)
    assert.equal(result.pendingCount, 1)
  })

  it('uses invoice date for monthly TTC revenue', () => {
    const result = computeInvoiceRevenue(
      [
        invoice({ date: '2026-08-31', total: 1180, tax_amount: 180, subtotal: 1000 }),
        invoice({ date: '2026-09-01', total: 2360, tax_amount: 360, subtotal: 2000 }),
        invoice({ date: '2026-09-15', total: 590, tax_amount: 90, subtotal: 500 }),
      ],
      '2026-09-01T00:00:00.000Z',
    )

    assert.equal(result.monthTtc, 2950)
  })

  it('subtracts discount from HT revenue', () => {
    const result = computeInvoiceRevenue(
      [invoice({ subtotal: 1000, discount: 100, tax_amount: 162, total: 1062 })],
      '2026-09-01T00:00:00.000Z',
    )

    assert.equal(result.cumulativeHt, 900)
  })
})
