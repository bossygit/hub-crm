/**
 * Logique métier présences / pointage — page /hr/attendance.
 * Table `attendance` (une ligne par employé et par jour).
 */

export type AttendanceStatusCode = 'present' | 'absent' | 'late' | 'leave' | 'holiday'

export type AttendanceStatusMeta = {
  code: AttendanceStatusCode
  label: string
  short: string
  badge: string
  icon: string
  /** Comptabilisé comme jour travaillé (sert aux totaux d'heures). */
  worked: boolean
}

export const ATTENDANCE_STATUSES: Record<AttendanceStatusCode, AttendanceStatusMeta> = {
  present: { code: 'present', label: 'Present', short: 'Présent', badge: 'badge-green', icon: '✅', worked: true },
  late: { code: 'late', label: 'Retard', short: 'Retard', badge: 'badge-amber', icon: '⏰', worked: true },
  absent: { code: 'absent', label: 'Absent', short: 'Absent', badge: 'badge-red', icon: '❌', worked: false },
  leave: { code: 'leave', label: 'Conge', short: 'Congé', badge: 'badge-blue', icon: '🏖', worked: false },
  holiday: { code: 'holiday', label: 'Ferie', short: 'Férié', badge: 'badge-gray', icon: '🎉', worked: false },
}

export const ATTENDANCE_STATUS_LIST: AttendanceStatusMeta[] = [
  ATTENDANCE_STATUSES.present,
  ATTENDANCE_STATUSES.late,
  ATTENDANCE_STATUSES.absent,
  ATTENDANCE_STATUSES.leave,
  ATTENDANCE_STATUSES.holiday,
]

export function isAttendanceStatusCode(value: unknown): value is AttendanceStatusCode {
  return typeof value === 'string' && value in ATTENDANCE_STATUSES
}

export function attendanceStatus(code?: string | null): AttendanceStatusMeta {
  return isAttendanceStatusCode(code) ? ATTENDANCE_STATUSES[code] : ATTENDANCE_STATUSES.present
}

// ── Heures ───────────────────────────────────────────────────────────

/** 'HH:MM' ou 'HH:MM:SS' -> minutes depuis minuit (null si invalide). */
export function timeToMinutes(value?: string | null): number | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Durée travaillée en heures (arrondie à 2 décimales), null si incomplet. */
export function workedHours(checkIn?: string | null, checkOut?: string | null): number | null {
  const start = timeToMinutes(checkIn)
  const end = timeToMinutes(checkOut)
  if (start == null || end == null) return null
  let minutes = end - start
  if (minutes < 0) minutes += 24 * 60 // service de nuit
  return Math.round((minutes / 60) * 100) / 100
}

/** Heures au-delà de la durée contractuelle journalière (8 h par défaut). */
export function overtimeHours(worked?: number | null, expected = 8): number {
  if (worked == null) return 0
  const extra = (Number(worked) || 0) - (Number(expected) || 0)
  return extra > 0 ? Math.round(extra * 100) / 100 : 0
}

export function formatHours(value?: number | null): string {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return `${(Math.round(Number(value) * 100) / 100).toLocaleString('fr-FR')} h`
}

// ── Agrégats ─────────────────────────────────────────────────────────

export type AttendanceRow = {
  employee_id: string
  date: string
  status?: string | null
  check_in?: string | null
  check_out?: string | null
  hours_worked?: number | null
  overtime_hours?: number | null
}

export type AttendanceSummary = {
  present: number
  late: number
  absent: number
  leave: number
  holiday: number
  total: number
  hours: number
  overtime: number
}

export function summarizeAttendance(rows: AttendanceRow[]): AttendanceSummary {
  const summary: AttendanceSummary = {
    present: 0, late: 0, absent: 0, leave: 0, holiday: 0,
    total: rows.length, hours: 0, overtime: 0,
  }
  for (const row of rows) {
    const status = attendanceStatus(row.status).code
    summary[status] += 1
    const hours = row.hours_worked != null ? Number(row.hours_worked) : workedHours(row.check_in, row.check_out)
    if (hours != null && attendanceStatus(row.status).worked) {
      summary.hours += Number(hours) || 0
    }
    summary.overtime += Number(row.overtime_hours) || 0
  }
  summary.hours = Math.round(summary.hours * 100) / 100
  summary.overtime = Math.round(summary.overtime * 100) / 100
  return summary
}

export function attendanceKey(employeeId: string, date: string): string {
  return `${employeeId}::${date}`
}

export function monthRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month + 1).padStart(2, '0')
  const lastDay = new Date(year, month + 1, 0).getDate()
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

export function todayKey(today: Date = new Date()): string {
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  return `${today.getFullYear()}-${mm}-${dd}`
}

export function isWeekendKey(dateKey: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateKey)
  if (!match) return false
  const dow = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay()
  return dow === 0 || dow === 6
}

export type MonthlyAttendanceStat = {
  employeeId: string
  present: number
  late: number
  absent: number
  leave: number
  holiday: number
  days: number
  hours: number
  overtime: number
}

/** Regroupe les pointages du mois par employé (ordre d'affichage stable). */
export function monthlyStats(
  rows: AttendanceRow[],
  order: string[] = [],
): MonthlyAttendanceStat[] {
  const byEmployee = new Map<string, AttendanceRow[]>()
  for (const row of rows) {
    const list = byEmployee.get(row.employee_id)
    if (list) list.push(row)
    else byEmployee.set(row.employee_id, [row])
  }
  const ids = Array.from(byEmployee.keys()).sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
    return a.localeCompare(b)
  })
  return ids.map(id => {
    const summary = summarizeAttendance(byEmployee.get(id) || [])
    return {
      employeeId: id,
      present: summary.present,
      late: summary.late,
      absent: summary.absent,
      leave: summary.leave,
      holiday: summary.holiday,
      days: summary.present + summary.late,
      hours: summary.hours,
      overtime: summary.overtime,
    }
  })
}
