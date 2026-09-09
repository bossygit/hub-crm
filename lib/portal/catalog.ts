// Helpers purs du module « Portail : catalogue & commandes ».
// Aucune dépendance externe — testables sans Supabase (node:test).

export interface PortalCartLine {
  product_id: string
  name: string
  quantity: number
  unit_price: number
  unit?: string | null
}

export interface PortalTotals {
  subtotal: number
}

/** Total panier : somme des quantité × prix unitaire, arrondie au centime. */
export function cartTotals(lines: { quantity: number; unit_price: number }[]): PortalTotals {
  const subtotal = (Array.isArray(lines) ? lines : []).reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unit_price) || 0),
    0,
  )
  return { subtotal: Math.round(subtotal * 100) / 100 }
}

export const PORTAL_ORDER_STATUSES = [
  'nouvelle',
  'en_cours',
  'pret',
  'livree',
  'convertie',
  'annulee',
] as const

export type PortalOrderStatus = (typeof PORTAL_ORDER_STATUSES)[number]

export const portalOrderStatusLabels: Record<PortalOrderStatus, string> = {
  nouvelle: 'Nouvelle',
  en_cours: 'En cours',
  pret: 'Prête',
  livree: 'Livrée',
  convertie: 'Convertie',
  annulee: 'Annulée',
}

export const portalOrderStatusColors: Record<PortalOrderStatus, { bg: string; fg: string }> = {
  nouvelle: { bg: '#fef3c7', fg: '#92400e' },
  en_cours: { bg: '#dbeafe', fg: '#1e40af' },
  pret: { bg: '#ede9fe', fg: '#5b21b6' },
  livree: { bg: '#d1fae5', fg: '#065f46' },
  convertie: { bg: '#ccfbf1', fg: '#134e4a' },
  annulee: { bg: '#fee2e2', fg: '#991b1b' },
}

const NEUTRAL_BADGE = { bg: '#f3f4f6', fg: '#374151' }

/** Libellé français d'un statut de commande (retourne le statut brut sinon). */
export function orderStatusLabel(status: string): string {
  return portalOrderStatusLabels[status as PortalOrderStatus] ?? status
}

/** Couleurs de badge (fond / texte) pour un statut de commande. */
export function orderStatusBadge(status: string): { bg: string; fg: string } {
  return portalOrderStatusColors[status as PortalOrderStatus] ?? NEUTRAL_BADGE
}

/** Formatage monétaire français FCFA : 3500 → « 3 500 FCFA ». */
export function formatFCFA(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0 FCFA'
  // toLocaleString('fr-FR') utilise une espace fine insécable (U+202F) :
  // normalisée en espace classique pour un rendu/stockage simple.
  return `${Math.round(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} FCFA`
}

export interface PortalOrderFormInput {
  customer_name: string
  customer_phone: string
  lines: { quantity: number; unit_price: number }[]
}

export type PortalOrderFormErrors = Partial<
  Record<'customer_name' | 'customer_phone' | 'lines', string>
>

/**
 * Valide le formulaire de commande public :
 * nom et téléphone requis, au moins une ligne, quantités strictement positives.
 * Retourne un dictionnaire d'erreurs vide si tout est valide.
 */
export function validateOrderForm(input: PortalOrderFormInput): PortalOrderFormErrors {
  const errors: PortalOrderFormErrors = {}

  const name = (input?.customer_name ?? '').trim()
  const phone = (input?.customer_phone ?? '').trim()

  if (!name) errors.customer_name = 'Veuillez saisir votre nom.'
  if (!phone) errors.customer_phone = 'Veuillez saisir votre numéro de téléphone.'

  const lines = Array.isArray(input?.lines) ? input.lines : []
  if (lines.length === 0) {
    errors.lines = 'Votre panier est vide.'
  } else if (lines.some(line => !(Number(line.quantity) > 0))) {
    errors.lines = 'Chaque quantité doit être supérieure à zéro.'
  }

  return errors
}
