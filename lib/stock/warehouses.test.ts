import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateTransfer,
  stockByWarehouse,
  totalsByWarehouse,
  summarizeWarehouses,
} from './warehouses.ts'

describe('validateTransfer', () => {
  it('accepts a positive quantity within the available stock', () => {
    assert.equal(validateTransfer({ availableQty: 50, qty: 20 }), null)
  })

  it('rejects zero and negative quantities', () => {
    assert.equal(validateTransfer({ availableQty: 50, qty: 0 }), 'La quantité à transférer doit être strictement positive.')
    assert.equal(validateTransfer({ availableQty: 50, qty: -3 }), 'La quantité à transférer doit être strictement positive.')
    assert.equal(validateTransfer({ availableQty: 50, qty: Number.NaN }), 'La quantité à transférer doit être strictement positive.')
  })

  it('rejects a quantity exceeding the available stock', () => {
    const msg = validateTransfer({ availableQty: 50, qty: 51 })
    assert.ok(msg && msg.includes('Quantité insuffisante'))
    assert.ok(msg && msg.includes('50'))
  })

  it('rejects transfer of a lot that is not released by quality', () => {
    assert.equal(
      validateTransfer({ availableQty: 50, qty: 5, released: false }),
      'Seuls les lots libérés par la qualité (released) peuvent être transférés.',
    )
  })

  it('accepts an undefined released status (legacy batches are usable)', () => {
    assert.equal(validateTransfer({ availableQty: 50, qty: 5, released: undefined }), null)
    assert.equal(validateTransfer({ availableQty: 50, qty: 5, released: true }), null)
  })
})

describe('stockByWarehouse', () => {
  const warehouses = [
    { id: 'w1', name: 'Entrepôt Principal' },
    { id: 'w2', name: 'Chambre froide' },
  ]

  const batches = [
    { id: 'b1', product_id: 'p1', batch_number: 'L1', quantity: 50, quality_status: 'released', warehouse_id: 'w1', product: { name: 'Farine' } },
    { id: 'b2', product_id: 'p1', batch_number: 'L2', quantity: 20, quality_status: 'pending', warehouse_id: 'w2', product: { name: 'Farine' } },
    { id: 'b3', product_id: 'p2', batch_number: 'L3', quantity: 5, quality_status: 'released', warehouse_id: 'w1', product: { name: 'Huile' } },
  ]

  it('groups by product then warehouse and sums quantities', () => {
    const rows = stockByWarehouse(batches, warehouses)
    assert.equal(rows.length, 3)
    assert.deepEqual(rows.map(r => [r.product_name, r.warehouse_name, r.quantity]), [
      ['Farine', 'Chambre froide', 20],
      ['Farine', 'Entrepôt Principal', 50],
      ['Huile', 'Entrepôt Principal', 5],
    ])
  })

  it('sums multiple lots of the same product in the same warehouse', () => {
    const rows = stockByWarehouse(
      [
        ...batches,
        { id: 'b4', product_id: 'p1', batch_number: 'L4', quantity: 30, quality_status: 'released', warehouse_id: 'w1', product: { name: 'Farine' } },
      ],
      warehouses,
    )
    const farine = rows.find(r => r.product_name === 'Farine' && r.warehouse_name === 'Entrepôt Principal')
    assert.equal(farine?.quantity, 80)
  })

  it('excludes empty and negative batches', () => {
    const rows = stockByWarehouse(
      [{ id: 'bx', product_id: 'p1', batch_number: 'L0', quantity: 0, warehouse_id: 'w1', product: { name: 'Farine' } }],
      warehouses,
    )
    assert.equal(rows.length, 0)
  })

  it('maps unassigned lots to the default warehouse when provided', () => {
    const rows = stockByWarehouse(
      [{ id: 'b5', product_id: 'p1', batch_number: 'L5', quantity: 12, warehouse_id: null, product: { name: 'Farine' } }],
      warehouses,
      'w1',
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].warehouse_id, 'w1')
    assert.equal(rows[0].warehouse_name, 'Entrepôt Principal')
    assert.equal(rows[0].quantity, 12)
  })

  it('labels unassigned lots "Sans entrepôt" when no default is provided', () => {
    const rows = stockByWarehouse(
      [{ id: 'b6', product_id: 'p1', batch_number: 'L6', quantity: 3, warehouse_id: null, product: { name: 'Farine' } }],
      warehouses,
    )
    assert.equal(rows[0].warehouse_name, 'Sans entrepôt')
    assert.equal(rows[0].warehouse_id, null)
  })
})

describe('totalsByWarehouse', () => {
  it('aggregates rows per warehouse', () => {
    const rows = stockByWarehouse(
      [
        { id: 'b1', product_id: 'p1', batch_number: 'L1', quantity: 10, warehouse_id: 'w1', product: { name: 'A' } },
        { id: 'b2', product_id: 'p1', batch_number: 'L2', quantity: 4, warehouse_id: 'w2', product: { name: 'A' } },
        { id: 'b3', product_id: 'p2', batch_number: 'L3', quantity: 6, warehouse_id: 'w1', product: { name: 'B' } },
      ],
      [
        { id: 'w1', name: 'Principal' },
        { id: 'w2', name: 'Froid' },
      ],
    )
    const totals = totalsByWarehouse(rows)
    assert.deepEqual(totals, [
      { warehouse_name: 'Froid', quantity: 4 },
      { warehouse_name: 'Principal', quantity: 16 },
    ])
  })
})

describe('summarizeWarehouses', () => {
  it('counts batches and stock per warehouse', () => {
    const summary = summarizeWarehouses(
      [
        { id: 'w1', name: 'Principal', code: 'PRINCIPAL', is_cold: false },
        { id: 'w2', name: 'Froid', code: 'COLD-1', is_cold: true },
      ],
      [
        { id: 'b1', product_id: 'p1', batch_number: 'L1', quantity: 50, warehouse_id: 'w1' },
        { id: 'b2', product_id: 'p1', batch_number: 'L2', quantity: 20, warehouse_id: 'w1' },
        { id: 'b3', product_id: 'p2', batch_number: 'L3', quantity: 5, warehouse_id: 'w2' },
      ],
    )
    assert.equal(summary.length, 2)
    assert.equal(summary[0].code, 'PRINCIPAL')
    assert.equal(summary[0].batch_count, 2)
    assert.equal(summary[0].stock_quantity, 70)
    assert.equal(summary[0].is_cold, false)
    assert.equal(summary[1].batch_count, 1)
    assert.equal(summary[1].stock_quantity, 5)
    assert.equal(summary[1].is_cold, true)
  })
})
