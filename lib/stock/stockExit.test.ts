import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deliveryNoteAffectsStock } from './stockExit.ts'

describe('deliveryNoteAffectsStock', () => {
  it('does not move stock when the delivery note is linked to an invoice', () => {
    assert.equal(deliveryNoteAffectsStock('inv-uuid'), false)
  })

  it('moves stock when the delivery note is standalone', () => {
    assert.equal(deliveryNoteAffectsStock(null), true)
    assert.equal(deliveryNoteAffectsStock(undefined), true)
    assert.equal(deliveryNoteAffectsStock(''), true)
  })
})
