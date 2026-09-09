import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isBlindSession,
  hasRevealedGaps,
  masksTheoretical,
  canRevealGaps,
  theoreticalVisible,
  hasUncountedLines,
} from './inventoryBlind.ts'

const blindDraft = { status: 'draft', blind: true, revealed_at: null }
const blindRevealed = { status: 'draft', blind: true, revealed_at: '2026-09-09T10:00:00Z' }
const blindApproved = { status: 'approved', blind: true, revealed_at: null }
const blindCancelled = { status: 'cancelled', blind: true, revealed_at: null }
const normalDraft = { status: 'draft', blind: false, revealed_at: null }

describe('isBlindSession', () => {
  it('detects blind flag regardless of status', () => {
    assert.equal(isBlindSession(blindDraft), true)
    assert.equal(isBlindSession(blindApproved), true)
    assert.equal(isBlindSession(normalDraft), false)
    assert.equal(isBlindSession(null), false)
    assert.equal(isBlindSession(undefined), false)
  })
})

describe('hasRevealedGaps', () => {
  it('is true only once revealed_at is set on a blind session', () => {
    assert.equal(hasRevealedGaps(blindDraft), false)
    assert.equal(hasRevealedGaps(blindRevealed), true)
    assert.equal(hasRevealedGaps(normalDraft), false)
  })
})

describe('masksTheoretical', () => {
  it('masks only an open (draft), unrevealed blind session', () => {
    assert.equal(masksTheoretical(blindDraft), true)
    assert.equal(masksTheoretical(blindRevealed), false)
    // Validée ou annulée sans révélation : le résultat doit rester consultable.
    assert.equal(masksTheoretical(blindApproved), false)
    assert.equal(masksTheoretical(blindCancelled), false)
    assert.equal(masksTheoretical(normalDraft), false)
    assert.equal(masksTheoretical(null), false)
  })
})

describe('canRevealGaps', () => {
  it('allows a manager to reveal while the blind count is still open', () => {
    assert.equal(canRevealGaps(blindDraft), true)
    assert.equal(canRevealGaps(blindRevealed), false)
    assert.equal(canRevealGaps(blindApproved), false)
    assert.equal(canRevealGaps(normalDraft), false)
  })
})

describe('theoreticalVisible', () => {
  it('is the inverse of the masking state', () => {
    assert.equal(theoreticalVisible(blindDraft), false)
    assert.equal(theoreticalVisible(blindRevealed), true)
    assert.equal(theoreticalVisible(blindApproved), true)
    assert.equal(theoreticalVisible(normalDraft), true)
  })
})

describe('hasUncountedLines', () => {
  it('flags any line left blank during a blind count', () => {
    assert.equal(hasUncountedLines([]), false)
    assert.equal(hasUncountedLines([{ entry_quantity: 5 }]), false)
    assert.equal(hasUncountedLines([{ entry_quantity: 0 }]), false) // zéro compté volontairement
    assert.equal(hasUncountedLines([{ entry_quantity: null }]), true)
    assert.equal(hasUncountedLines([{ entry_quantity: '' }]), true)
    assert.equal(hasUncountedLines([{ counted: 10 }]), true) // jamais saisie
    assert.equal(hasUncountedLines([{ entry_quantity: 5 }, { entry_quantity: '' }]), true)
  })
})
