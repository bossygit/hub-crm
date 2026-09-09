// Grand livre auxiliaire simplifié (clients & fournisseurs).
//
// Écritures « mémoire » calculées à partir des tables métier — aucune table
// comptable n'est créée (miroir de lib/reports/journal.ts) :
//   - Comptes clients  (auxiliaire 411) : facture approuvée → DÉBIT client,
//     encaissement → CRÉDIT client.
//   - Comptes fournisseurs (auxiliaire 401) : achat commandé/réceptionné
//     (hors 'draft'/'cancelled') → CRÉDIT fournisseur (dette due),
//     règlement → DÉBIT fournisseur.
//
// Montants en FCFA, une seule colonne (débit ou crédit) renseignée par ligne.

// Imports relatifs avec extension `.ts` : requis par l'exécution des tests sous
// `node --experimental-strip-types`, signalé TS5097 par tsc (voir autres *.test.ts).
// @ts-expect-error — extension .ts obligatoire côté Node, non activée dans tsconfig.
import { formatCsvDate, toExcelCsv } from './csv.ts'

export type LedgerEntry = {
  /** Date ISO YYYY-MM-DD. */
  date: string
  /** N° du document d'origine (facture, achat, …). */
  docNumber: string
  accountId: string
  accountName: string
  accountType: 'client' | 'fournisseur'
  label: string
  debit: number
  credit: number
}

export type LedgerEntryWithBalance = LedgerEntry & { balance: number }

export type LedgerClientInvoice = {
  id: string
  invoice_number: string
  date: string
  status: string
  client_id?: string | null
  /** Total TTC de la facture. */
  total?: number | null
  client?: { id: string; name: string } | null
}

export type LedgerClientPayment = {
  invoice_id: string
  amount?: number | null
  payment_date: string
}

export type LedgerPurchase = {
  id: string
  purchase_number: string
  date: string
  status: string
  supplier_id?: string | null
  /** Montant dû : les achats n'ont pas de TVA, subtotal = total. */
  subtotal?: number | null
  client?: { id: string; name: string } | null
}

export type LedgerSupplierPayment = {
  purchase_id: string
  amount?: number | null
  payment_date: string
}

export const LEDGER_CSV_HEADERS = [
  'Date', 'N° pièce', 'Compte', 'Libellé', 'Débit', 'Crédit', 'Solde',
] as const

const BILLED = new Set(['approved', 'partial', 'paid'])
const CANCELLED_OR_DRAFT = new Set(['draft', 'cancelled'])

function isoDay(value: string): string {
  return value.slice(0, 10)
}

/** Compte rattaché à un document : priorité au tiers embarqué (nom connu). */
function resolveAccount(
  partyId: string | null | undefined,
  party?: { id?: string | null; name?: string | null } | null,
): { accountId: string; accountName: string } | null {
  if (party?.id) return { accountId: party.id, accountName: party.name?.trim() || '' }
  if (partyId) return { accountId: partyId, accountName: '' }
  return null
}

/** Crée une ligne de grand livre, en forçant une seule colonne (débit OU crédit). */
function entry(
  account: { accountId: string; accountName: string },
  accountType: 'client' | 'fournisseur',
  fields: { date: string; docNumber: string; label: string; debit: number; credit: number },
): LedgerEntry {
  return {
    date: isoDay(fields.date),
    docNumber: fields.docNumber,
    accountId: account.accountId,
    accountName: account.accountName,
    accountType,
    label: fields.label,
    debit: fields.debit > 0 ? fields.debit : 0,
    credit: fields.credit > 0 ? fields.credit : 0,
  }
}

function withAccount(
  account: { accountId: string; accountName: string } | null,
  filter?: string | null,
): account is { accountId: string; accountName: string } {
  if (!account) return false
  return !filter || account.accountId === filter
}

function sortByDateLabel(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label),
  )
}

/**
 * Grand livre auxiliaire des comptes clients.
 *
 * - Facture `approved` / `partial` / `paid` → DÉBIT du client (créance) daté
 *   de `invoices.date`, libellé « Facture N° … ».
 * - Encaissement → CRÉDIT du client daté de `payment_date`, libellé
 *   « Encaissement … ». Seul le lien de facture compte : l'encaissement est
 *   retenu quel que soit le statut de la facture, dès lors qu'elle existe.
 *
 * `clientFilter` (id) restreint à un seul compte client. Les lignes sont triées
 * par date puis libellé.
 */
export function buildClientLedger(
  invoices: LedgerClientInvoice[],
  payments: LedgerClientPayment[],
  clientFilter?: string | null,
): LedgerEntry[] {
  const byId = new Map(invoices.map(inv => [inv.id, inv]))

  const lines: LedgerEntry[] = []

  for (const inv of invoices) {
    if (!BILLED.has(inv.status)) continue
    const account = resolveAccount(inv.client_id, inv.client)
    if (!withAccount(account, clientFilter)) continue
    lines.push(entry(account, 'client', {
      date: inv.date,
      docNumber: inv.invoice_number,
      label: `Facture N° ${inv.invoice_number}`,
      debit: Number(inv.total || 0),
      credit: 0,
    }))
  }

  for (const payment of payments) {
    const invoice = payment.invoice_id ? byId.get(payment.invoice_id) : undefined
    if (!invoice) continue
    const account = resolveAccount(invoice.client_id, invoice.client)
    if (!withAccount(account, clientFilter)) continue
    lines.push(entry(account, 'client', {
      date: payment.payment_date,
      docNumber: invoice.invoice_number,
      label: `Encaissement ${invoice.invoice_number}`,
      debit: 0,
      credit: Number(payment.amount || 0),
    }))
  }

  return sortByDateLabel(lines)
}

/**
 * Grand livre auxiliaire des comptes fournisseurs.
 *
 * - Achat commandé ou réceptionné (`pending` / `approved`, jamais brouillon ni
 *   annulé) → CRÉDIT du fournisseur (dette due) daté de `purchases.date`,
 *   libellé « Achat N° … ». Montant dû = `subtotal` (achats sans TVA).
 * - Règlement d'un achat retenu → DÉBIT du fournisseur daté de `payment_date`
 *   (les règlements d'un achat brouillon ou annulé sont ignorés).
 *
 * `supplierFilter` (id) restreint à un seul compte fournisseur. Tri par date
 * puis libellé.
 */
export function buildSupplierLedger(
  purchases: LedgerPurchase[],
  payments: LedgerSupplierPayment[],
  supplierFilter?: string | null,
): LedgerEntry[] {
  const byId = new Map(purchases.map(p => [p.id, p]))

  const lines: LedgerEntry[] = []

  for (const purchase of purchases) {
    if (CANCELLED_OR_DRAFT.has(purchase.status)) continue
    const account = resolveAccount(purchase.supplier_id, purchase.client)
    if (!withAccount(account, supplierFilter)) continue
    lines.push(entry(account, 'fournisseur', {
      date: purchase.date,
      docNumber: purchase.purchase_number,
      label: `Achat N° ${purchase.purchase_number}`,
      debit: 0,
      credit: Number(purchase.subtotal || 0),
    }))
  }

  for (const payment of payments) {
    const purchase = payment.purchase_id ? byId.get(payment.purchase_id) : undefined
    if (!purchase) continue
    if (CANCELLED_OR_DRAFT.has(purchase.status)) continue
    const account = resolveAccount(purchase.supplier_id, purchase.client)
    if (!withAccount(account, supplierFilter)) continue
    lines.push(entry(account, 'fournisseur', {
      date: payment.payment_date,
      docNumber: purchase.purchase_number,
      label: `Règlement ${purchase.purchase_number}`,
      debit: Number(payment.amount || 0),
      credit: 0,
    }))
  }

  return sortByDateLabel(lines)
}

/** Ajoute le solde courant (cumul débits − crédits) ligne après ligne. */
export function withRunningBalance(entries: LedgerEntry[]): LedgerEntryWithBalance[] {
  let balance = 0
  return entries.map(item => {
    balance += item.debit - item.credit
    return { ...item, balance }
  })
}

/** Totaux débit / crédit des lignes. */
export function ledgerTotals(entries: Array<Pick<LedgerEntry, 'debit' | 'credit'>>): {
  debit: number
  credit: number
} {
  let debit = 0
  let credit = 0
  for (const item of entries) {
    debit += item.debit
    credit += item.credit
  }
  return { debit, credit }
}

function scopeSlug(scope: string): string {
  if (scope === 'clients' || scope === 'fournisseurs' || scope === 'tout') return scope
  return 'tout'
}

export function grandLivreCsvFilename(scope: string, month?: string): string {
  const base = `hub-grand-livre-${scopeSlug(scope)}.csv`
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return base.replace('.csv', `-${month}.csv`)
  }
  return base
}

/** Sérialise les lignes (avec solde courant) en CSV Excel — en-têtes FR. */
export function ledgerCsv(entries: LedgerEntryWithBalance[]): string {
  return toExcelCsv([...LEDGER_CSV_HEADERS], entries.map(line => [
    formatCsvDate(line.date),
    line.docNumber,
    line.accountName,
    line.label,
    line.debit,
    line.credit,
    line.balance,
  ]))
}
