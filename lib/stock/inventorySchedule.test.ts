import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPlanned,
  defaultScheduledDate,
  upcomingPlanned,
  overduePlanned,
  daysUntil,
  scheduleLabel,
  validateSchedule,
  canStart,
  plannedSummary,
  type InventorySessionLike,
} from './inventorySchedule.ts'

const now = new Date(2026, 8, 11) // 11/09/2026

const session = (over: Partial<InventorySessionLike> = {}): InventorySessionLike => ({
  id: 's1', session_number: 'INV-001', status: 'planned', scheduled_date: '2026-09-20', ...over,
})

describe('defaultScheduledDate', () => {
  it('propose une date à J+7', () => {
    assert.equal(defaultScheduledDate(now), '2026-09-18')
    assert.equal(defaultScheduledDate(now, 1), '2026-09-12')
  })
})

describe('isPlanned / canStart', () => {
  it('ne considère que le statut planned', () => {
    assert.equal(isPlanned(session()), true)
    assert.equal(isPlanned(session({ status: 'draft' })), false)
    assert.equal(canStart(session()), true)
    assert.equal(canStart(session({ status: 'approved' })), false)
  })
})

describe('upcomingPlanned / overduePlanned', () => {
  const sessions = [
    session({ id: 'past', scheduled_date: '2026-09-01' }),
    session({ id: 'today', scheduled_date: '2026-09-11' }),
    session({ id: 'future', scheduled_date: '2026-09-20' }),
    session({ id: 'nodate', scheduled_date: null }),
    session({ id: 'running', status: 'draft', scheduled_date: '2026-09-12' }),
  ]

  it('liste les séances planifiées à venir, triées par date', () => {
    assert.deepEqual(upcomingPlanned(sessions, now).map(s => s.id), ['today', 'future', 'nodate'])
  })

  it('liste les séances planifiées en retard', () => {
    assert.deepEqual(overduePlanned(sessions, now).map(s => s.id), ['past'])
  })
})

describe('daysUntil / scheduleLabel', () => {
  it('formate le libellé en français', () => {
    assert.equal(daysUntil('2026-09-11', now), 0)
    assert.equal(daysUntil('2026-09-12', now), 1)
    assert.equal(daysUntil('2026-09-18', now), 7)
    assert.equal(scheduleLabel('2026-09-11', now), "Aujourd'hui")
    assert.equal(scheduleLabel('2026-09-12', now), 'Demain')
    assert.equal(scheduleLabel('2026-09-18', now), 'Dans 7 j')
    assert.equal(scheduleLabel('2026-09-01', now), 'En retard de 10 j')
    assert.equal(scheduleLabel(null, now), 'Non planifiée')
  })
})

describe('validateSchedule', () => {
  it('refuse une date vide, invalide ou passée', () => {
    assert.equal(validateSchedule(null, now).ok, false)
    assert.equal(validateSchedule('pas-une-date', now).ok, false)
    assert.equal(validateSchedule('2026-09-01', now).ok, false)
    assert.equal(validateSchedule('2026-09-01', now, true).ok, true)
  })

  it('accepte aujourd hui et le futur', () => {
    assert.equal(validateSchedule('2026-09-11', now).ok, true)
    assert.equal(validateSchedule('2026-10-01', now).ok, true)
  })
})

describe('plannedSummary', () => {
  it('compte les séances planifiées, à venir et en retard', () => {
    const sessions = [
      session({ id: 'a', scheduled_date: '2026-09-01' }),
      session({ id: 'b', scheduled_date: '2026-09-12' }),
      session({ id: 'c', scheduled_date: '2026-09-20' }),
      session({ id: 'd', status: 'approved', scheduled_date: '2026-09-20' }),
    ]
    const summary = plannedSummary(sessions, now)
    assert.equal(summary.planned, 3)
    assert.equal(summary.upcoming, 2)
    assert.equal(summary.overdue, 1)
    assert.equal(summary.next?.id, 'b')
  })
})
