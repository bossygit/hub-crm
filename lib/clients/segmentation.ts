/**
 * Segmentation clients — scoring RFM pur (récence, fréquence, montant).
 *
 * Renvoie pour chaque client son segment (vip / fidele / actif / inactif /
 * prospect), sa valeur vie (LTV), son nombre de commandes, sa récence et un
 * score 0-100. Aucune dépendance Supabase : testable directement.
 *
 * Le CA retenu est le TTC des factures validées (approved | partial | paid),
 * comme dans lib/clients/finance.ts et lib/reports/revenue.ts.
 */

export const SEGMENT_REVENUE_STATUSES = ['approved', 'partial', 'paid'] as const

export const CLIENT_SEGMENTS = ['vip', 'fidele', 'actif', 'inactif', 'prospect'] as const
export type ClientSegment = (typeof CLIENT_SEGMENTS)[number]

export const SEGMENT_META: Record<ClientSegment, { label: string; badge: string; icon: string; description: string }> = {
  vip: { label: 'VIP', badge: 'badge-green', icon: '💎', description: 'Meilleurs clients : chiffre d’affaires et fréquence élevés.' },
  fidele: { label: 'Fidèle', badge: 'badge-blue', icon: '⭐', description: 'Client régulier à forte valeur.' },
  actif: { label: 'Actif', badge: 'badge-amber', icon: '🟢', description: 'A commandé récemment.' },
  inactif: { label: 'Inactif', badge: 'badge-red', icon: '😴', description: 'Aucune commande récente — à relancer.' },
  prospect: { label: 'Prospect', badge: 'badge-gray', icon: '🌱', description: 'Fiche récente sans commande validée.' },
}

export const SEGMENT_THRESHOLDS = {
  /** CA cumulé (FCFA) à partir duquel un client fréquent devient VIP. */
  vipRevenue: 1_000_000,
  vipOrders: 3,
  /** Seuils « fidèle ». */
  loyalRevenue: 300_000,
  loyalOrders: 3,
  /** Au-delà de N jours sans commande, un client commanditaire devient inactif. */
  activeRecencyDays: 90,
  /** Une fiche sans commande créée il y a moins de N jours est un prospect. */
  prospectMaxAgeDays: 180,
} as const

const DAY_MS = 24 * 60 * 60 * 1000

export type SegmentationInvoice = {
  id: string
  client_id?: string | null
  date: string
  status: string
  total: number
}

export type SegmentationPayment = { invoice_id: string; amount: number }

export type SegmentationClient = { id: string; created_at?: string | null }

export type ClientSegmentation = {
  clientId: string
  ordersCount: number
  lifetimeValue: number
  lastOrderAt: string | null
  recencyDays: number | null
  averageBasket: number
  outstanding: number
  score: number
  segment: ClientSegment
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function round2(value: number): number {
  return Math.round(num(value) * 100) / 100
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.floor((b - a) / DAY_MS)
}

/** Score de récence : 100 (très récent) → 0 (au-delà d'un an). */
export function recencyScore(recencyDays: number | null): number {
  if (recencyDays == null) return 0
  if (recencyDays <= 30) return 100
  if (recencyDays >= 365) return 0
  return Math.round(((365 - recencyDays) / (365 - 30)) * 100)
}

/** Score RFM 0-100 (35 % récence, 30 % fréquence, 35 % montant). */
export function clientScore(input: {
  ordersCount: number
  lifetimeValue: number
  recencyDays: number | null
  thresholds?: typeof SEGMENT_THRESHOLDS
}): number {
  if (input.ordersCount <= 0) return 0
  const t = input.thresholds || SEGMENT_THRESHOLDS
  const recency = recencyScore(input.recencyDays)
  const frequency = Math.min(100, input.ordersCount * 20)
  const monetary = Math.min(100, (num(input.lifetimeValue) / t.vipRevenue) * 100)
  return Math.round(0.35 * recency + 0.3 * frequency + 0.35 * monetary)
}

export function classifyClient(input: {
  ordersCount: number
  lifetimeValue: number
  recencyDays: number | null
  createdAt?: string | null
  now?: Date
  thresholds?: typeof SEGMENT_THRESHOLDS
}): ClientSegment {
  const t = input.thresholds || SEGMENT_THRESHOLDS
  const now = input.now || new Date()

  if (input.ordersCount <= 0) {
    if (!input.createdAt) return 'prospect'
    const created = new Date(input.createdAt)
    if (Number.isNaN(created.getTime())) return 'prospect'
    return daysBetween(created, now) <= t.prospectMaxAgeDays ? 'prospect' : 'inactif'
  }

  const ltv = num(input.lifetimeValue)
  if (ltv >= t.vipRevenue && input.ordersCount >= t.vipOrders) return 'vip'
  if (ltv >= t.loyalRevenue || input.ordersCount >= t.loyalOrders) return 'fidele'
  if (input.recencyDays != null && input.recencyDays <= t.activeRecencyDays) return 'actif'
  return 'inactif'
}

/**
 * Calcule la segmentation de chaque client fourni.
 * Les factures non validées et les factures des clients absents sont ignorées.
 */
export function computeClientSegmentation(
  clients: SegmentationClient[],
  invoices: SegmentationInvoice[],
  payments: SegmentationPayment[] = [],
  options: { now?: Date; thresholds?: typeof SEGMENT_THRESHOLDS } = {},
): ClientSegmentation[] {
  const now = options.now || new Date()
  const thresholds = options.thresholds || SEGMENT_THRESHOLDS
  const statuses = SEGMENT_REVENUE_STATUSES as readonly string[]

  const paidByInvoice = new Map<string, number>()
  for (const p of payments) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) || 0) + num(p.amount))
  }

  const byClient = new Map<string, { count: number; value: number; last: string | null; outstanding: number }>()
  for (const invoice of invoices) {
    if (!invoice.client_id) continue
    if (!statuses.includes(invoice.status)) continue
    const row = byClient.get(invoice.client_id) || { count: 0, value: 0, last: null, outstanding: 0 }
    row.count += 1
    row.value += num(invoice.total)
    row.outstanding += Math.max(0, num(invoice.total) - (paidByInvoice.get(invoice.id) || 0))
    const day = (invoice.date || '').slice(0, 10)
    if (day && (!row.last || day > row.last)) row.last = day
    byClient.set(invoice.client_id, row)
  }

  return clients.map(client => {
    const agg = byClient.get(client.id) || { count: 0, value: 0, last: null, outstanding: 0 }
    const lastOrderAt = agg.last
    const recencyDays = lastOrderAt ? daysBetween(new Date(lastOrderAt), now) : null
    const lifetimeValue = round2(agg.value)
    const ordersCount = agg.count

    return {
      clientId: client.id,
      ordersCount,
      lifetimeValue,
      lastOrderAt,
      recencyDays,
      averageBasket: ordersCount > 0 ? round2(lifetimeValue / ordersCount) : 0,
      outstanding: round2(agg.outstanding),
      score: clientScore({ ordersCount, lifetimeValue, recencyDays, thresholds }),
      segment: classifyClient({
        ordersCount,
        lifetimeValue,
        recencyDays,
        createdAt: client.created_at,
        now,
        thresholds,
      }),
    }
  })
}

export type SegmentCount = { segment: ClientSegment; count: number; revenue: number }

/** Répartition des clients par segment (pour un graphique ou des KPIs). */
export function segmentBreakdown(rows: ClientSegmentation[]): SegmentCount[] {
  return CLIENT_SEGMENTS.map(segment => {
    const inSegment = rows.filter(r => r.segment === segment)
    return {
      segment,
      count: inSegment.length,
      revenue: round2(inSegment.reduce((s, r) => s + r.lifetimeValue, 0)),
    }
  })
}
