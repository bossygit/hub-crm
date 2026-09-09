import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isLotUsable,
  newBatchQualityStatus,
  qualityDecisionEffect,
} from './release.ts'
import { suggestFefoBatch } from '../stock/traceability.ts'
import { allocateFefo } from '../production/bom.ts'

describe('isLotUsable', () => {
  it('allows released lots with remaining quantity', () => {
    assert.equal(isLotUsable({ quantity: 10, quality_status: 'released' }), true)
  })

  it('treats a missing status as released so existing lots stay usable', () => {
    assert.equal(isLotUsable({ quantity: 5 }), true)
    assert.equal(isLotUsable({ quantity: 5, quality_status: null }), true)
  })

  it('blocks pending, rejected, or empty lots', () => {
    assert.equal(isLotUsable({ quantity: 10, quality_status: 'pending' }), false)
    assert.equal(isLotUsable({ quantity: 10, quality_status: 'rejected' }), false)
    assert.equal(isLotUsable({ quantity: 0, quality_status: 'released' }), false)
  })
})

describe('qualityDecisionEffect', () => {
  it('releases a pending lot without moving stock', () => {
    assert.equal(qualityDecisionEffect('pending', 'released'), 'release')
  })

  it('scraps a pending lot on reject', () => {
    assert.equal(qualityDecisionEffect('pending', 'rejected'), 'scrap')
  })

  it('does nothing unless the lot is pending', () => {
    assert.equal(qualityDecisionEffect('released', 'rejected'), 'none')
    assert.equal(qualityDecisionEffect('pending', 'pending'), 'none')
    assert.equal(qualityDecisionEffect('rejected', 'released'), 'none')
  })
})

describe('newBatchQualityStatus', () => {
  it('puts purchase and production lots in quality hold', () => {
    assert.equal(newBatchQualityStatus(), 'pending')
  })
})

describe('FEFO skips lots that are not released', () => {
  const batches = [
    { id: 'held', product_id: 'farine', quantity: 20, expiry_date: '2026-09-01', quality_status: 'pending' as const },
    { id: 'ok', product_id: 'farine', quantity: 4, expiry_date: '2026-10-01', quality_status: 'released' as const },
    { id: 'scrap', product_id: 'farine', quantity: 8, expiry_date: '2026-08-01', quality_status: 'rejected' as const },
  ]

  it('suggests the next released lot, not the soonest quarantined one', () => {
    assert.equal(suggestFefoBatch(batches, 'farine'), 'ok')
  })

  it('does not allocate quarantined lots in production', () => {
    const { allocations, shortfall } = allocateFefo(batches, 'farine', 10)
    assert.deepEqual(allocations, [{ batch_id: 'ok', quantity: 4 }])
    assert.equal(shortfall, 6)
  })
})
