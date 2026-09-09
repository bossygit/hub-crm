function billed(status: string): boolean {
  return status === 'approved' || status === 'partial' || status === 'paid'
}

export type JournalInvoice = {
  id: string
  invoice_number: string
  date: string
  status: string
  subtotal: number
  discount: number
  tax_amount: number
  total: number
  client_id?: string | null
}

export type JournalClient = {
  id: string
  name: string
  tax_id?: string | null
}

export type JournalPayment = {
  invoice_id: string
  amount: number
  payment_date: string
  method: string
  reference?: string | null
}

export type SalesJournalLine = {
  date: string
  invoiceNumber: string
  clientName: string
  nif: string
  statusLabel: string
  ht: number
  discount: number
  vat: number
  ttc: number
  collected: number
  balance: number
}

export type ReceiptJournalLine = {
  date: string
  invoiceNumber: string
  clientName: string
  nif: string
  method: string
  reference: string
  amount: number
}

export type MonthJournal = {
  month: string
  sales: SalesJournalLine[]
  receipts: ReceiptJournalLine[]
  monthHt: number
  monthTtc: number
  monthVat: number
  monthCollected: number
  monthOutstanding: number
  cumulativeHt: number
  pendingCount: number
}

const STATUS_LABEL: Record<string, string> = {
  approved: 'Validée',
  partial: 'Partielle',
  paid: 'Payée',
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function resolveMonth(param?: string | null): string {
  if (param && MONTH_RE.test(param)) return param
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function isoDay(value: string): string {
  return value.slice(0, 10)
}

function monthEnd(month: string): string {
  const year = Number(month.slice(0, 4))
  const monthIndex = Number(month.slice(5, 7))
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  return `${month}-${String(last).padStart(2, '0')}`
}

function inMonth(value: string, month: string): boolean {
  const day = isoDay(value)
  return day >= `${month}-01` && day <= monthEnd(month)
}

function ht(invoice: JournalInvoice): number {
  return Number(invoice.subtotal || 0) - Number(invoice.discount || 0)
}

export function buildMonthJournal(
  invoices: JournalInvoice[],
  clients: JournalClient[],
  payments: JournalPayment[],
  month: string,
): MonthJournal {
  const clientById = new Map(clients.map(c => [c.id, c]))
  const invoiceById = new Map(invoices.map(inv => [inv.id, inv]))
  const paidByInvoice = new Map<string, number>()
  for (const payment of payments) {
    paidByInvoice.set(
      payment.invoice_id,
      (paidByInvoice.get(payment.invoice_id) || 0) + Number(payment.amount || 0),
    )
  }

  const sales: SalesJournalLine[] = invoices
    .filter(inv => billed(inv.status) && inMonth(inv.date, month))
    .map(inv => {
      const client = inv.client_id ? clientById.get(inv.client_id) : undefined
      const ttc = Number(inv.total || 0)
      const collected = paidByInvoice.get(inv.id) || 0
      return {
        date: isoDay(inv.date),
        invoiceNumber: inv.invoice_number,
        clientName: client?.name || '',
        nif: client?.tax_id || '',
        statusLabel: STATUS_LABEL[inv.status] || inv.status,
        ht: ht(inv),
        discount: Number(inv.discount || 0),
        vat: Number(inv.tax_amount || 0),
        ttc,
        collected,
        balance: Math.max(0, ttc - collected),
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNumber.localeCompare(b.invoiceNumber))

  const receipts: ReceiptJournalLine[] = payments
    .filter(p => inMonth(p.payment_date, month))
    .map(p => {
      const inv = invoiceById.get(p.invoice_id)
      const client = inv?.client_id ? clientById.get(inv.client_id) : undefined
      return {
        date: isoDay(p.payment_date),
        invoiceNumber: inv?.invoice_number || '',
        clientName: client?.name || '',
        nif: client?.tax_id || '',
        method: p.method || '',
        reference: p.reference || '',
        amount: Number(p.amount || 0),
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNumber.localeCompare(b.invoiceNumber))

  return {
    month,
    sales,
    receipts,
    monthHt: sales.reduce((s, row) => s + row.ht, 0),
    monthTtc: sales.reduce((s, row) => s + row.ttc, 0),
    monthVat: sales.reduce((s, row) => s + row.vat, 0),
    monthCollected: receipts.reduce((s, row) => s + row.amount, 0),
    monthOutstanding: sales.reduce((s, row) => s + row.balance, 0),
    cumulativeHt: invoices.filter(inv => billed(inv.status)).reduce((s, inv) => s + ht(inv), 0),
    pendingCount: invoices.filter(inv => inv.status === 'pending').length,
  }
}
