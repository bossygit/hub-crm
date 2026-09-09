import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canAccessPath,
  homeForRole,
  isPublicPath,
  isRegisterOpen,
  isRegisterPath,
} from './access.ts'

describe('homeForRole', () => {
  it('sends partners to the public portal', () => {
    assert.equal(homeForRole('partner'), '/portal')
  })

  it('sends staff to the dashboard', () => {
    assert.equal(homeForRole('employee'), '/dashboard')
    assert.equal(homeForRole('admin'), '/dashboard')
    assert.equal(homeForRole(null), '/dashboard')
  })
})

describe('isPublicPath', () => {
  it('allows login and portal without a session', () => {
    assert.equal(isPublicPath('/login'), true)
    assert.equal(isPublicPath('/portal'), true)
    assert.equal(isPublicPath('/portal/jobs'), true)
  })

  it('does not treat /register as public', () => {
    assert.equal(isPublicPath('/register'), false)
    assert.equal(isPublicPath('/dashboard'), false)
  })
})

describe('isRegisterPath', () => {
  it('matches the register route', () => {
    assert.equal(isRegisterPath('/register'), true)
    assert.equal(isRegisterPath('/login'), false)
  })
})

describe('isRegisterOpen', () => {
  it('is open only when no profile exists yet', () => {
    assert.equal(isRegisterOpen(0), true)
    assert.equal(isRegisterOpen(1), false)
    assert.equal(isRegisterOpen(12), false)
  })
})

describe('canAccessPath', () => {
  it('confines partners to the portal', () => {
    assert.equal(canAccessPath('partner', '/portal'), true)
    assert.equal(canAccessPath('partner', '/dashboard'), false)
    assert.equal(canAccessPath('partner', '/invoices'), false)
    assert.equal(canAccessPath('partner', '/admin/users'), false)
  })

  it('keeps existing staff restrictions', () => {
    assert.equal(canAccessPath('employee', '/dashboard'), true)
    assert.equal(canAccessPath('employee', '/reports'), false)
    assert.equal(canAccessPath('manager', '/reports'), true)
    assert.equal(canAccessPath('manager', '/admin'), false)
    assert.equal(canAccessPath('admin', '/admin/users'), true)
    assert.equal(canAccessPath('ceo', '/admin'), true)
  })

  it('lets staff open the public portal', () => {
    assert.equal(canAccessPath('employee', '/portal'), true)
  })
})
