import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  purchaseStockEffect,
  resolvePurchaseBatchNumber,
  suggestPurchaseBatchNumber,
} from './receipt.ts'

describe('purchaseStockEffect', () => {
  it('receives stock when a draft or pending purchase is approved', () => {
    assert.equal(purchaseStockEffect('draft', 'approved'), 'receive')
    assert.equal(purchaseStockEffect('pending', 'approved'), 'receive')
  })

  it('reverses stock when an approved purchase is cancelled', () => {
    assert.equal(purchaseStockEffect('approved', 'cancelled'), 'reverse')
  })

  it('does not move stock for other transitions', () => {
    assert.equal(purchaseStockEffect('draft', 'pending'), 'none')
    assert.equal(purchaseStockEffect('approved', 'approved'), 'none')
    assert.equal(purchaseStockEffect('cancelled', 'approved'), 'none')
  })
})

describe('resolvePurchaseBatchNumber', () => {
  it('keeps an explicit lot number', () => {
    assert.equal(resolvePurchaseBatchNumber('LOT-MANIOC-01', 'ACH-2026-0003', 0), 'LOT-MANIOC-01')
  })

  it('falls back to purchase number plus line index when the lot is empty', () => {
    assert.equal(suggestPurchaseBatchNumber('ACH-2026-0003', 0), 'ACH-2026-0003-L1')
    assert.equal(resolvePurchaseBatchNumber('  ', 'ACH-2026-0003', 2), 'ACH-2026-0003-L3')
    assert.equal(resolvePurchaseBatchNumber(null, 'ACH-2026-0003', 0), 'ACH-2026-0003-L1')
  })
})
