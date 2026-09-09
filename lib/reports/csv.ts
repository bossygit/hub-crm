export const SALES_CSV_HEADERS = [
  'Date', 'N°', 'Client', 'NIF', 'Statut', 'HT', 'Remise', 'TVA', 'TTC', 'Encaissé', 'Solde',
] as const

export const RECEIPT_CSV_HEADERS = [
  'Date', 'N° facture', 'Client', 'NIF', 'Mode', 'Référence', 'Montant',
] as const

export function formatCsvDate(iso: string): string {
  const day = iso.slice(0, 10)
  const [year, month, date] = day.split('-')
  if (!year || !month || !date) return iso
  return `${date}/${month}/${year}`
}

function formatCsvNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2).replace('.', ',')
}

function escapeCsvField(value: string | number): string {
  const text = typeof value === 'number' ? formatCsvNumber(value) : String(value)
  if (/[;"\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toExcelCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [
    headers.map(escapeCsvField).join(';'),
    ...rows.map(row => row.map(escapeCsvField).join(';')),
  ]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export function salesCsvFilename(month: string): string {
  return `hub-ventes-${month}.csv`
}

export function receiptsCsvFilename(month: string): string {
  return `hub-encaissements-${month}.csv`
}

export function salesJournalToCsv(lines: Array<{
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
}>): string {
  return toExcelCsv([...SALES_CSV_HEADERS], lines.map(line => [
    formatCsvDate(line.date),
    line.invoiceNumber,
    line.clientName,
    line.nif,
    line.statusLabel,
    line.ht,
    line.discount,
    line.vat,
    line.ttc,
    line.collected,
    line.balance,
  ]))
}

export function receiptsJournalToCsv(lines: Array<{
  date: string
  invoiceNumber: string
  clientName: string
  nif: string
  method: string
  reference: string
  amount: number
}>): string {
  return toExcelCsv([...RECEIPT_CSV_HEADERS], lines.map(line => [
    formatCsvDate(line.date),
    line.invoiceNumber,
    line.clientName,
    line.nif,
    line.method,
    line.reference,
    line.amount,
  ]))
}
