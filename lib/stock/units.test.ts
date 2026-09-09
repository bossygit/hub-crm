import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  toBaseQty,
  toStockLine,
  inventoryVariance,
  stockAdjustDelta,
  buildInventorySnapshot,
} from './units.ts'

const packs = [
  { unit: 'sac', factor: 50 },
  { unit: 'carton', factor: 10 },
]

describe('toBaseQty', () => {
  it('keeps quantity when the unit is already the product base', () => {
    assert.equal(toBaseQty(3, 'kg', 'kg', packs), 3)
  })

  it('multiplies pack quantity by the product factor', () => {
    assert.equal(toBaseQty(2, 'sac', 'kg', packs), 100)
    assert.equal(toBaseQty(1, 'carton', 'kg', packs), 10)
  })

  it('treats an unknown unit as already in base so old lines keep working', () => {
    assert.equal(toBaseQty(4, 'pièce', 'kg', packs), 4)
  })
})

describe('toStockLine', () => {
  it('converts qty to base and rescales the unit price so the line total is unchanged', () => {
    const line = toStockLine(2, 'sac', 25000, 'kg', packs)
    assert.equal(line.quantity, 100)
    assert.equal(line.unit, 'kg')
    assert.equal(line.unit_price, 500)
    assert.equal(line.quantity * line.unit_price, 50000)
  })
})

describe('inventoryVariance', () => {
  it('is counted minus theoretical', () => {
    assert.equal(inventoryVariance(10, 8), -2)
    assert.equal(inventoryVariance(10, 12), 2)
    assert.equal(inventoryVariance(5, 5), 0)
  })
})

describe('stockAdjustDelta', () => {
  it('applies a signed ADJUST to on-hand quantity', () => {
    assert.equal(stockAdjustDelta(10, -2), 8)
    assert.equal(stockAdjustDelta(10, 3), 13)
  })
})

describe('buildInventorySnapshot', () => {
  it('opens one line per usable lot and a leftover unbatched line', () => {
    const lines = buildInventorySnapshot(
      [{ id: 'farine', name: 'Farine', quantity: 80, unit: 'kg' }],
      [
        { id: 'b1', product_id: 'farine', batch_number: 'L1', quantity: 50, quality_status: 'released' },
        { id: 'b2', product_id: 'farine', batch_number: 'L2', quantity: 20, quality_status: 'pending' },
        { id: 'scrap', product_id: 'farine', batch_number: 'X', quantity: 0, quality_status: 'rejected' },
      ],
    )
    assert.equal(lines.length, 3)
    assert.deepEqual(lines.map(l => ({ batch_id: l.batch_id, theoretical: l.theoretical })), [
      { batch_id: 'b1', theoretical: 50 },
      { batch_id: 'b2', theoretical: 20 },
      { batch_id: null, theoretical: 10 },
    ])
  })
})
