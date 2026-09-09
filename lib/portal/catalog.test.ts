import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  cartTotals,
  formatFCFA,
  orderStatusBadge,
  orderStatusLabel,
  validateOrderForm,
} from './catalog.ts'

describe('cartTotals', () => {
  it('returns a subtotal of 0 for an empty cart', () => {
    assert.deepEqual(cartTotals([]), { subtotal: 0 })
  })

  it('sums quantity × unit price for each line', () => {
    const lines = [
      { quantity: 3, unit_price: 3500 },
      { quantity: 2, unit_price: 1000 },
      { quantity: 1, unit_price: 6000 },
    ]
    assert.deepEqual(cartTotals(lines), { subtotal: 18500 })
  })

  it('rounds decimal products to avoid float drift', () => {
    assert.deepEqual(cartTotals([{ quantity: 0.1, unit_price: 0.3 }]), { subtotal: 0.03 })
  })

  it('ignores missing or non numeric quantity/price', () => {
    assert.deepEqual(cartTotals([{ quantity: 2, unit_price: 500 }] as never), { subtotal: 1000 })
    assert.deepEqual(cartTotals(undefined as never), { subtotal: 0 })
  })
})

describe('orderStatusLabel', () => {
  it('returns a French label for each order status', () => {
    assert.equal(orderStatusLabel('nouvelle'), 'Nouvelle')
    assert.equal(orderStatusLabel('en_cours'), 'En cours')
    assert.equal(orderStatusLabel('pret'), 'Prête')
    assert.equal(orderStatusLabel('livree'), 'Livrée')
    assert.equal(orderStatusLabel('convertie'), 'Convertie')
    assert.equal(orderStatusLabel('annulee'), 'Annulée')
  })

  it('falls back to the raw status for unknown values', () => {
    assert.equal(orderStatusLabel('inconnu'), 'inconnu')
  })
})

describe('orderStatusBadge', () => {
  it('returns a distinct { bg, fg } color pair per status', () => {
    const seen = new Set<string>()
    for (const status of ['nouvelle', 'en_cours', 'pret', 'livree', 'convertie', 'annulee']) {
      const c = orderStatusBadge(status)
      assert.ok(c.bg && c.fg)
      seen.add(c.bg)
    }
    assert.equal(seen.size, 6)
  })

  it('uses a neutral grey for unknown statuses', () => {
    assert.deepEqual(orderStatusBadge('whatever'), { bg: '#f3f4f6', fg: '#374151' })
  })
})

describe('formatFCFA', () => {
  it('formats French thousands separators', () => {
    assert.equal(formatFCFA(3500), '3 500 FCFA')
    assert.equal(formatFCFA(18500), '18 500 FCFA')
  })

  it('handles zero and empty values', () => {
    assert.equal(formatFCFA(0), '0 FCFA')
    assert.equal(formatFCFA(null), '0 FCFA')
    assert.equal(formatFCFA(undefined), '0 FCFA')
  })

  it('rounds to whole FCFA', () => {
    assert.equal(formatFCFA(12.6), '13 FCFA')
  })
})

describe('validateOrderForm', () => {
  it('requires customer name and phone', () => {
    const errors = validateOrderForm({
      customer_name: '',
      customer_phone: '',
      lines: [{ quantity: 1, unit_price: 2000 }],
    })
    assert.ok(errors.customer_name)
    assert.ok(errors.customer_phone)
    assert.equal(errors.lines, undefined)
  })

  it('trims whitespace-only values before validating', () => {
    const errors = validateOrderForm({
      customer_name: '   ',
      customer_phone: '\n\t',
      lines: [],
    })
    assert.ok(errors.customer_name)
    assert.ok(errors.customer_phone)
  })

  it('rejects an empty cart', () => {
    const errors = validateOrderForm({ customer_name: 'Jean', customer_phone: '+242', lines: [] })
    assert.equal(errors.lines, 'Votre panier est vide.')
    assert.equal(errors.customer_name, undefined)
  })

  it('rejects non positive quantities', () => {
    const errors = validateOrderForm({
      customer_name: 'Jean',
      customer_phone: '+242',
      lines: [
        { quantity: 2, unit_price: 1000 },
        { quantity: 0, unit_price: 500 },
      ],
    })
    assert.ok(errors.lines)
    assert.match(errors.lines!, /supérieure à zéro/)
  })

  it('returns no errors for a valid order', () => {
    const errors = validateOrderForm({
      customer_name: 'Mariam Bakala',
      customer_phone: '+242 06 123 45 67',
      lines: [{ quantity: 4, unit_price: 3500 }],
    })
    assert.deepEqual(errors, {})
  })
})
