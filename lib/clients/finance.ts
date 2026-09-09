// ─────────────────────────────────────────────────────
// Clients — agrégats financiers purs (fiche partenaire)
//
// Pure & sans dépendance Supabase : testable via
// `node --experimental-strip-types --test`.
//
// Statuts comptabilisés dans le chiffre d'affaires / le
// solde client : approved | partial | paid — miroir de
// lib/reports/revenue.ts (REVENUE_STATUSES). Garder les
// deux listes synchronisées.
// ─────────────────────────────────────────────────────

export const CLIENT_REVENUE_STATUSES = ['approved', 'partial', 'paid'] as const

/** Factures validées mais pas encore intégralement réglées. */
export const OUTSTANDING_STATUSES = ['approved', 'partial'] as const

const REVENUE = CLIENT_REVENUE_STATUSES as readonly string[]
const OUTSTANDING = OUTSTANDING_STATUSES as readonly string[]

export interface ClientInvoiceInput {
  id: string
  date: string
  status: string
  total: number
}

export interface ClientPaymentInput {
  invoice_id: string
  amount: number
  payment_date: string
}

export interface ClientPurchaseInput {
  id: string
  date: string
  status: string
  subtotal: number
}

export interface SupplierPaymentInput {
  purchase_id: string
  amount: number
  payment_date: string
}

export interface ClientFinanceSummary {
  /** TTC des factures validées (approved/partial/paid). */
  totalInvoiced: number
  /** Nombre de factures (tous statuts confondus). */
  invoiceCount: number
  /** Cumul des paiements reçus sur ces factures. */
  totalPaid: number
  /** Solde dû = facturé − payé (jamais négatif). */
  balanceDue: number
  /** Factures validées non soldées (approved/partial avec reste dû). */
  outstandingInvoices: number
  // Volet fournisseur — renseigné si des achats sont fournis.
  totalPurchased: number
  purchaseCount: number
  supplierPaid: number
  supplierBalanceDue: number
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0)
}

/**
 * Calcule le résumé financier d'un partenaire à partir de ses
 * factures et paiements (et, pour les fournisseurs, de ses achats).
 *
 * Ne comptent pour le CA / le solde que les factures validées
 * (approved | partial | paid) — draft, pending et cancelled sont
 * écartées, comme dans lib/reports/revenue.ts.
 */
export function computeClientFinance(
  invoices: ClientInvoiceInput[],
  payments: ClientPaymentInput[],
  purchases: ClientPurchaseInput[] = [],
  supplierPayments: SupplierPaymentInput[] = [],
): ClientFinanceSummary {
  // Paiements cumulés par facture.
  const paidByInvoice = new Map<string, number>()
  for (const p of payments) {
    const paid = num(p.amount)
    if (paid > 0) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) || 0) + paid)
  }

  const invoiced = invoices.filter(i => REVENUE.includes(i.status))
  const invoicedIds = new Set(invoiced.map(i => i.id))

  const totalInvoiced = sum(invoiced.map(i => num(i.total)))
  const totalPaid = sum(
    payments.filter(p => invoicedIds.has(p.invoice_id)).map(p => num(p.amount)),
  )
  const balanceDue = Math.max(0, totalInvoiced - totalPaid)

  const outstandingInvoices = invoiced.filter(i => {
    if (!OUTSTANDING.includes(i.status)) return false
    const remaining = num(i.total) - (paidByInvoice.get(i.id) || 0)
    return remaining > 0.009
  }).length

  // Volet achats (fournisseur) : un achat commandé ou réceptionné
  // (pending | approved) représente une dette envers le fournisseur —
  // brouillons et annulés écartés, comme lib/purchases/payments.ts.
  const owed = purchases.filter(p => p.status === 'pending' || p.status === 'approved')
  const owedIds = new Set(owed.map(p => p.id))
  const totalPurchased = sum(owed.map(p => num(p.subtotal)))
  const supplierPaid = sum(
    supplierPayments.filter(p => owedIds.has(p.purchase_id)).map(p => num(p.amount)),
  )
  const supplierBalanceDue = Math.max(0, totalPurchased - supplierPaid)

  return {
    totalInvoiced,
    invoiceCount: invoices.length,
    totalPaid,
    balanceDue,
    outstandingInvoices,
    totalPurchased,
    purchaseCount: owed.length,
    supplierPaid,
    supplierBalanceDue,
  }
}
