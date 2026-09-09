import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CCP_SUGGESTIONS,
  computeCoaConclusion,
  formatCoaNumber,
  formatCcpNumber,
  isAutoOk,
  limitsLabel,
  parseNumericValue,
  parseParameters,
  validateParameters,
} from './coa.ts'
import type { CoaParameter } from './coa.ts'

describe('parseNumericValue', () => {
  it('parses integer and decimal values', () => {
    assert.equal(parseNumericValue('5'), 5)
    assert.equal(parseNumericValue('8.5'), 8.5)
    assert.equal(parseNumericValue(' 7 '), 7)
  })

  it('accepts the French decimal comma', () => {
    assert.equal(parseNumericValue('5,5'), 5.5)
    assert.equal(parseNumericValue('0,25'), 0.25)
  })

  it('returns null for empty or non-numeric input', () => {
    assert.equal(parseNumericValue(''), null)
    assert.equal(parseNumericValue('  '), null)
    assert.equal(parseNumericValue('abc'), null)
    assert.equal(parseNumericValue('5°C'), null)
    assert.equal(parseNumericValue(undefined as unknown as string), null)
  })
})

describe('isAutoOk', () => {
  it('is always true when no limits are defined', () => {
    assert.equal(isAutoOk('présent'), true)
    assert.equal(isAutoOk('', undefined, undefined), true)
  })

  it('respects a min limit', () => {
    assert.equal(isAutoOk('5', 2, undefined), true)
    assert.equal(isAutoOk('1', 2, undefined), false)
  })

  it('respects a max limit', () => {
    assert.equal(isAutoOk('7', undefined, 8), true)
    assert.equal(isAutoOk('9', undefined, 8), false)
  })

  it('respects a min/max window', () => {
    assert.equal(isAutoOk('5', 2, 8), true)
    assert.equal(isAutoOk('2', 2, 8), true)
    assert.equal(isAutoOk('8', 2, 8), true)
    assert.equal(isAutoOk('1.9', 2, 8), false)
    assert.equal(isAutoOk('8.1', 2, 8), false)
  })

  it('is false when a limit exists but the value is not numeric', () => {
    assert.equal(isAutoOk('chaud', 2, 8), false)
    assert.equal(isAutoOk('', 0, undefined), false)
  })
})

describe('computeCoaConclusion', () => {
  it('declares conforme when every parameter is ok', () => {
    const params: CoaParameter[] = [
      { label: 'Température', value: '5', min: 0, max: 8, ok: true },
      { label: 'Aspect', value: 'Propre', ok: true },
    ]
    assert.equal(computeCoaConclusion(params), 'conforme')
  })

  it('declares non_conforme when a single parameter fails (even overridden)', () => {
    const params: CoaParameter[] = [
      { label: 'Température', value: '5', min: 0, max: 4, ok: false },
      { label: 'Aspect', value: 'Propre', ok: true },
    ]
    assert.equal(computeCoaConclusion(params), 'non_conforme')
  })

  it('honours a manual override on ok', () => {
    const params: CoaParameter[] = [
      { label: 'pH', value: '5.5', min: 5, max: 8, ok: true }, // auto : conforme
      { label: 'Goût', value: 'Anormal', ok: false }, // override manuel
    ]
    assert.equal(computeCoaConclusion(params), 'non_conforme')
  })

  it('declares non_conforme for an empty parameter list', () => {
    assert.equal(computeCoaConclusion([]), 'non_conforme')
  })
})

describe('validateParameters', () => {
  it('rejects an empty list', () => {
    assert.deepEqual(validateParameters([]), ['Ajoutez au moins un paramètre d\u2019analyse.'])
  })

  it('requires a label and a measured value on each row', () => {
    const errors = validateParameters([{ label: '', value: '5', ok: true }, { label: 'pH', value: '', ok: true }])
    assert.ok(errors.some(e => e.includes('libellé du paramètre est requis')))
    assert.ok(errors.some(e => e.includes('la valeur mesurée est requise')))
  })

  it('requires a numeric value when limits are present', () => {
    const errors = validateParameters([{ label: 'Température', value: 'tiede', min: 0, max: 8, ok: false }])
    assert.ok(errors.some(e => e.includes('doit être numérique')))
  })

  it('rejects inverted min/max limits', () => {
    const errors = validateParameters([{ label: 'Température', value: '5', min: 8, max: 0, ok: false }])
    assert.ok(errors.some(e => e.includes('limite minimale est supérieure')))
  })

  it('accepts a valid parameter set', () => {
    const params: CoaParameter[] = [
      { label: 'Température', value: '5', min: 0, max: 8, ok: true },
      { label: 'Humidité', value: '12,5', max: 15, unit: '%', ok: true },
    ]
    assert.deepEqual(validateParameters(params), [])
  })

  it('does not require numeric values when there are no limits', () => {
    const params: CoaParameter[] = [{ label: 'Aspect visuel', value: 'Propre et sec', ok: true }]
    assert.deepEqual(validateParameters(params), [])
  })
})

describe('formatCoaNumber / formatCcpNumber', () => {
  it('formats COA-YYYY-XXXX', () => {
    assert.equal(formatCoaNumber(2026, 7), 'COA-2026-0007')
    assert.equal(formatCoaNumber('2026', 1234), 'COA-2026-1234')
    assert.equal(formatCoaNumber(2025, 1), 'COA-2025-0001')
  })

  it('formats CCP-YYYY-XXXX', () => {
    assert.equal(formatCcpNumber(2026, 12), 'CCP-2026-0012')
  })
})

describe('limitsLabel', () => {
  it('renders windows, single bounds and dashes', () => {
    assert.equal(limitsLabel({ min: 2, max: 8 }), '2 – 8')
    assert.equal(limitsLabel({ min: 0 }), '≥ 0')
    assert.equal(limitsLabel({ max: 8 }), '≤ 8')
    assert.equal(limitsLabel({}), '—')
    assert.equal(limitsLabel({ min: null, max: null }), '—')
  })
})

describe('parseParameters', () => {
  it('returns an empty list for non-array input', () => {
    assert.deepEqual(parseParameters(null), [])
    assert.deepEqual(parseParameters({ a: 1 }), [])
    assert.deepEqual(parseParameters('nope'), [])
  })

  it('skips malformed rows and coerces numbers', () => {
    const parsed = parseParameters([
      { label: 'Température', value: '5', min: 0, max: 8 },
      { label: 'Humidité', value: '12,5', min: '0', max: '15', unit: '%', ok: false },
      { nope: true },
      'junk',
    ])
    assert.equal(parsed.length, 2)
    assert.equal(parsed[0].min, 0)
    assert.equal(parsed[0].max, 8)
    assert.equal(parsed[0].ok, true) // ok absent -> conformité auto
    assert.equal(parsed[1].min, 0)
    assert.equal(parsed[1].max, 15)
    assert.equal(parsed[1].unit, '%')
    assert.equal(parsed[1].ok, false) // ok explicite conservé
  })

  it('ignores rows without label or value strings', () => {
    const parsed = parseParameters([{ label: 5, value: 'x' }, { label: 'x' }])
    assert.deepEqual(parsed, [])
  })
})

describe('CCP_SUGGESTIONS', () => {
  it('exposes the HACCP checkpoint catalogue', () => {
    assert.ok(CCP_SUGGESTIONS.includes('Température de réception'))
    assert.ok(CCP_SUGGESTIONS.includes('pH'))
    assert.ok(CCP_SUGGESTIONS.includes('Emballage et étiquetage'))
  })
})
