/**
 * Alertes stock — logique pure.
 *
 * Un produit est « en alerte » lorsque sa quantité est inférieure ou égale à
 * son seuil (un seuil nul signifie « pas de suivi »). Un mécanisme
 * d'anti-doublon évite de notifier la même chose tous les jours.
 *
 * Les factures en retard (alerte interne) sont gérées dans
 * `lib/clients/reminders.ts` (`overdueOpenInvoices`).
 */

export type StockProduct = {
  id: string
  name: string
  quantity: number
  unit: string
  threshold_alert: number
  price_per_unit?: number | null
}

export type LowStockAlert = {
  product: StockProduct
  shortfall: number
  suggestedOrder: number
  severity: 'critical' | 'warning'
}

/** Nombre de jours pendant lesquels une alerte identique n'est pas répétée. */
export const ALERT_DEDUP_DAYS = 3

/** Multiple du seuil visé pour une commande de réapprovisionnement. */
export const REORDER_TARGET_MULTIPLIER = 2

/** Produits sous le seuil (seuil nul = pas de suivi). */
export function lowStockProducts(products: StockProduct[]): StockProduct[] {
  return products.filter(p => {
    const threshold = Number(p.threshold_alert) || 0
    if (threshold <= 0) return false
    return (Number(p.quantity) || 0) <= threshold
  })
}

/** Quantité suggérée pour repasser au-dessus du seuil. */
export function suggestedReorderQuantity(
  product: StockProduct,
  multiplier: number = REORDER_TARGET_MULTIPLIER,
): number {
  const threshold = Number(product.threshold_alert) || 0
  const quantity = Number(product.quantity) || 0
  if (threshold <= 0) return 0
  const target = threshold * Math.max(1, multiplier)
  return Math.max(0, Math.ceil(target - quantity))
}

export function buildLowStockAlerts(products: StockProduct[]): LowStockAlert[] {
  return lowStockProducts(products)
    .map(product => {
      const threshold = Number(product.threshold_alert) || 0
      const quantity = Number(product.quantity) || 0
      return {
        product,
        shortfall: Math.max(0, threshold - quantity),
        suggestedOrder: suggestedReorderQuantity(product),
        severity: quantity <= threshold / 2 ? ('critical' as const) : ('warning' as const),
      }
    })
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1
      return a.product.name.localeCompare(b.product.name, 'fr')
    })
}

// ── Anti-doublon ────────────────────────────────────────────────────

export type ExistingAlert = {
  type?: string | null
  reference_id?: string | null
  reference_type?: string | null
  created_at: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Vrai si une alerte du même type pour la même référence a déjà été émise
 * dans la fenêtre `windowDays`. Sert à ne pas inonder la cloche.
 */
export function hasRecentAlert(
  existing: ExistingAlert[],
  params: { type: string; referenceId: string },
  now: Date = new Date(),
  windowDays: number = ALERT_DEDUP_DAYS,
): boolean {
  const cutoff = now.getTime() - windowDays * DAY_MS
  return existing.some(a => {
    if (a.type !== params.type) return false
    if ((a.reference_id || '') !== params.referenceId) return false
    const created = new Date(a.created_at).getTime()
    if (Number.isNaN(created)) return false
    return created >= cutoff
  })
}

export function alertKey(type: string, referenceId: string): string {
  return `${type}:${referenceId}`
}

export function stockAlertMessage(alert: LowStockAlert): string {
  const { product } = alert
  const unit = product.unit || 'unité'
  return `Stock bas : ${Number(product.quantity) || 0} ${unit} (seuil ${Number(product.threshold_alert) || 0}). Réapprovisionnement conseillé : ${alert.suggestedOrder} ${unit}.`
}
