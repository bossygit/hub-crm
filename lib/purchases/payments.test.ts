import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computePaymentStatus,
  validatePayment,
  supplierBalances,
  paidByPurchase,
  paymentMethodLabel,
  formatFCFA,
} from './payments.ts'

describe('computePaymentStatus', () => {
  it('est payée quand le montant payé couvre le total', () => {
    assert.equal(computePaymentStatus(1000, 1000), 'payee')
    assert.equal(computePaymentStatus(1000, 1500), 'payee')
  })

  it('est payée quand le total est nul (rien à payer)', () => {
    assert.equal(computePaymentStatus(0, 0), 'payee')
  })

  it('est partielle quand un paiement a eu lieu sans couvrir le total', () => {
    assert.equal(computePaymentStatus(1000, 250), 'partielle')
  })

  it('est impayée quand rien n’a été versé', () => {
    assert.equal(computePaymentStatus(1000, 0), 'impayee')
  })
})

describe('validatePayment', () => {
  it('accepte un paiement dans la limite du solde restant', () => {
    assert.equal(validatePayment({ amount: 250, totalAmount: 1000, alreadyPaid: 250 }), null)
  })

  it('refuse un montant nul ou négatif', () => {
    assert.match(validatePayment({ amount: 0, totalAmount: 1000 }) as string, /supérieur à zéro/)
    assert.match(validatePayment({ amount: -5, totalAmount: 1000 }) as string, /supérieur à zéro/)
    assert.match(validatePayment({ amount: NaN, totalAmount: 1000 }) as string, /supérieur à zéro/)
  })

  it('refuse le trop-perçu au-delà du solde restant', () => {
    assert.match(validatePayment({ amount: 900, totalAmount: 1000, alreadyPaid: 250 }) as string, /dépasse le solde restant/)
    assert.equal(validatePayment({ amount: 750, totalAmount: 1000, alreadyPaid: 250 }), null)
  })

  it('refuse un paiement quand il n’y a aucune dette', () => {
    assert.match(validatePayment({ amount: 100, totalAmount: 0 }) as string, /Aucun solde/)
  })
})

describe('supplierBalances (miroir de supplier_balance_snapshot)', () => {
  const base = [
    { supplier_id: 's1', supplier_name: 'Ferme Manioc', status: 'pending', total: 50000, paid: 0 },
    { supplier_id: 's1', supplier_name: 'Ferme Manioc', status: 'approved', total: 30000, paid: 30000 },
    { supplier_id: 's2', supplier_name: 'Scierie Congo', status: 'approved', total: 20000, paid: 5000 },
  ]

  it('agrège les montants et soldes par fournisseur', () => {
    const balances = supplierBalances(base)
    assert.equal(balances.length, 2)
    const s1 = balances.find(b => b.supplier_id === 's1')
    assert.deepEqual(
      { name: s1?.supplier_name, total: s1?.total_purchases, paid: s1?.total_paid, balance: s1?.balance },
      { name: 'Ferme Manioc', total: 80000, paid: 30000, balance: 50000 }
    )
  })

  it('ignore les achats brouillon et annulés', () => {
    const balances = supplierBalances([
      ...base,
      { supplier_id: 's1', supplier_name: 'Ferme Manioc', status: 'draft', total: 999999, paid: 0 },
      { supplier_id: 's2', supplier_name: 'Scierie Congo', status: 'cancelled', total: 999999, paid: 0 },
    ])
    const s1 = balances.find(b => b.supplier_id === 's1')
    const s2 = balances.find(b => b.supplier_id === 's2')
    assert.equal(s1?.total_purchases, 80000)
    assert.equal(s2?.total_purchases, 20000)
  })

  it('ignore les achats sans fournisseur identifié', () => {
    const balances = supplierBalances([
      ...base,
      { supplier_id: null, supplier_name: null, status: 'approved', total: 5000, paid: 0 },
    ])
    assert.equal(balances.length, 2)
  })

  it('tri par solde décroissant (plus grosse dette en tête)', () => {
    const balances = supplierBalances(base)
    assert.equal(balances[0].supplier_id, 's1')
    assert.equal(balances[1].supplier_id, 's2')
  })

  it('ignore les paiements attachés aux achats écartés (via le statut)', () => {
    const balances = supplierBalances([
      { supplier_id: 's3', supplier_name: '', status: 'cancelled', total: 10000, paid: 10000 },
    ])
    assert.equal(balances.length, 0)
  })
})

describe('paidByPurchase', () => {
  it('cumule les paiements par achat', () => {
    const map = paidByPurchase([
      { purchase_id: 'p1', amount: 1000 },
      { purchase_id: 'p1', amount: 2000 },
      { purchase_id: 'p2', amount: 500 },
    ])
    assert.equal(map.get('p1'), 3000)
    assert.equal(map.get('p2'), 500)
    assert.equal(map.has('p3'), false)
  })
})

describe('libellés / formats', () => {
  it('traduit les méthodes de paiement', () => {
    assert.equal(paymentMethodLabel('virement'), 'Virement')
    assert.equal(paymentMethodLabel('mobile'), 'Mobile Money')
    assert.equal(paymentMethodLabel('inconnu'), 'inconnu')
  })

  it('formate en FCFA', () => {
    assert.equal(formatFCFA(25000).replace(/\s/g, ' '), '25 000 FCFA')
    assert.equal(formatFCFA(0), '0 FCFA')
  })
})
