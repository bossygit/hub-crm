import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeYieldPct,
  yieldBadgeClass,
  yieldLabel,
  yieldLevel,
  validateActualOutput,
} from './yield.ts'

describe('computeYieldPct', () => {
  it('retourne null quand aucune quantité réelle n\'est enregistrée', () => {
    assert.equal(computeYieldPct(null, 10), null)
    assert.equal(computeYieldPct(undefined, 10), null)
  })

  it('calcule réel / planifié en %, arrondi à 1 décimale', () => {
    assert.equal(computeYieldPct(10, 10), 100)
    assert.equal(computeYieldPct(9.2, 10), 92)
    assert.equal(computeYieldPct(12.34, 10), 123.4)
    assert.equal(computeYieldPct(3, 10), 30)
    assert.equal(computeYieldPct(0, 10), 0)
  })

  it('est null-safe quand le planifié est manquant ou non positif', () => {
    assert.equal(computeYieldPct(5, 0), null)
    assert.equal(computeYieldPct(5, -1), null)
    assert.equal(computeYieldPct(5, NaN), null)
  })

  it('accepte les chaînes numériques (numeric PostgREST)', () => {
    assert.equal(computeYieldPct(Number('9.2'), Number('10')), 92)
  })
})

describe('yieldLevel', () => {
  it('classe le rendement en attendu / correct / faible', () => {
    assert.equal(yieldLevel(100), 'expected')
    assert.equal(yieldLevel(140), 'expected')
    assert.equal(yieldLevel(99.9), 'good')
    assert.equal(yieldLevel(90), 'good')
    assert.equal(yieldLevel(89.9), 'low')
    assert.equal(yieldLevel(0), 'low')
  })

  it('retourne null quand le rendement n\'est pas saisi', () => {
    assert.equal(yieldLevel(null), null)
  })
})

describe('yieldLabel', () => {
  it('traduit le rendement en libellé français', () => {
    assert.equal(yieldLabel(100), 'Rendement attendu')
    assert.equal(yieldLabel(92), 'Correct')
    assert.equal(yieldLabel(50), 'Faible')
    assert.equal(yieldLabel(null), '—')
  })
})

describe('yieldBadgeClass', () => {
  it('associe une couleur au niveau de rendement', () => {
    assert.equal(yieldBadgeClass(100), 'badge-green')
    assert.equal(yieldBadgeClass(92), 'badge-amber')
    assert.equal(yieldBadgeClass(50), 'badge-red')
    assert.equal(yieldBadgeClass(null), 'badge-gray')
  })
})

describe('validateActualOutput', () => {
  it('accepte un champ vide (null) : pas de rendement saisi', () => {
    assert.equal(validateActualOutput(null, 10), null)
  })

  it('refuse les quantités non positives', () => {
    assert.ok(validateActualOutput(0, 10))
    assert.ok(validateActualOutput(-2, 10))
  })

  it('refuse les valeurs non numériques', () => {
    assert.ok(validateActualOutput(NaN, 10))
    assert.ok(validateActualOutput(Infinity, 10))
  })

  it('accepte un rendement réaliste, y compris légèrement au-delà du planifié', () => {
    assert.equal(validateActualOutput(9.5, 10), null)
    assert.equal(validateActualOutput(29.99, 10), null)
  })

  it('refuse au-delà de 3 × le planifié (erreur de saisie probable)', () => {
    assert.ok(validateActualOutput(30.01, 10))
  })

  it('ignore la borne haute quand le planifié est non positif', () => {
    assert.equal(validateActualOutput(5, 0), null)
    assert.equal(validateActualOutput(25, 0), null)
  })
})
