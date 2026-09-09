import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  allocateFefo,
  explodeRecipe,
  productionStockEffect,
  scaleIngredientQty,
  suggestProductionBatchNumber,
} from './bom.ts'

describe('productionStockEffect', () => {
  it('consumes MP and creates PF stock when an order is completed', () => {
    assert.equal(productionStockEffect('draft', 'approved'), 'complete')
    assert.equal(productionStockEffect('pending', 'approved'), 'complete')
  })

  it('reverses stock when a completed order is cancelled', () => {
    assert.equal(productionStockEffect('approved', 'cancelled'), 'reverse')
  })

  it('does not move stock otherwise', () => {
    assert.equal(productionStockEffect('draft', 'pending'), 'none')
    assert.equal(productionStockEffect('cancelled', 'approved'), 'none')
  })
})

describe('scaleIngredientQty', () => {
  it('scales recipe quantities to the produced amount', () => {
    assert.equal(scaleIngredientQty(2, 10, 25), 5)
    assert.equal(scaleIngredientQty(1, 1, 8), 8)
  })

  it('returns 0 when the recipe output is missing', () => {
    assert.equal(scaleIngredientQty(2, 0, 10), 0)
  })
})

describe('allocateFefo', () => {
  const batches = [
    { id: 'later', product_id: 'manioc', quantity: 20, expiry_date: '2026-12-01' },
    { id: 'sooner', product_id: 'manioc', quantity: 8, expiry_date: '2026-10-01' },
    { id: 'empty', product_id: 'manioc', quantity: 0, expiry_date: '2026-09-01' },
    { id: 'other', product_id: 'huile', quantity: 50, expiry_date: '2026-09-01' },
  ]

  it('takes soonest expiry first and splits across lots', () => {
    const { allocations, shortfall } = allocateFefo(batches, 'manioc', 12)
    assert.equal(shortfall, 0)
    assert.deepEqual(allocations, [
      { batch_id: 'sooner', quantity: 8 },
      { batch_id: 'later', quantity: 4 },
    ])
  })

  it('reports shortfall when lots are not enough', () => {
    const { allocations, shortfall } = allocateFefo(batches, 'manioc', 40)
    assert.equal(shortfall, 12)
    assert.equal(allocations.reduce((s, a) => s + a.quantity, 0), 28)
  })
})

describe('explodeRecipe', () => {
  it('scales ingredients and allocates FEFO lots per product', () => {
    const { lines, shortfalls } = explodeRecipe(
      [
        { product_id: 'manioc', name: 'Manioc', quantity: 2, unit: 'kg' },
        { product_id: 'huile', name: 'Huile', quantity: 1, unit: 'L' },
      ],
      10,
      20,
      [
        { id: 'm1', product_id: 'manioc', quantity: 10, expiry_date: '2026-10-01' },
        { id: 'h1', product_id: 'huile', quantity: 5, expiry_date: '2026-11-01' },
      ],
    )
    assert.equal(shortfalls.length, 0)
    assert.deepEqual(lines, [
      { product_id: 'manioc', name: 'Manioc', unit: 'kg', quantity: 4, batch_id: 'm1' },
      { product_id: 'huile', name: 'Huile', unit: 'L', quantity: 2, batch_id: 'h1' },
    ])
  })
})

describe('suggestProductionBatchNumber', () => {
  it('uses the production order number', () => {
    assert.equal(suggestProductionBatchNumber('PROD-2026-0004'), 'PROD-2026-0004')
  })
})
