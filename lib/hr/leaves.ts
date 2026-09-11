/**
 * Logique métier congés — partagée entre la page RH (/hr/leaves),
 * le self-service salarié (/me/conges) et le calendrier d'équipe.
 *
 * ⚠️ Le drapeau `consumesBalance` doit rester synchronisé avec la fonction
 * SQL `hr_is_balance_leave(text)` de la migration
 * 20260909170001_hr_attendance_and_leave_balances.sql.
 * Seul le congé annuel consomme le solde : maladie, sans solde, maternité et
 * congé exceptionnel disposent de droits séparés (ou d'aucun droit).
 */

export type LeaveTypeCode = 'annuel' | 'maladie' | 'sans_solde' | 'exceptionnel' | 'maternite'

export type LeaveTypeMeta = {
  code: LeaveTypeCode
  label: string
  short: string
  /** true => l'approbation décrémente leave_balances.used_days */
  consumesBalance: boolean
}

export const LEAVE_TYPES: Record<LeaveTypeCode, LeaveTypeMeta> = {
  annuel: { code: 'annuel', label: 'Conge annuel', short: 'Annuel', consumesBalance: true },
  maladie: { code: 'maladie', label: 'Conge maladie', short: 'Maladie', consumesBalance: false },
  sans_solde: { code: 'sans_solde', label: 'Sans solde', short: 'Sans solde', consumesBalance: false },
  exceptionnel: { code: 'exceptionnel', label: 'Conge exceptionnel', short: 'Exceptionnel', consumesBalance: false },
  maternite: { code: 'maternite', label: 'Maternite/Paternite', short: 'Maternite', consumesBalance: false },
}

export const LEAVE_TYPE_LIST: LeaveTypeMeta[] = Object.values(LEAVE_TYPES)

export function isLeaveTypeCode(value: unknown): value is LeaveTypeCode {
  return typeof value === 'string' && value in LEAVE_TYPES
}

export function leaveTypeLabel(code?: string | null): string {
  if (!code) return '—'
  return isLeaveTypeCode(code) ? LEAVE_TYPES[code].label : code
}

export function leaveTypeShort(code?: string | null): string {
  if (!code) return '—'
  return isLeaveTypeCode(code) ? LEAVE_TYPES[code].short : code
}

/** Un type inconnu est considéré comme hors solde (comportement sûr). */
export function leaveConsumesBalance(code?: string | null): boolean {
  return isLeaveTypeCode(code) ? LEAVE_TYPES[code].consumesBalance : false
}

// ── Dates (parsing sans dérive de fuseau) ────────────────────────────

export function parseDateOnly(value?: string | Date | null): Date | null {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getFullYear(), value.getMonth(), value.getDate())
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
}

export function toDateKey(value: string | Date): string {
  const d = parseDateOnly(value)
  if (!d) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function isWeekend(value: string | Date): boolean {
  const d = parseDateOnly(value)
  if (!d) return false
  const dow = d.getDay()
  return dow === 0 || dow === 6
}

/** Jours ouvrés (lundi→vendredi) entre deux dates incluses. */
export function workingDays(start?: string | null, end?: string | null): number {
  const from = parseDateOnly(start)
  const to = parseDateOnly(end)
  if (!from || !to || to < from) return 0
  let count = 0
  const cursor = new Date(from)
  while (cursor <= to) {
    const dow = cursor.getDay()
    if (dow !== 0 && dow !== 6) count++
    cursor.setDate(cursor.getDate() + 1)
  }
  return count
}

export function leaveYearOf(start?: string | null, fallbackYear = new Date().getFullYear()): number {
  const d = parseDateOnly(start)
  return d ? d.getFullYear() : fallbackYear
}

// ── Chevauchements ───────────────────────────────────────────────────

export const BLOCKING_LEAVE_STATUSES = ['pending', 'approved'] as const

export function rangesOverlap(
  aStart?: string | null,
  aEnd?: string | null,
  bStart?: string | null,
  bEnd?: string | null,
): boolean {
  const a1 = parseDateOnly(aStart)
  const a2 = parseDateOnly(aEnd)
  const b1 = parseDateOnly(bStart)
  const b2 = parseDateOnly(bEnd)
  if (!a1 || !a2 || !b1 || !b2) return false
  return a1 <= b2 && a2 >= b1
}

export type OverlapCandidate = {
  id: string
  start_date?: string | null
  end_date?: string | null
  status?: string | null
}

export function findOverlappingLeave<T extends OverlapCandidate>(
  leaves: T[],
  start?: string | null,
  end?: string | null,
  options: { ignoreId?: string | null } = {},
): T | null {
  if (!start || !end) return null
  return (
    leaves.find(
      l =>
        l.id !== options.ignoreId &&
        !!l.status &&
        (BLOCKING_LEAVE_STATUSES as readonly string[]).includes(l.status) &&
        rangesOverlap(start, end, l.start_date, l.end_date),
    ) || null
  )
}

// ── Soldes ───────────────────────────────────────────────────────────

export type BalanceLeave = OverlapCandidate & {
  employee_id?: string | null
  content?: Record<string, unknown> | null
}

/** Somme des jours ouvrés des congés approuvés qui consomment le solde. */
export function usedLeaveDays(leaves: BalanceLeave[], options: { year?: number } = {}): number {
  return leaves.reduce((total, leave) => {
    if (leave.status !== 'approved') return total
    const type = (leave.content as Record<string, unknown> | null | undefined)?.leave_type
    if (!leaveConsumesBalance(typeof type === 'string' ? type : null)) return total
    if (options.year != null && leaveYearOf(leave.start_date, options.year) !== options.year) return total
    const stored = Number((leave.content as Record<string, unknown> | null | undefined)?.days)
    const days = Number.isFinite(stored) && stored > 0 ? stored : workingDays(leave.start_date, leave.end_date)
    return total + days
  }, 0)
}

export function remainingDays(totalDays: number, used: number): number {
  return (Number(totalDays) || 0) - (Number(used) || 0)
}

export function balanceIsLow(remaining: number, threshold = 5): boolean {
  return (Number(remaining) || 0) <= threshold
}

// ── Calendrier d'équipe ──────────────────────────────────────────────

export type CalendarLeaveInput = {
  id: string
  employee_id: string
  employee_name: string
  department?: string | null
  leave_type?: string | null
  status?: string | null
  start_date?: string | null
  end_date?: string | null
}

export type CalendarLeaveEntry = {
  id: string
  employeeId: string
  employeeName: string
  department?: string | null
  leaveType: string
  status: string
}

export type CalendarDay = {
  /** Clé ISO locale (YYYY-MM-DD) — renseignée aussi hors mois pour la clé React. */
  date: string
  day: number
  inMonth: boolean
  weekend: boolean
  today: boolean
  leaves: CalendarLeaveEntry[]
}

export type CalendarWeek = CalendarDay[]

/** Grille du mois, semaines de 7 jours commençant le lundi (mois 0-based). */
export function buildMonthCalendar(
  year: number,
  month: number,
  leaves: CalendarLeaveInput[],
  today: Date = new Date(),
): CalendarWeek[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7 // lundi = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7
  const start = new Date(year, month, 1 - offset)
  const todayKey = toDateKey(today)

  const active = leaves.filter(
    l => !!l.start_date && !!l.end_date && (l.status === 'approved' || l.status === 'pending'),
  )

  const weeks: CalendarWeek[] = []
  for (let cell = 0; cell < totalCells; cell++) {
    const current = new Date(start)
    current.setDate(start.getDate() + cell)
    const inMonth = current.getMonth() === month && current.getFullYear() === year
    const key = toDateKey(current)
    const dayLeaves: CalendarLeaveEntry[] = inMonth
      ? active
          .filter(l => rangesOverlap(key, key, l.start_date, l.end_date))
          .map(l => ({
            id: l.id,
            employeeId: l.employee_id,
            employeeName: l.employee_name,
            department: l.department,
            leaveType: l.leave_type || 'annuel',
            status: l.status || 'pending',
          }))
          .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'fr'))
      : []
    const day: CalendarDay = {
      date: key,
      day: current.getDate(),
      inMonth,
      weekend: current.getDay() === 0 || current.getDay() === 6,
      today: inMonth && key === todayKey,
      leaves: dayLeaves,
    }
    if (cell % 7 === 0) weeks.push([])
    weeks[weeks.length - 1].push(day)
  }

  return weeks
}

export function calendarDayLoad(day: CalendarDay): number {
  return day.leaves.length
}

/** Jours du mois où l'effectif en congé atteint ou dépasse le seuil. */
export function overloadedDays(weeks: CalendarWeek[], threshold: number): CalendarDay[] {
  return weeks
    .flat()
    .filter(day => day.inMonth && !day.weekend && day.leaves.length >= threshold)
}

export const MONTH_NAMES = [
  'Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre',
]

export const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
