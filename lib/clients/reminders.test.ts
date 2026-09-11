import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  balanceDue,
  paidAmount,
  daysOverdue,
  isOverdue,
  nextReminderLevel,
  canRemind,
  planReminders,
  overdueOpenInvoices,
  buildReminderEmail,
  MAX_REMINDER_LEVEL,
  type ReminderInvoice,
} from './reminders.ts'

const now = new Date(2026, 8, 11) // 11/09/2026

const invoice = (over: Partial<ReminderInvoice> = {}): ReminderInvoice => ({
  id: 'i1',
  invoice_number: 'INV-001',
  client_id: 'c1',
  due_date: '2026-08-01',
  total: 100000,
  status: 'approved',
  ...over,
})

describe('paidAmount / balanceDue', () => {
  it('somme les paiements de la facture et calcule le solde', () => {
    const payments = [
      { invoice_id: 'i1', amount: 40000 },
      { invoice_id: 'i1', amount: 10000 },
      { invoice_id: 'i2', amount: 99999 },
    ]
    assert.equal(paidAmount(payments, 'i1'), 50000)
    assert.equal(balanceDue(invoice(), payments), 50000)
  })

  it('ne renvoie jamais un solde négatif', () => {
    assert.equal(balanceDue(invoice(), [{ invoice_id: 'i1', amount: 150000 }]), 0)
  })
})

describe('daysOverdue', () => {
  it('compte les jours de retard et renvoie 0 si non échu', () => {
    assert.equal(daysOverdue('2026-08-01', now), 41)
    assert.equal(daysOverdue('2026-09-11', now), 0)
    assert.equal(daysOverdue('2026-10-01', now), 0)
    assert.equal(daysOverdue(null, now), 0)
  })
})

describe('isOverdue', () => {
  it('exige un statut validé, un solde et une échéance dépassée', () => {
    assert.equal(isOverdue(invoice(), [], now), true)
    assert.equal(isOverdue(invoice({ status: 'pending' }), [], now), false, 'brouillon de créance non validé')
    assert.equal(isOverdue(invoice({ status: 'draft' }), [], now), false)
    assert.equal(isOverdue(invoice(), [{ invoice_id: 'i1', amount: 100000 }], now), false, 'déjà soldée')
    assert.equal(isOverdue(invoice({ due_date: '2026-12-01' }), [], now), false)
  })
})

describe('nextReminderLevel', () => {
  it('s incrémente et plafonne à 3', () => {
    assert.equal(nextReminderLevel([]), 1)
    assert.equal(nextReminderLevel([{ invoice_id: 'i1', created_at: '2026-08-01', level: 1 }]), 2)
    assert.equal(nextReminderLevel([
      { invoice_id: 'i1', created_at: '2026-08-01', level: 1 },
      { invoice_id: 'i1', created_at: '2026-08-10', level: 2 },
    ]), 3)
    assert.equal(nextReminderLevel([
      { invoice_id: 'i1', created_at: '2026-08-01', level: 1 },
      { invoice_id: 'i1', created_at: '2026-08-10', level: 2 },
      { invoice_id: 'i1', created_at: '2026-08-20', level: 3 },
    ]), MAX_REMINDER_LEVEL)
  })
})

describe('canRemind', () => {
  it('autorise une première relance', () => {
    const d = canRemind({ invoice: invoice(), payments: [], history: [], now, clientEmail: 'a@b.cg' })
    assert.equal(d.ok, true)
    assert.equal(d.level, 1)
    assert.equal(d.days, 41)
    assert.equal(d.balance, 100000)
  })

  it('refuse une facture non validée ou soldée', () => {
    assert.equal(canRemind({ invoice: invoice({ status: 'pending' }), payments: [], history: [], now }).reason, 'not_remindable')
    assert.equal(canRemind({ invoice: invoice(), payments: [{ invoice_id: 'i1', amount: 100000 }], history: [], now }).reason, 'not_remindable')
  })

  it('refuse une facture non échue', () => {
    assert.equal(canRemind({ invoice: invoice({ due_date: '2026-12-01' }), payments: [], history: [], now }).reason, 'not_overdue')
  })

  it('respecte le délai de carence', () => {
    const recent = [{ invoice_id: 'i1', created_at: '2026-09-08', level: 1 }]
    assert.equal(canRemind({ invoice: invoice(), payments: [], history: recent, now }).reason, 'cooldown')
    const old = [{ invoice_id: 'i1', created_at: '2026-08-01', level: 1 }]
    assert.equal(canRemind({ invoice: invoice(), payments: [], history: old, now }).ok, true)
  })

  it('signale un client sans email', () => {
    assert.equal(canRemind({ invoice: invoice(), payments: [], history: [], now, clientEmail: '' }).reason, 'no_email')
  })
})

describe('planReminders', () => {
  it('répartit les factures en à relancer / en carence / non échues', () => {
    const invoices = [
      invoice({ id: 'a', invoice_number: 'A' }),
      invoice({ id: 'b', invoice_number: 'B' }),
      invoice({ id: 'c', invoice_number: 'C', due_date: '2026-12-01' }),
      invoice({ id: 'd', invoice_number: 'D', status: 'draft' }),
    ]
    const reminders = [{ invoice_id: 'b', created_at: '2026-09-10', level: 1 }]
    const plan = planReminders(invoices, [], reminders, now)
    assert.deepEqual(plan.ready.map(r => r.invoice.id), ['a'])
    assert.deepEqual(plan.onCooldown.map(i => i.id), ['b'])
    assert.deepEqual(plan.notOverdue.map(i => i.id), ['c'])
  })
})

describe('overdueOpenInvoices', () => {
  it('inclut les factures en attente et trie par retard décroissant', () => {
    const rows = overdueOpenInvoices([
      invoice({ id: 'a', due_date: '2026-08-01', status: 'pending' }),
      invoice({ id: 'b', due_date: '2026-06-01', status: 'partial' }),
      invoice({ id: 'c', due_date: '2026-12-01', status: 'approved' }),
    ], [], now)
    assert.deepEqual(rows.map(r => r.invoice.id), ['b', 'a'])
    assert.equal(rows[0].days > rows[1].days, true)
  })
})

describe('buildReminderEmail', () => {
  it('adapte le sujet au niveau et contient le montant', () => {
    const l1 = buildReminderEmail({ clientName: 'Client X', invoiceNumber: 'INV-001', amountDue: 45000, dueDate: '2026-08-01', daysOverdue: 41, level: 1 })
    assert.match(l1.subject, /Rappel n°1/)
    assert.match(l1.subject, /INV-001/)
    assert.match(l1.subject, /45/)
    const l3 = buildReminderEmail({ clientName: 'Client X', invoiceNumber: 'INV-001', amountDue: 45000, level: 3 })
    assert.match(l3.subject, /Relance ferme n°3/)
    assert.match(l3.html, /Client X/)
    assert.match(l3.text, /Montant dû/)
  })

  it('plafonne le niveau au maximum', () => {
    const high = buildReminderEmail({ clientName: 'X', invoiceNumber: 'I', amountDue: 1, level: 99 })
    assert.match(high.subject, /n°3/)
  })
})
