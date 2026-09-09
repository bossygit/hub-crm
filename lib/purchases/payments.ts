// Logique pure « Paiements fournisseur » (achats).
// Miroir testable de l'agrégation SQL (supabase/fix-purchase-payments.sql) :
// un achat n'entre dans les soldes fournisseur que s'il est commandé ou
// réceptionné (statut hors 'draft' / 'cancelled'), et les paiements d'un
// achat annulé ou brouillon sont ignorés des balances.

export type PurchasePaymentMethod = 'virement' | 'especes' | 'cheque' | 'mobile' | 'autre'

export type PaymentStatus = 'impayee' | 'partielle' | 'payee'

export interface PurchasePayment {
  id: string
  purchase_id: string
  amount: number
  payment_date: string
  method: PurchasePaymentMethod
  reference?: string | null
  notes?: string | null
  created_by?: string | null
  created_at?: string
}

export const PAYMENT_METHODS: PurchasePaymentMethod[] = ['virement', 'especes', 'cheque', 'mobile', 'autre']

export const PAYMENT_METHOD_LABELS: Record<PurchasePaymentMethod, string> = {
  virement: 'Virement',
  especes: 'Espèces',
  cheque: 'Chèque',
  mobile: 'Mobile Money',
  autre: 'Autre',
}

export const PAYMENT_STATUS_CONFIG: Record<PaymentStatus, { label: string; badge: string; icon: string }> = {
  impayee: { label: 'Impayée', badge: 'badge-red', icon: '🔴' },
  partielle: { label: 'Partielle', badge: 'badge-amber', icon: '⏳' },
  payee: { label: 'Payée', badge: 'badge-green', icon: '✅' },
}

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method as PurchasePaymentMethod] || method
}

/** Statut de règlement d'un achat. Un montant nul n'a rien à payer → payée. */
export function computePaymentStatus(totalAmount: number, paid: number): PaymentStatus {
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) return 'payee'
  if (paid >= totalAmount) return 'payee'
  if (paid > 0) return 'partielle'
  return 'impayee'
}

/**
 * Valide la saisie d'un paiement fournisseur.
 * Interdit le trop-perçu : le montant ne peut pas dépasser le solde restant
 * (total - déjà payé). Retourne un message d'erreur en français, ou null.
 */
export function validatePayment(args: { amount: number; totalAmount: number; alreadyPaid?: number }): string | null {
  const { amount, totalAmount, alreadyPaid = 0 } = args
  if (!Number.isFinite(amount) || amount <= 0) return 'Le montant doit être supérieur à zéro.'
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) return 'Aucun solde à régler pour cet achat.'
  const paid = Number.isFinite(alreadyPaid) && alreadyPaid > 0 ? alreadyPaid : 0
  const remaining = totalAmount - paid
  if (amount > remaining) {
    return `Le montant dépasse le solde restant dû (${remaining.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA).`
  }
  return null
}

export interface SupplierBalanceRow {
  supplier_id: string | null
  supplier_name?: string | null
  status: string
  total: number
  paid: number
}

export interface SupplierBalance {
  supplier_id: string
  supplier_name: string
  total_purchases: number
  total_paid: number
  balance: number
}

/**
 * Agrégateur pur des soldes par fournisseur — miroir de supplier_balance_snapshot().
 * Ne comptabilise que les achats commandés/réceptionnés (jamais brouillon ni
 * annulé) rattachés à un fournisseur identifié.
 */
export function supplierBalances(rows: SupplierBalanceRow[]): SupplierBalance[] {
  const acc = new Map<string, SupplierBalance>()
  for (const row of rows) {
    if (!row.supplier_id) continue
    if (row.status === 'draft' || row.status === 'cancelled') continue
    const total = Number(row.total) || 0
    const paid = Number(row.paid) || 0
    const existing = acc.get(row.supplier_id)
    if (existing) {
      existing.total_purchases += total
      existing.total_paid += paid
      existing.balance = existing.total_purchases - existing.total_paid
    } else {
      acc.set(row.supplier_id, {
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name?.trim() || 'Fournisseur',
        total_purchases: total,
        total_paid: paid,
        balance: total - paid,
      })
    }
  }
  return Array.from(acc.values()).sort((a, b) => b.balance - a.balance)
}

/** Montant déjà réglé pour chaque achat (map purchase_id → somme). */
export function paidByPurchase(payments: Pick<PurchasePayment, 'purchase_id' | 'amount'>[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const p of payments) {
    const amount = Number(p.amount) || 0
    map.set(p.purchase_id, (map.get(p.purchase_id) || 0) + amount)
  }
  return map
}

export function formatFCFA(value: number): string {
  return `${(Number(value) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`
}
