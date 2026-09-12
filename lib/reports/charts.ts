/**
 * Graphiques — préparation des séries et géométrie SVG (pur, testable).
 *
 * Aucune dépendance externe : les composants de `components/charts/`
 * consomment directement ces helpers. Le CA retenu est le TTC des factures
 * validées (approved | partial | paid), comme partout ailleurs
 * (lib/reports/revenue.ts, lib/clients/finance.ts).
 */

export const CHART_REVENUE_STATUSES = ['approved', 'partial', 'paid'] as const

export type ChartInvoice = {
  id: string
  date: string
  status: string
  total: number
  client_id?: string | null
}

export type ChartItem = {
  invoice_id: string
  product_id?: string | null
  quantity: number
  subtotal?: number | null
}

export type ChartProduct = { id: string; category?: string | null }

export const CATEGORY_FALLBACK = 'Non catégorisé'

/** Palette alignée sur l'identité HUB (vert/or/bleu). */
export const CHART_PALETTE = [
  '#2d6a4f', '#d4a017', '#3b82f6', '#8b5cf6', '#ef4444',
  '#0ea5e9', '#f97316', '#14b8a6', '#a16207', '#64748b',
]

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function monthKeyOf(dateStr?: string | null): string | null {
  const match = /^(\d{4})-(\d{2})/.exec(dateStr || '')
  return match ? `${match[1]}-${match[2]}` : null
}

export function monthLabel(key: string, opts: { long?: boolean } = {}): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return key
  const d = new Date(Number(match[1]), Number(match[2]) - 1, 1)
  return d.toLocaleDateString('fr-FR', opts.long
    ? { month: 'long', year: 'numeric' }
    : { month: 'short', year: 'numeric' })
}

export type MonthlyPoint = { key: string; label: string; revenue: number; count: number }

/** Série de CA mensuel sur les `months` derniers mois (ordre chronologique). */
export function buildMonthlyRevenueSeries(
  invoices: ChartInvoice[],
  options: { months?: number; now?: Date; statuses?: readonly string[] } = {},
): MonthlyPoint[] {
  const months = Math.max(1, options.months ?? 12)
  const now = options.now ?? new Date()
  const statuses = options.statuses ?? CHART_REVENUE_STATUSES

  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const buckets = new Map<string, MonthlyPoint>(
    keys.map(key => [key, { key, label: monthLabel(key), revenue: 0, count: 0 }]),
  )

  for (const invoice of invoices) {
    if (!statuses.includes(invoice.status)) continue
    const key = monthKeyOf(invoice.date)
    if (!key) continue
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.revenue += num(invoice.total)
    bucket.count += 1
  }

  return keys.map(key => buckets.get(key)!)
}

export type CategoryPoint = { category: string; revenue: number; quantity: number }

/** CA et quantités par catégorie produit (factures validées uniquement). */
export function buildCategoryRevenueSeries(
  items: ChartItem[],
  products: ChartProduct[],
  invoices: ChartInvoice[],
  options: { statuses?: readonly string[] } = {},
): CategoryPoint[] {
  const statuses = options.statuses ?? CHART_REVENUE_STATUSES
  const billed = new Set(invoices.filter(i => statuses.includes(i.status)).map(i => i.id))
  const categoryByProduct = new Map(products.map(p => [p.id, p.category || CATEGORY_FALLBACK]))

  const byCategory = new Map<string, CategoryPoint>()
  for (const item of items) {
    if (!billed.has(item.invoice_id)) continue
    const category = (item.product_id && categoryByProduct.get(item.product_id)) || CATEGORY_FALLBACK
    const row = byCategory.get(category) || { category, revenue: 0, quantity: 0 }
    row.revenue += num(item.subtotal)
    row.quantity += num(item.quantity)
    byCategory.set(category, row)
  }

  return Array.from(byCategory.values()).sort((a, b) => b.revenue - a.revenue)
}

export type ClientPoint = { id: string; name: string; revenue: number }

/** Top clients par CA TTC (factures validées). */
export function buildTopClientsSeries(
  invoices: ChartInvoice[],
  clients: { id: string; name: string }[],
  limit = 5,
  options: { statuses?: readonly string[] } = {},
): ClientPoint[] {
  const statuses = options.statuses ?? CHART_REVENUE_STATUSES
  const nameById = new Map(clients.map(c => [c.id, c.name]))
  const byClient = new Map<string, number>()

  for (const invoice of invoices) {
    if (!statuses.includes(invoice.status)) continue
    if (!invoice.client_id) continue
    byClient.set(invoice.client_id, (byClient.get(invoice.client_id) || 0) + num(invoice.total))
  }

  return Array.from(byClient.entries())
    .map(([id, revenue]) => ({ id, name: nameById.get(id) || 'Client supprimé', revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, Math.max(1, limit))
}

// ── Échelles & géométrie SVG ────────────────────────────────────────

/** Borne haute « ronde » (1/2/5 × 10ⁿ) pour un axe, jamais sous le maximum. */
export function chartScaleMax(values: number[], options: { padRatio?: number; min?: number } = {}): number {
  const max = values.reduce((m, v) => Math.max(m, num(v)), 0)
  if (max <= 0) return options.min ?? 1
  const padded = max * (1 + (options.padRatio ?? 0.15))
  const magnitude = Math.pow(10, Math.floor(Math.log10(padded)))
  const normalized = padded / magnitude
  const step = normalized <= 1.5 ? 1 : normalized <= 3 ? 2 : normalized <= 7 ? 5 : 10
  return Math.max(step * magnitude, max)
}

export function formatCompactFcfa(value: number): string {
  const n = num(value)
  if (Math.abs(n) >= 1_000_000) return `${Math.round(n / 100_000) / 10} M`
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)} k`
  return `${Math.round(n)}`
}

export type Point = { x: number; y: number; value: number }

export function lineChartPoints(
  values: number[],
  width: number,
  height: number,
  max: number,
  padding = 8,
): Point[] {
  if (values.length === 0) return []
  const stepX = values.length > 1 ? width / (values.length - 1) : 0
  const usable = Math.max(1, height - padding * 2)
  return values.map((value, index) => {
    const v = Math.max(0, num(value))
    const ratio = max > 0 ? Math.min(1, v / max) : 0
    return {
      x: Math.round(index * stepX * 100) / 100,
      y: Math.round((padding + usable - ratio * usable) * 100) / 100,
      value: v,
    }
  })
}

export function toLinePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
}

export function toAreaPath(points: Point[], height: number): string {
  if (points.length === 0) return ''
  const last = points[points.length - 1]
  const first = points[0]
  return `${toLinePath(points)} L${last.x},${height} L${first.x},${height} Z`
}

export type BarRect = { x: number; y: number; width: number; height: number }

export function barRects(
  values: number[],
  width: number,
  height: number,
  max: number,
  gap = 8,
): BarRect[] {
  const n = values.length
  if (n === 0) return []
  const slot = width / n
  const barWidth = Math.max(2, slot - gap)
  return values.map((value, index) => {
    const ratio = max > 0 ? Math.min(1, Math.max(0, num(value)) / max) : 0
    const h = ratio * height
    return {
      x: Math.round((index * slot + gap / 2) * 100) / 100,
      y: Math.round((height - h) * 100) / 100,
      width: Math.round(barWidth * 100) / 100,
      height: Math.round(h * 100) / 100,
    }
  })
}

export type DonutSegment = {
  key: string
  label: string
  value: number
  percent: number
  color: string
  /** Décalage cumulé (0→1) pour stroke-dashoffset. */
  offset: number
}

export function donutSegments(
  series: { key: string; label: string; value: number }[],
  colors: string[] = CHART_PALETTE,
): DonutSegment[] {
  const total = series.reduce((sum, s) => sum + Math.max(0, num(s.value)), 0)
  let acc = 0
  return series.map((s, i) => {
    const value = Math.max(0, num(s.value))
    const percent = total > 0 ? value / total : 0
    const segment: DonutSegment = {
      key: s.key,
      label: s.label,
      value,
      percent,
      color: colors[i % colors.length],
      offset: total > 0 ? acc / total : 0,
    }
    acc += value
    return segment
  })
}

export function svgDashArray(percent: number, circumference: number): string {
  const length = Math.max(0, Math.min(1, percent)) * circumference
  return `${length} ${circumference}`
}
