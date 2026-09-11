import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isStrongPassword, passwordError } from './password.ts'

describe('password policy', () => {
  it('accepts a password matching all required character classes', () => {
    assert.equal(isStrongPassword('HubDistribution!2026'), true)
    assert.equal(passwordError('HubDistribution!2026'), null)
  })

  it('rejects passwords that miss a required criterion', () => {
    assert.match(passwordError('Court!2026') || '', /12 caractères/)
    assert.match(passwordError('hubdistribution!2026') || '', /majuscule/)
    assert.match(passwordError('HUBDISTRIBUTION!2026') || '', /minuscule/)
    assert.match(passwordError('HubDistribution!') || '', /chiffre/)
    assert.match(passwordError('HubDistribution2026') || '', /spécial/)
  })
})
