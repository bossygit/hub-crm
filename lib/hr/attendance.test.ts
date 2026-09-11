import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  attendanceStatus,
  timeToMinutes,
  workedHours,
  overtimeHours,
  summarizeAttendance,
  monthlyStats,
  attendanceKey,
  monthRange,
  todayKey,
  isWeekendKey,
  formatHours,
} from './attendance.ts'

describe('attendanceStatus', () => {
  it('retombe sur present pour un statut inconnu', () => {
    assert.equal(attendanceStatus('late').code, 'late')
    assert.equal(attendanceStatus('inconnu').code, 'present')
    assert.equal(attendanceStatus(null).code, 'present')
  })
})

describe('timeToMinutes', () => {
  it('accepte HH:MM et HH:MM:SS', () => {
    assert.equal(timeToMinutes('08:00'), 480)
    assert.equal(timeToMinutes('17:30'), 1050)
    assert.equal(timeToMinutes('08:15:00'), 495)
  })

  it('rejette les valeurs invalides', () => {
    assert.equal(timeToMinutes('25:00'), null)
    assert.equal(timeToMinutes('08:99'), null)
    assert.equal(timeToMinutes(''), null)
    assert.equal(timeToMinutes(null), null)
  })
})

describe('workedHours', () => {
  it('calcule une journée simple', () => {
    assert.equal(workedHours('08:00', '17:00'), 9)
    assert.equal(workedHours('08:00', '16:30'), 8.5)
  })

  it('gère un service de nuit', () => {
    assert.equal(workedHours('22:00', '06:00'), 8)
  })

  it('renvoie null si incomplet', () => {
    assert.equal(workedHours('08:00', ''), null)
    assert.equal(workedHours(null, null), null)
  })
})

describe('overtimeHours', () => {
  it('ne compte que le dépassement au-delà de la durée attendue', () => {
    assert.equal(overtimeHours(9), 1)
    assert.equal(overtimeHours(7.5), 0)
    assert.equal(overtimeHours(null), 0)
    assert.equal(overtimeHours(10, 8), 2)
  })
})

describe('summarizeAttendance', () => {
  const rows = [
    { employee_id: 'e1', date: '2026-09-07', status: 'present', check_in: '08:00', check_out: '17:00', hours_worked: 9, overtime_hours: 1 },
    { employee_id: 'e1', date: '2026-09-08', status: 'late', check_in: '09:00', check_out: '17:00', hours_worked: 8, overtime_hours: 0 },
    { employee_id: 'e2', date: '2026-09-07', status: 'absent', hours_worked: null, overtime_hours: 0 },
    { employee_id: 'e2', date: '2026-09-08', status: 'leave', hours_worked: null, overtime_hours: 0 },
    { employee_id: 'e3', date: '2026-09-07', status: 'holiday', hours_worked: null, overtime_hours: 0 },
  ]

  it('compte chaque statut et totalise les heures travaillées', () => {
    const summary = summarizeAttendance(rows)
    assert.equal(summary.total, 5)
    assert.equal(summary.present, 1)
    assert.equal(summary.late, 1)
    assert.equal(summary.absent, 1)
    assert.equal(summary.leave, 1)
    assert.equal(summary.holiday, 1)
    assert.equal(summary.hours, 17)
    assert.equal(summary.overtime, 1)
  })

  it('recalcule les heures manquantes depuis les pointages', () => {
    const summary = summarizeAttendance([
      { employee_id: 'e1', date: '2026-09-09', status: 'present', check_in: '08:00', check_out: '16:00' },
    ])
    assert.equal(summary.hours, 8)
  })

  it('n ajoute pas d heures pour un statut non travaillé', () => {
    const summary = summarizeAttendance([
      { employee_id: 'e1', date: '2026-09-10', status: 'absent', check_in: '08:00', check_out: '17:00', hours_worked: 9 },
    ])
    assert.equal(summary.hours, 0)
  })
})

describe('monthlyStats', () => {
  const rows = [
    { employee_id: 'e2', date: '2026-09-01', status: 'present', check_in: '08:00', check_out: '16:00' },
    { employee_id: 'e1', date: '2026-09-01', status: 'present', check_in: '08:00', check_out: '16:00' },
    { employee_id: 'e1', date: '2026-09-02', status: 'absent' },
    { employee_id: 'e1', date: '2026-09-03', status: 'late', check_in: '09:00', check_out: '17:00' },
  ]

  it('agrège par employé et respecte l ordre fourni', () => {
    const stats = monthlyStats(rows, ['e1', 'e2'])
    assert.deepEqual(stats.map(s => s.employeeId), ['e1', 'e2'])
    assert.equal(stats[0].present, 1)
    assert.equal(stats[0].absent, 1)
    assert.equal(stats[0].late, 1)
    assert.equal(stats[0].days, 2)
    assert.equal(stats[0].hours, 16)
  })
})

describe('helpers de date', () => {
  it('construit la clé et la plage du mois', () => {
    assert.equal(attendanceKey('e1', '2026-09-07'), 'e1::2026-09-07')
    assert.deepEqual(monthRange(2026, 8), { start: '2026-09-01', end: '2026-09-30' })
    assert.deepEqual(monthRange(2026, 1), { start: '2026-02-01', end: '2026-02-28' })
  })

  it('gère aujourd hui, les week-ends et le formatage', () => {
    assert.equal(todayKey(new Date(2026, 8, 9)), '2026-09-09')
    assert.equal(isWeekendKey('2026-09-12'), true)
    assert.equal(isWeekendKey('2026-09-11'), false)
    assert.equal(formatHours(8.5), '8,5 h')
    assert.equal(formatHours(null), '—')
  })
})
