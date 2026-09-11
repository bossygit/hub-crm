/**
 * Planification d'inventaire physique — logique pure.
 *
 * Une séance planifiée est une `inventory_sessions` au statut `planned`, avec
 * une date prévue (`scheduled_date`), un responsable éventuel (`assigned_to`)
 * et aucune ligne. Au démarrage, les lignes sont générées à partir du stock du
 * moment (snapshot) et le statut passe à `draft` (comptage en cours).
 */

export const INVENTORY_STATUSES = ['planned', 'draft', 'approved', 'cancelled'] as const
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number]

export type InventorySessionLike = {
  id: string
  session_number?: string | null
  status?: string | null
  scheduled_date?: string | null
  assigned_to?: string | null
  created_at?: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function toDateKey(value: Date): string {
  const mm = String(value.getMonth() + 1).padStart(2, '0')
  const dd = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${mm}-${dd}`
}

export function isPlanned(session: InventorySessionLike): boolean {
  return session.status === 'planned'
}

export function defaultScheduledDate(now: Date = new Date(), daysAhead = 7): string {
  const d = new Date(now)
  d.setDate(d.getDate() + daysAhead)
  return toDateKey(d)
}

/** Séances planifiées dont la date est aujourd'hui ou à venir, par date. */
export function upcomingPlanned(
  sessions: InventorySessionLike[],
  now: Date = new Date(),
): InventorySessionLike[] {
  const today = startOfDay(now).getTime()
  return sessions
    .filter(isPlanned)
    .filter(s => {
      if (!s.scheduled_date) return true
      const d = new Date(s.scheduled_date)
      return !Number.isNaN(d.getTime()) && startOfDay(d).getTime() >= today
    })
    .sort((a, b) => {
      const da = a.scheduled_date || ''
      const db = b.scheduled_date || ''
      if (!da && !db) return 0
      if (!da) return 1 // les séances sans date passent en dernier
      if (!db) return -1
      return da.localeCompare(db)
    })
}

/** Séances planifiées en retard (date dépassée, toujours au statut planned). */
export function overduePlanned(
  sessions: InventorySessionLike[],
  now: Date = new Date(),
): InventorySessionLike[] {
  const today = startOfDay(now).getTime()
  return sessions
    .filter(isPlanned)
    .filter(s => {
      if (!s.scheduled_date) return false
      const d = new Date(s.scheduled_date)
      return !Number.isNaN(d.getTime()) && startOfDay(d).getTime() < today
    })
    .sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''))
}

export function daysUntil(scheduled?: string | null, now: Date = new Date()): number | null {
  if (!scheduled) return null
  const d = new Date(scheduled)
  if (Number.isNaN(d.getTime())) return null
  return Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY_MS)
}

/** Libellé court : « dans 3 j », « aujourd'hui », « en retard de 2 j ». */
export function scheduleLabel(scheduled?: string | null, now: Date = new Date()): string {
  const days = daysUntil(scheduled, now)
  if (days == null) return 'Non planifiée'
  if (days === 0) return "Aujourd'hui"
  if (days === 1) return 'Demain'
  if (days > 1) return `Dans ${days} j`
  return `En retard de ${Math.abs(days)} j`
}

export type ScheduleValidation = { ok: boolean; error?: string }

export function validateSchedule(
  scheduledDate?: string | null,
  now: Date = new Date(),
  allowPast = false,
): ScheduleValidation {
  if (!scheduledDate) return { ok: false, error: 'Choisissez une date d\u2019inventaire.' }
  const d = new Date(scheduledDate)
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'Date invalide.' }
  if (!allowPast && startOfDay(d).getTime() < startOfDay(now).getTime()) {
    return { ok: false, error: 'La date planifiée ne peut pas être dans le passé.' }
  }
  return { ok: true }
}

export function canStart(session: InventorySessionLike): boolean {
  return isPlanned(session)
}

export function plannedSummary(sessions: InventorySessionLike[], now: Date = new Date()) {
  const upcoming = upcomingPlanned(sessions, now)
  const overdue = overduePlanned(sessions, now)
  return {
    planned: sessions.filter(isPlanned).length,
    upcoming: upcoming.length,
    overdue: overdue.length,
    next: upcoming[0] || null,
  }
}
