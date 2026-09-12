/**
 * Contexte métier de l'assistant — agrège les données réelles du CRM en un
 * instantané compact, puis le rend sous forme de texte pour le prompt.
 *
 * Objectif : l'assistant ne « devine » jamais. Il répond à partir de chiffres
 * calculés ici (CA, créances, stock, clients, achats, commandes portail).
 * Pur et testable : aucune dépendance Supabase.
 */

import {
  balanceDue,
  overdueOpenInvoices,
  type ReminderPayment,
} from '../clients/reminders.ts'
import { buildLowStockAlerts, type StockProduct } from '../stock/alerts.ts'
import { buildMonthlyRevenueSeries, buildTopClientsSeries } from '../reports/charts.ts'
import { SEGMENT_META, type ClientSegment } from '../clients/segmentation.ts'

export const SNAPSHOT_REVENUE_STATUSES: readonly string[] = ['approved', 'partial', 'paid']
export const SNAPSHOT_OPEN_STATUSES: readonly string[] = ['approved', 'partial']

/** Facture telle qu'exploitée par l'assistant (compatible ReminderInvoice + ChartInvoice). */
export type BusinessInvoice = {
  id: string
  invoice_number: string
  client_id?: string | null
  due_date?: string | null
  date: string
  status: string
  total: number
}

/** Produit + catégorie (facultative selon les schémas). */
export type BusinessProduct = StockProduct & { category?: string | null }

export type BusinessClient = { id: string; name: string; segment?: string | null }
export type BusinessPurchase = { id: string; status: string; subtotal: number; date?: string }
export type BusinessPortalOrder = { id: string; status: string; total_amount: number; created_at?: string }

export type BusinessData = {
  invoices: BusinessInvoice[]
  payments: ReminderPayment[]
  products: BusinessProduct[]
  clients: BusinessClient[]
  purchases?: BusinessPurchase[]
  portalOrders?: BusinessPortalOrder[]
}

export type BusinessSnapshot = {
  generatedAt: string
  revenue: {
    monthTtc: number
    yearTtc: number
    last12mTtc: number
    monthly: { label: string; value: number }[]
  }
  receivables: {
    openCount: number
    openAmount: number
    overdueCount: number
    overdueAmount: number
    oldestOverdueDays: number
    overdueTop: { invoiceNumber: string; clientName: string; days: number; amount: number }[]
  }
  invoices: { total: number; byStatus: Record<string, number>; pendingCount: number }
  stock: {
    productCount: number
    stockValue: number
    lowCount: number
    lowItems: { name: string; quantity: number; unit: string; threshold: number }[]
  }
  clients: {
    total: number
    bySegment: { segment: ClientSegment; label: string; count: number }[]
    top: { name: string; revenue: number }[]
  }
  purchases: { openCount: number; openAmount: number }
  portalOrders: { total: number; byStatus: Record<string, number> }
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function round2(value: number): number {
  return Math.round(num(value) * 100) / 100
}

export function buildBusinessSnapshot(data: BusinessData, now: Date = new Date()): BusinessSnapshot {
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const yearKey = String(now.getFullYear())

  const billed = data.invoices.filter(i => SNAPSHOT_REVENUE_STATUSES.includes(i.status))
  const monthTtc = billed
    .filter(i => (i.date || '').slice(0, 7) === monthKey)
    .reduce((sum, i) => sum + num(i.total), 0)
  const yearTtc = billed
    .filter(i => (i.date || '').slice(0, 4) === yearKey)
    .reduce((sum, i) => sum + num(i.total), 0)

  const monthly = buildMonthlyRevenueSeries(data.invoices, { months: 12, now })
  const last12mTtc = monthly.reduce((sum, point) => sum + point.revenue, 0)

  const open = data.invoices.filter(i => SNAPSHOT_OPEN_STATUSES.includes(i.status))
  const openAmount = open.reduce((sum, i) => sum + balanceDue(i, data.payments), 0)
  const overdue = overdueOpenInvoices(data.invoices, data.payments, now)
  const overdueAmount = overdue.reduce((sum, row) => sum + row.balance, 0)
  const clientNameById = new Map(data.clients.map(c => [c.id, c.name]))

  const byStatus: Record<string, number> = {}
  for (const invoice of data.invoices) {
    byStatus[invoice.status] = (byStatus[invoice.status] || 0) + 1
  }

  const lowAlerts = buildLowStockAlerts(data.products)
  const stockValue = data.products.reduce(
    (sum, product) => sum + num(product.quantity) * num(product.price_per_unit),
    0,
  )

  const segmentCounts = new Map<ClientSegment, number>()
  for (const client of data.clients) {
    const segment = (client.segment || 'prospect') as ClientSegment
    if (!(segment in SEGMENT_META)) continue
    segmentCounts.set(segment, (segmentCounts.get(segment) || 0) + 1)
  }
  const bySegment = (Object.keys(SEGMENT_META) as ClientSegment[]).map(segment => ({
    segment,
    label: SEGMENT_META[segment].label,
    count: segmentCounts.get(segment) || 0,
  }))

  const top = buildTopClientsSeries(
    data.invoices,
    data.clients.map(c => ({ id: c.id, name: c.name })),
    5,
  ).map(row => ({ name: row.name, revenue: row.revenue }))

  const purchases = data.purchases || []
  const openPurchases = purchases.filter(p => p.status === 'draft' || p.status === 'pending')

  const portalOrders = data.portalOrders || []
  const portalByStatus: Record<string, number> = {}
  for (const order of portalOrders) {
    portalByStatus[order.status] = (portalByStatus[order.status] || 0) + 1
  }

  return {
    generatedAt: now.toISOString(),
    revenue: {
      monthTtc: round2(monthTtc),
      yearTtc: round2(yearTtc),
      last12mTtc: round2(last12mTtc),
      monthly: monthly.map(point => ({ label: point.label, value: point.revenue })),
    },
    receivables: {
      openCount: open.length,
      openAmount: round2(openAmount),
      overdueCount: overdue.length,
      overdueAmount: round2(overdueAmount),
      oldestOverdueDays: overdue.length ? overdue[0].days : 0,
      overdueTop: overdue.slice(0, 8).map(row => ({
        invoiceNumber: row.invoice.invoice_number,
        clientName: (row.invoice.client_id && clientNameById.get(row.invoice.client_id)) || 'Client non renseigné',
        days: row.days,
        amount: row.balance,
      })),
    },
    invoices: {
      total: data.invoices.length,
      byStatus,
      pendingCount: byStatus.pending || 0,
    },
    stock: {
      productCount: data.products.length,
      stockValue: round2(stockValue),
      lowCount: lowAlerts.length,
      lowItems: lowAlerts.slice(0, 8).map(alert => ({
        name: alert.product.name,
        quantity: num(alert.product.quantity),
        unit: alert.product.unit || 'unité',
        threshold: num(alert.product.threshold_alert),
      })),
    },
    clients: { total: data.clients.length, bySegment, top },
    purchases: {
      openCount: openPurchases.length,
      openAmount: round2(openPurchases.reduce((sum, p) => sum + num(p.subtotal), 0)),
    },
    portalOrders: { total: portalOrders.length, byStatus: portalByStatus },
  }
}

// ── Rendu texte pour le prompt ──────────────────────────────────────

function fr(n: number): string {
  return `${Math.round(num(n)).toLocaleString('fr-FR')} FCFA`
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'brouillon',
  pending: 'en attente',
  approved: 'validée',
  partial: 'partielle',
  paid: 'payée',
  cancelled: 'annulée',
}

const ORDER_LABEL: Record<string, string> = {
  nouvelle: 'nouvelle',
  en_cours: 'en cours',
  pret: 'prête',
  livree: 'livrée',
  convertie: 'convertie',
  annulee: 'annulée',
}

function statusList(byStatus: Record<string, number>): string {
  const parts = Object.entries(byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${count} ${STATUS_LABEL[status] || status}`)
  return parts.length ? parts.join(', ') : 'aucune'
}

/** Instantané -> bloc de texte factuel injecté dans le prompt. */
export function snapshotToPrompt(snapshot: BusinessSnapshot): string {
  const lines: string[] = []
  lines.push(`DONNÉES CRM (arrêtées au ${new Date(snapshot.generatedAt).toLocaleDateString('fr-FR')}) :`)
  lines.push(`- Chiffre d'affaires TTC (factures validées/partielles/payées) : mois en cours ${fr(snapshot.revenue.monthTtc)} ; année en cours ${fr(snapshot.revenue.yearTtc)} ; 12 derniers mois ${fr(snapshot.revenue.last12mTtc)}.`)
  lines.push(`- Factures : ${snapshot.invoices.total} au total (${statusList(snapshot.invoices.byStatus)}).`)
  lines.push(`- Créances : ${snapshot.receivables.openCount} facture(s) ouverte(s) pour ${fr(snapshot.receivables.openAmount)} ; dont ${snapshot.receivables.overdueCount} en retard pour ${fr(snapshot.receivables.overdueAmount)}${snapshot.receivables.oldestOverdueDays ? ` (retard le plus ancien : ${snapshot.receivables.oldestOverdueDays} jours)` : ''}.`)
  if (snapshot.receivables.overdueTop.length) {
    lines.push(`- Principaux retards : ${snapshot.receivables.overdueTop.map(r => `${r.clientName} — facture ${r.invoiceNumber} : ${fr(r.amount)} (${r.days} j)`).join(' ; ')}.`)
  }
  lines.push(`- Stock : ${snapshot.stock.productCount} produit(s), valeur ${fr(snapshot.stock.stockValue)} ; ${snapshot.stock.lowCount} produit(s) sous le seuil d'alerte.`)
  for (const item of snapshot.stock.lowItems) {
    lines.push(`  • ${item.name} : ${item.quantity} ${item.unit} (seuil ${item.threshold})`)
  }
  lines.push(`- Clients : ${snapshot.clients.total} fiche(s) — ${snapshot.clients.bySegment.map(s => `${s.label} ${s.count}`).join(', ')}.`)
  if (snapshot.clients.top.length) {
    lines.push(`- Meilleurs clients (12 mois) : ${snapshot.clients.top.map(c => `${c.name} (${fr(c.revenue)})`).join(', ')}.`)
  }
  lines.push(`- Achats en cours (brouillon/commandé) : ${snapshot.purchases.openCount} pour ${fr(snapshot.purchases.openAmount)}.`)
  if (snapshot.portalOrders.total > 0) {
    const detail = Object.entries(snapshot.portalOrders.byStatus)
      .map(([status, count]) => `${count} ${ORDER_LABEL[status] || status}`)
      .join(', ')
    lines.push(`- Commandes portail : ${snapshot.portalOrders.total} (${detail}).`)
  }
  return lines.join('\n')
}
