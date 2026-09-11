import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEGACY_EMPLOYEE_STATUS,
  EMPLOYEE_ACTIVE_STATUSES,
  EMPLOYEE_STATUS_VALUES,
  normalizeEmployeeStatus,
  isLegacyEmployeeStatus,
} from './employees.ts'

describe('normalizeEmployeeStatus', () => {
  it('traduit les statuts hérités en anglais', () => {
    assert.equal(normalizeEmployeeStatus('active'), 'actif')
    assert.equal(normalizeEmployeeStatus('on_leave'), 'conge')
    assert.equal(normalizeEmployeeStatus('terminated'), 'sorti')
  })

  it('laisse inchangés les statuts déjà applicatifs', () => {
    for (const s of ['actif', 'conge', 'suspendu', 'sorti']) {
      assert.equal(normalizeEmployeeStatus(s), s)
    }
  })

  it('retombe sur actif pour une valeur absente', () => {
    assert.equal(normalizeEmployeeStatus(null), 'actif')
    assert.equal(normalizeEmployeeStatus(undefined), 'actif')
    assert.equal(normalizeEmployeeStatus(''), 'actif')
  })
})

describe('isLegacyEmployeeStatus', () => {
  it('ne reconnaît que les valeurs héritées', () => {
    assert.equal(isLegacyEmployeeStatus('active'), true)
    assert.equal(isLegacyEmployeeStatus('actif'), false)
    assert.equal(isLegacyEmployeeStatus(null), false)
  })
})

describe('constantes', () => {
  it('couvre exactement les valeurs du CHECK élargi', () => {
    assert.deepEqual([...EMPLOYEE_STATUS_VALUES].sort(), [
      'actif', 'active', 'conge', 'on_leave', 'sorti', 'suspendu', 'terminated',
    ])
  })

  it('inclut les valeurs héritées dans les statuts en poste', () => {
    assert.ok(EMPLOYEE_ACTIVE_STATUSES.includes('actif'))
    assert.ok(EMPLOYEE_ACTIVE_STATUSES.includes('active'))
    assert.ok(!EMPLOYEE_ACTIVE_STATUSES.includes('terminated'))
    assert.equal(Object.keys(LEGACY_EMPLOYEE_STATUS).length, 3)
  })
})
