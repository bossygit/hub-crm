/**
 * Relances clients — logique pure, partagée entre l'API de relance et l'UI.
 *
 * Une relance ne concerne que les factures VALIDÉES (approved / partial) dont
 * le solde restant est > 0 et dont l'échéance est dépassée. Les brouillons et
 * factures en attente de validation ne sont jamais relancés (ce n'est pas une
 * créance). Un délai de carence évite de relancer le même client deux fois de
 * suite ; le niveau de relance s'incrémente à chaque envoi (plafonné à 3).
 */

export const OPEN_INVOICE_STATUSES = ['approved', 'partial'] as const
export const REMINDABLE_STATUSES: readonly string[] = OPEN_INVOICE_STATUSES

/** Délai par défaut entre deux relances d'une même facture (jours). */
export const REMINDER_COOLDOWN_DAYS = 7

/** Niveau maximum de relance (1 = courtoise, 3 = ferme). */
export const MAX_REMINDER_LEVEL = 3

export type ReminderInvoice = {
  id: string
  invoice_number: string
  client_id?: string | null
  due_date?: string | null
  total: number
  status: string
}

export type ReminderPayment = { invoice_id: string; amount: number }

export type ReminderRecord = {
  invoice_id: string
  created_at: string
  level?: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

/** Montant déjà encaissé pour une facture. */
export function paidAmount(payments: ReminderPayment[], invoiceId: string): number {
  return payments
    .filter(p => p.invoice_id === invoiceId)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
}

/** Solde restant dû (jamais négatif). */
export function balanceDue(invoice: ReminderInvoice, payments: ReminderPayment[]): number {
  const total = Number(invoice.total) || 0
  const paid = paidAmount(payments, invoice.id)
  return Math.max(0, Math.round((total - paid) * 100) / 100)
}

/** Nombre de jours de retard (0 si l'échéance est aujourd'hui ou future). */
export function daysOverdue(dueDate?: string | null, now: Date = new Date()): number {
  if (!dueDate) return 0
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return 0
  const diff = startOfDay(now).getTime() - startOfDay(due).getTime()
  if (diff <= 0) return 0
  return Math.floor(diff / DAY_MS)
}

/** Facture relançable : validée, échéance dépassée, solde restant. */
export function isOverdue(
  invoice: ReminderInvoice,
  payments: ReminderPayment[],
  now: Date = new Date(),
): boolean {
  if (!REMINDABLE_STATUSES.includes(invoice.status)) return false
  if (balanceDue(invoice, payments) <= 0) return false
  return daysOverdue(invoice.due_date, now) > 0
}

export function lastReminderAt(history: ReminderRecord[]): string | null {
  if (history.length === 0) return null
  return history
    .map(r => r.created_at)
    .filter(Boolean)
    .sort()
    .at(-1) || null
}

/** Prochain niveau de relance d'après l'historique (1 → 3). */
export function nextReminderLevel(history: ReminderRecord[]): number {
  const used = history.filter(r => (Number(r.level) || 1) > 0).length
  return Math.min(MAX_REMINDER_LEVEL, used + 1)
}

export type ReminderDecision = {
  ok: boolean
  reason?: 'not_remindable' | 'not_overdue' | 'cooldown' | 'no_email'
  level: number
  days: number
  balance: number
}

/** Décide si une relance peut partir maintenant pour une facture. */
export function canRemind(params: {
  invoice: ReminderInvoice
  payments: ReminderPayment[]
  history: ReminderRecord[]
  now?: Date
  cooldownDays?: number
  clientEmail?: string | null
}): ReminderDecision {
  const now = params.now || new Date()
  const balance = balanceDue(params.invoice, params.payments)
  const days = daysOverdue(params.invoice.due_date, now)
  const level = nextReminderLevel(params.history)

  if (!REMINDABLE_STATUSES.includes(params.invoice.status) || balance <= 0) {
    return { ok: false, reason: 'not_remindable', level, days, balance }
  }
  if (days <= 0) {
    return { ok: false, reason: 'not_overdue', level, days, balance }
  }
  if (params.clientEmail !== undefined && !params.clientEmail) {
    return { ok: false, reason: 'no_email', level, days, balance }
  }

  const cooldown = params.cooldownDays ?? REMINDER_COOLDOWN_DAYS
  const last = lastReminderAt(params.history)
  if (last) {
    const elapsed = (startOfDay(now).getTime() - startOfDay(new Date(last)).getTime()) / DAY_MS
    if (elapsed < cooldown) {
      return { ok: false, reason: 'cooldown', level, days, balance }
    }
  }

  return { ok: true, level, days, balance }
}

export type ReminderPlan = {
  ready: { invoice: ReminderInvoice; level: number; days: number; balance: number }[]
  onCooldown: ReminderInvoice[]
  notOverdue: ReminderInvoice[]
}

/** Répartit les factures validées entre « à relancer », « en carence » et « à échoir ». */
export function planReminders(
  invoices: ReminderInvoice[],
  payments: ReminderPayment[],
  reminders: ReminderRecord[],
  now: Date = new Date(),
  cooldownDays: number = REMINDER_COOLDOWN_DAYS,
): ReminderPlan {
  const plan: ReminderPlan = { ready: [], onCooldown: [], notOverdue: [] }
  const byInvoice = new Map<string, ReminderRecord[]>()
  for (const r of reminders) {
    const list = byInvoice.get(r.invoice_id)
    if (list) list.push(r)
    else byInvoice.set(r.invoice_id, [r])
  }

  for (const invoice of invoices) {
    if (!REMINDABLE_STATUSES.includes(invoice.status)) continue
    if (balanceDue(invoice, payments) <= 0) continue
    const history = byInvoice.get(invoice.id) || []
    const decision = canRemind({ invoice, payments, history, now, cooldownDays })
    if (decision.ok) {
      plan.ready.push({ invoice, level: decision.level, days: decision.days, balance: decision.balance })
    } else if (decision.reason === 'cooldown') {
      plan.onCooldown.push(invoice)
    } else if (decision.reason === 'not_overdue') {
      plan.notOverdue.push(invoice)
    }
  }
  return plan
}

/** Statuts considérés comme « ouverts » pour une alerte de retard interne
 *  (inclut les factures en attente de validation, contrairement aux relances
 *  client qui ne ciblent que des créances validées). */
export const OVERDUE_ALERT_STATUSES = ['pending', 'approved', 'partial'] as const

export type OverdueOpenInvoice = {
  invoice: ReminderInvoice
  balance: number
  days: number
}

/** Factures ouvertes en retard, triées du retard le plus ancien au plus récent. */
export function overdueOpenInvoices(
  invoices: ReminderInvoice[],
  payments: ReminderPayment[],
  now: Date = new Date(),
): OverdueOpenInvoice[] {
  return invoices
    .filter(i => (OVERDUE_ALERT_STATUSES as readonly string[]).includes(i.status))
    .map(invoice => ({ invoice, balance: balanceDue(invoice, payments), days: daysOverdue(invoice.due_date, now) }))
    .filter(row => row.balance > 0 && row.days > 0)
    .sort((a, b) => b.days - a.days)
}

export function overdueAlertMessage(row: OverdueOpenInvoice): string {
  const { invoice } = row
  return `Facture ${invoice.invoice_number} en retard de ${row.days} jour(s) — solde dû ${fcfa(row.balance)}.`
}

// ── Contenu des emails ──────────────────────────────────────────────

export function fcfa(amount: number): string {
  return `${(Number(amount) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`
}

function frDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('fr-FR')
}

export type ReminderEmailInput = {
  clientName: string
  invoiceNumber: string
  amountDue: number
  dueDate?: string | null
  daysOverdue?: number
  level: number
  companyName?: string
  appUrl?: string
  invoiceId?: string
}

const LEVEL_TONE: Record<number, { subject: string; intro: string; accent: string }> = {
  1: {
    subject: 'Rappel',
    intro: 'Sauf erreur de notre part, le règlement de la facture ci-dessous reste en attente.',
    accent: '#1a3d2b',
  },
  2: {
    subject: 'Relance',
    intro: 'Nous revenons vers vous concernant la facture ci-dessous, toujours impayée à ce jour.',
    accent: '#b45309',
  },
  3: {
    subject: 'Relance ferme',
    intro: 'Malgré nos précédents rappels, la facture ci-dessous demeure impayée. Nous vous remercions de régulariser sans délai.',
    accent: '#991b1b',
  },
}

export function buildReminderEmail(input: ReminderEmailInput): { subject: string; html: string; text: string } {
  const level = Math.min(MAX_REMINDER_LEVEL, Math.max(1, Number(input.level) || 1))
  const tone = LEVEL_TONE[level]
  const company = input.companyName || 'HUB Distribution'
  const subject = `${tone.subject} n°${level} — Facture ${input.invoiceNumber} (${fcfa(input.amountDue)})`
  const overdueLine = input.daysOverdue && input.daysOverdue > 0
    ? `<div style="color:#991b1b;font-size:0.85rem;margin-top:6px">Retard constaté : ${input.daysOverdue} jour(s)</div>`
    : ''

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:${tone.accent};color:white;padding:20px 24px;border-radius:12px 12px 0 0">
        <div style="font-family:Georgia,serif;font-size:1.2rem;font-weight:800">${company}</div>
        <div style="font-size:0.72rem;opacity:0.7;letter-spacing:0.1em;text-transform:uppercase">Relance client — niveau ${level}</div>
      </div>
      <div style="padding:24px;background:#f8f5ee;border:1px solid #e8e4db;border-top:none;border-radius:0 0 12px 12px">
        <div style="color:#333;font-size:0.95rem;margin-bottom:14px">Bonjour ${input.clientName || 'Madame, Monsieur'},</div>
        <div style="color:#555;font-size:0.9rem;margin-bottom:18px">${tone.intro}</div>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden">
          <tr><td style="padding:10px 14px;color:#888;font-size:0.78rem;text-transform:uppercase">Facture</td>
              <td style="padding:10px 14px;font-weight:700;color:#1a3d2b;text-align:right;font-family:monospace">${input.invoiceNumber}</td></tr>
          <tr><td style="padding:10px 14px;color:#888;font-size:0.78rem;text-transform:uppercase">Échéance</td>
              <td style="padding:10px 14px;text-align:right">${frDate(input.dueDate)}</td></tr>
          <tr><td style="padding:10px 14px;color:#888;font-size:0.78rem;text-transform:uppercase">Montant dû</td>
              <td style="padding:10px 14px;text-align:right;font-weight:800;color:#991b1b;font-size:1.05rem">${fcfa(input.amountDue)}</td></tr>
        </table>
        ${overdueLine}
        <div style="color:#555;font-size:0.85rem;margin-top:18px">
          Merci de bien vouloir procéder au règlement. Si celui-ci a déjà été effectué, nous vous prions de ne pas tenir compte de ce message.
        </div>
        <div style="margin-top:20px;font-size:0.8rem;color:#888">Cordialement,<br/><strong>${company}</strong></div>
      </div>
    </div>
  `

  const text = [
    `${company} — Relance niveau ${level}`,
    `Bonjour ${input.clientName || ''},`,
    tone.intro,
    `Facture : ${input.invoiceNumber}`,
    `Échéance : ${frDate(input.dueDate)}`,
    `Montant dû : ${fcfa(input.amountDue)}`,
    input.daysOverdue ? `Retard : ${input.daysOverdue} jour(s)` : '',
    'Si le règlement a déjà été effectué, ignorez ce message.',
  ].filter(Boolean).join('\n')

  return { subject, html, text }
}
