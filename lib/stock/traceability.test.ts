import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildLotRecall, suggestFefoBatch } from './traceability.ts'

describe('suggestFefoBatch', () => {
  const batches = [
    { id: 'old', product_id: 'farine', quantity: 10, expiry_date: '2026-10-01' },
    { id: 'sooner', product_id: 'farine', quantity: 4, expiry_date: '2026-09-15' },
    { id: 'empty', product_id: 'farine', quantity: 0, expiry_date: '2026-09-01' },
    { id: 'other', product_id: 'gari', quantity: 20, expiry_date: '2026-09-01' },
    { id: 'no-date', product_id: 'farine', quantity: 8, expiry_date: null },
  ]

  it('picks the soonest expiry with remaining quantity for that product', () => {
    assert.equal(suggestFefoBatch(batches, 'farine'), 'sooner')
  })

  it('returns null when no usable lot exists', () => {
    assert.equal(suggestFefoBatch(batches, 'unknown'), null)
    assert.equal(suggestFefoBatch([{ id: 'x', product_id: 'farine', quantity: 0, expiry_date: '2026-01-01' }], 'farine'), null)
  })
})

describe('buildLotRecall', () => {
  it('groups shipped quantities by client and skips draft or cancelled docs', () => {
    const recall = buildLotRecall(
      {
        batch_id: 'b1',
        batch_number: 'LOT-2026-01',
        product_name: 'Farine de manioc',
        expiry_date: '2026-12-01',
        production_date: '2026-06-01',
      },
      [
        {
          source: 'invoice',
          document_id: 'inv1',
          document_number: 'FAC-2026-0001',
          date: '2026-09-01',
          status: 'paid',
          client_id: 'c1',
          client_name: 'Géant Vert',
          quantity: 10,
        },
        {
          source: 'delivery_note',
          document_id: 'bl1',
          document_number: 'BL-2026-0001',
          date: '2026-09-02',
          status: 'approved',
          client_id: 'c1',
          client_name: 'Géant Vert',
          quantity: 10,
        },
        {
          source: 'invoice',
          document_id: 'inv2',
          document_number: 'FAC-2026-0002',
          date: '2026-09-03',
          status: 'draft',
          client_id: 'c2',
          client_name: 'Le Palmier',
          quantity: 99,
        },
        {
          source: 'invoice',
          document_id: 'inv3',
          document_number: 'FAC-2026-0003',
          date: '2026-09-04',
          status: 'cancelled',
          client_id: 'c2',
          client_name: 'Le Palmier',
          quantity: 50,
        },
        {
          source: 'invoice',
          document_id: 'inv4',
          document_number: 'FAC-2026-0004',
          date: '2026-09-05',
          status: 'approved',
          client_id: 'c2',
          client_name: 'Le Palmier',
          quantity: 3,
        },
      ],
    )

    assert.equal(recall.totalQuantity, 23)
    assert.equal(recall.clientCount, 2)
    assert.equal(recall.clients[0].client_name, 'Géant Vert')
    assert.equal(recall.clients[0].quantity, 20)
    assert.equal(recall.clients[1].client_name, 'Le Palmier')
    assert.equal(recall.clients[1].quantity, 3)
    assert.equal(recall.clients[1].documents.length, 1)
  })
})
