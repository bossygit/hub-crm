export const REVENUE_STATUSES = ['approved', 'partial', 'paid'] as const

export type RevenueInvoice = {
  status: string
  subtotal: number
  discount: number
  tax_amount: number
  total: number
  date: string
}

export type InvoiceRevenue = {
  cumulativeHt: number
  monthTtc: number
  collectedVat: number
  pendingCount: number
}

function ht(invoice: RevenueInvoice) {
  return Number(invoice.subtotal || 0) - Number(invoice.discount || 0)
}

export function computeInvoiceRevenue(
  invoices: RevenueInvoice[],
  monthStartIso: string,
): InvoiceRevenue {
  const billed = invoices.filter(inv =>
    (REVENUE_STATUSES as readonly string[]).includes(inv.status),
  )

  return {
    cumulativeHt: billed.reduce((sum, inv) => sum + ht(inv), 0),
    monthTtc: billed
      .filter(inv => inv.date >= monthStartIso.slice(0, 10))
      .reduce((sum, inv) => sum + Number(inv.total || 0), 0),
    collectedVat: billed.reduce((sum, inv) => sum + Number(inv.tax_amount || 0), 0),
    pendingCount: invoices.filter(inv => inv.status === 'pending').length,
  }
}
