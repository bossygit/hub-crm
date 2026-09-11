import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEAVE_TYPES,
  leaveConsumesBalance,
  leaveTypeLabel,
  workingDays,
  parseDateOnly,
  toDateKey,
  rangesOverlap,
  findOverlappingLeave,
  usedLeaveDays,
  remainingDays,
  balanceIsLow,
  buildMonthCalendar,
  overloadedDays,
} from './leaves.ts'

describe('types de congé', () => {
  it('ne fait consommer le solde qu au congé annuel', () => {
    assert.equal(leaveConsumesBalance('annuel'), true)
    for (const code of ['maladie', 'sans_solde', 'exceptionnel', 'maternite']) {
      assert.equal(leaveConsumesBalance(code), false, `${code} ne doit pas consommer le solde`)
    }
    assert.equal(LEAVE_TYPES.annuel.consumesBalance, true)
  })

  it('traite un type inconnu comme hors solde', () => {
    assert.equal(leaveConsumesBalance('inconnu'), false)
    assert.equal(leaveConsumesBalance(null), false)
    assert.equal(leaveTypeLabel('maladie'), 'Conge maladie')
  })
})

describe('workingDays', () => {
  it('compte les jours ouvrés bornes incluses', () => {
    // lundi 07/09/2026 -> vendredi 11/09/2026
    assert.equal(workingDays('2026-09-07', '2026-09-11'), 5)
  })

  it('exclut les week-ends', () => {
    // vendredi 11/09 -> lundi 14/09 = 2 jours ouvrés
    assert.equal(workingDays('2026-09-11', '2026-09-14'), 2)
  })

  it('renvoie 0 sur une période inversée ou incomplète', () => {
    assert.equal(workingDays('2026-09-11', '2026-09-01'), 0)
    assert.equal(workingDays('', '2026-09-01'), 0)
    assert.equal(workingDays(null, null), 0)
  })
})

describe('parseDateOnly', () => {
  it('interprète YYYY-MM-DD en date locale sans dérive de fuseau', () => {
    const d = parseDateOnly('2026-09-07')
    assert.equal(d?.getFullYear(), 2026)
    assert.equal(d?.getMonth(), 8)
    assert.equal(d?.getDate(), 7)
    assert.equal(toDateKey('2026-09-07'), '2026-09-07')
  })

  it('renvoie null sur une valeur invalide', () => {
    assert.equal(parseDateOnly('pas-une-date'), null)
    assert.equal(parseDateOnly(undefined), null)
  })
})

describe('rangesOverlap / findOverlappingLeave', () => {
  it('détecte un chevauchement inclusif', () => {
    assert.equal(rangesOverlap('2026-09-01', '2026-09-10', '2026-09-10', '2026-09-15'), true)
    assert.equal(rangesOverlap('2026-09-01', '2026-09-10', '2026-09-11', '2026-09-15'), false)
  })

  it('ignore la demande éditée et les statuts non bloquants', () => {
    const leaves = [
      { id: 'a', start_date: '2026-09-01', end_date: '2026-09-10', status: 'approved' },
      { id: 'b', start_date: '2026-09-01', end_date: '2026-09-10', status: 'rejected' },
    ]
    assert.equal(findOverlappingLeave(leaves, '2026-09-05', '2026-09-06')?.id, 'a')
    assert.equal(findOverlappingLeave(leaves, '2026-09-05', '2026-09-06', { ignoreId: 'a' }), null)
    assert.equal(findOverlappingLeave([leaves[1]], '2026-09-05', '2026-09-06'), null)
  })
})

describe('usedLeaveDays', () => {
  const leaves = [
    { id: '1', status: 'approved', start_date: '2026-09-07', end_date: '2026-09-11', content: { leave_type: 'annuel', days: 5 } },
    { id: '2', status: 'approved', start_date: '2026-09-14', end_date: '2026-09-15', content: { leave_type: 'maladie', days: 2 } },
    { id: '3', status: 'pending', start_date: '2026-09-21', end_date: '2026-09-22', content: { leave_type: 'annuel', days: 2 } },
    { id: '4', status: 'approved', start_date: '2025-12-29', end_date: '2025-12-31', content: { leave_type: 'annuel', days: 3 } },
  ]

  it('ne somme que les congés approuvés consommateurs', () => {
    assert.equal(usedLeaveDays(leaves), 8)
  })

  it('filtre par année de début', () => {
    assert.equal(usedLeaveDays(leaves, { year: 2026 }), 5)
    assert.equal(usedLeaveDays(leaves, { year: 2025 }), 3)
  })

  it('recalcule les jours si content.days est absent', () => {
    const rows = [{ id: 'x', status: 'approved', start_date: '2026-09-07', end_date: '2026-09-11', content: { leave_type: 'annuel' } }]
    assert.equal(usedLeaveDays(rows), 5)
  })
})

describe('remainingDays / balanceIsLow', () => {
  it('calcule le restant et le seuil d alerte', () => {
    assert.equal(remainingDays(30, 12), 18)
    assert.equal(balanceIsLow(5), true)
    assert.equal(balanceIsLow(6), false)
  })
})

describe('buildMonthCalendar', () => {
  const leaves = [
    {
      id: 'l1', employee_id: 'e1', employee_name: 'Alice', department: 'RH',
      leave_type: 'annuel', status: 'approved', start_date: '2026-09-07', end_date: '2026-09-11',
    },
    {
      id: 'l2', employee_id: 'e2', employee_name: 'Bob', department: 'Commercial',
      leave_type: 'maladie', status: 'pending', start_date: '2026-09-09', end_date: '2026-09-09',
    },
    {
      id: 'l3', employee_id: 'e3', employee_name: 'Carl', department: 'Stock',
      leave_type: 'annuel', status: 'rejected', start_date: '2026-09-09', end_date: '2026-09-09',
    },
  ]

  it('construit des semaines de 7 jours à partir du lundi', () => {
    const weeks = buildMonthCalendar(2026, 8, leaves, new Date(2026, 8, 9))
    assert.ok(weeks.length >= 4 && weeks.length <= 6)
    for (const week of weeks) assert.equal(week.length, 7)
    assert.equal(weeks[0][0].date, '2026-08-31') // lundi précédant le 1er septembre
  })

  it('place les congés en cours sur les bons jours et ignore les refusés', () => {
    const weeks = buildMonthCalendar(2026, 8, leaves, new Date(2026, 8, 9))
    const flat = weeks.flat()
    const day9 = flat.find(d => d.date === '2026-09-09')
    assert.equal(day9?.inMonth, true)
    assert.deepEqual(day9?.leaves.map(l => l.employeeName), ['Alice', 'Bob'])
    const day7 = flat.find(d => d.date === '2026-09-07')
    assert.deepEqual(day7?.leaves.map(l => l.employeeName), ['Alice'])
    const day12 = flat.find(d => d.date === '2026-09-12')
    assert.equal(day12?.leaves.length, 0)
  })

  it('marque le week-end et le jour courant', () => {
    const weeks = buildMonthCalendar(2026, 8, leaves, new Date(2026, 8, 9))
    const flat = weeks.flat()
    assert.equal(flat.find(d => d.date === '2026-09-12')?.weekend, true)
    assert.equal(flat.find(d => d.date === '2026-09-09')?.today, true)
  })

  it('signale les jours en surcharge', () => {
    const weeks = buildMonthCalendar(2026, 8, leaves, new Date(2026, 8, 9))
    assert.deepEqual(overloadedDays(weeks, 2).map(d => d.date), ['2026-09-09'])
    assert.deepEqual(overloadedDays(weeks, 3), [])
  })
})
