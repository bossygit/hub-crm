import jsPDF from 'jspdf'

export interface InvoicePDFData {
  invoice_number: string
  date: string
  due_date?: string
  status: string
  client?: {
    name: string
    email?: string
    phone?: string
    address?: string
    tax_id?: string
  }
  items: {
    name: string
    description?: string
    quantity: number
    unit: string
    unit_price: number
    subtotal: number
  }[]
  subtotal: number
  discount: number
  tax_rate: number
  tax_amount: number
  total: number
  payment_terms?: string
  notes?: string
  payments?: {
    payment_date: string
    method: string
    amount: number
    reference?: string
  }[]
}

const GREEN = [26, 61, 43] as const
const DARK = [15, 31, 23] as const
const GOLD = [212, 160, 23] as const

function fmt(n: number): string {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}

export function generateInvoicePDF(data: InvoicePDFData): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pw = 210
  const m = 18
  const cw = pw - 2 * m
  let y = 0

  // ── Header bar ──
  doc.setFillColor(...GREEN)
  doc.rect(0, 0, pw, 36, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('HUB Distribution', m, 14)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('Transformation & Distribution Agricole', m, 20)
  doc.text('Brazzaville, République du Congo \u00b7 hub@distribution.cg', m, 25)

  // Invoice badge (right)
  doc.setFillColor(...GOLD)
  doc.roundedRect(pw - m - 45, 6, 45, 10, 2, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('FACTURE', pw - m - 22.5, 13, { align: 'center' })

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13)
  doc.text(data.invoice_number, pw - m, 27, { align: 'right' })

  y = 44

  // ── Meta info boxes ──
  const boxW = (cw - 8) / 3
  const metas = [
    ["Date d'émission", new Date(data.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })],
    ["Date d'échéance", data.due_date ? new Date(data.due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '\u2014'],
    ['Conditions', data.payment_terms || '30 jours'],
  ]
  metas.forEach(([label, value], i) => {
    const bx = m + i * (boxW + 4)
    doc.setFillColor(248, 245, 238)
    doc.roundedRect(bx, y, boxW, 16, 2, 2, 'F')
    doc.setFontSize(6)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(136, 136, 136)
    doc.text(String(label).toUpperCase(), bx + 4, y + 5)
    doc.setFontSize(9)
    doc.setTextColor(...GREEN)
    doc.text(String(value), bx + 4, y + 12)
  })
  y += 22

  // ── Client section ──
  if (data.client) {
    doc.setDrawColor(45, 106, 79)
    doc.setLineWidth(1)
    doc.line(m, y, m, y + 22)
    doc.setFontSize(6)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(136, 136, 136)
    doc.text('FACTURÉ À', m + 4, y + 5)
    doc.setFontSize(11)
    doc.setTextColor(...GREEN)
    doc.setFont('helvetica', 'bold')
    doc.text(data.client.name, m + 4, y + 12)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(85, 85, 85)
    let cy = y + 17
    if (data.client.email) { doc.text(data.client.email, m + 4, cy); cy += 4 }
    if (data.client.phone) { doc.text(data.client.phone, m + 4, cy); cy += 4 }
    if (data.client.address) { doc.text(data.client.address, m + 4, cy); cy += 4 }
    if (data.client.tax_id) { doc.text('NIF: ' + data.client.tax_id, m + 4, cy); cy += 4 }
    y = Math.max(y + 26, cy + 4)
  }

  // ── Items table ──
  // Header
  doc.setFillColor(...GREEN)
  doc.rect(m, y, cw, 8, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'bold')
  const cols = [
    { label: 'DÉSIGNATION', x: m + 3 },
    { label: 'QTÉ', x: m + 95 },
    { label: 'UNITÉ', x: m + 112 },
    { label: 'PRIX UNIT.', x: m + 130 },
  ]
  cols.forEach(c => doc.text(c.label, c.x, y + 5.5))
  doc.text('TOTAL HT', m + cw - 3, y + 5.5, { align: 'right' })
  y += 10

  // Rows
  data.items.forEach((item, i) => {
    if (y > 255) {
      doc.addPage()
      y = 20
    }
    if (i % 2 === 1) {
      doc.setFillColor(250, 250, 247)
      doc.rect(m, y - 2, cw, 9, 'F')
    }
    doc.setTextColor(26, 61, 43)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    const displayName = item.name.length > 45 ? item.name.slice(0, 42) + '...' : item.name
    doc.text(displayName, m + 3, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(26, 26, 26)
    doc.text(String(item.quantity), m + 95, y + 4)
    doc.text(item.unit || '\u2014', m + 112, y + 4)
    doc.text(fmt(item.unit_price) + ' FCFA', m + 130, y + 4)
    doc.setFont('helvetica', 'bold')
    doc.text(fmt(item.subtotal) + ' FCFA', m + cw - 3, y + 4, { align: 'right' })
    y += 9
  })
  y += 6

  // ── Totals ──
  const tx = m + cw - 85
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)

  doc.setTextColor(102, 102, 102)
  doc.text('Sous-total HT', tx, y + 4)
  doc.setTextColor(0, 0, 0)
  doc.text(fmt(data.subtotal) + ' FCFA', m + cw - 3, y + 4, { align: 'right' })
  y += 7

  if (data.discount > 0) {
    doc.setTextColor(102, 102, 102)
    doc.text('Remise', tx, y + 4)
    doc.setTextColor(220, 38, 38)
    doc.text('- ' + fmt(data.discount) + ' FCFA', m + cw - 3, y + 4, { align: 'right' })
    y += 7
  }

  doc.setTextColor(102, 102, 102)
  doc.text('TVA (' + data.tax_rate + '%)', tx, y + 4)
  doc.setTextColor(0, 0, 0)
  doc.text(fmt(data.tax_amount) + ' FCFA', m + cw - 3, y + 4, { align: 'right' })
  y += 10

  // Total final box
  doc.setFillColor(...GREEN)
  doc.roundedRect(tx - 3, y, 88, 15, 3, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('TOTAL TTC', tx + 2, y + 6)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(fmt(data.total) + ' FCFA', m + cw - 6, y + 12, { align: 'right' })
  y += 22

  // ── Payments ──
  if (data.payments && data.payments.length > 0) {
    if (y > 240) { doc.addPage(); y = 20 }
    doc.setFillColor(236, 253, 245)
    doc.roundedRect(m, y, cw, 8 + data.payments.length * 6, 2, 2, 'F')
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(6, 95, 70)
    doc.text('PAIEMENTS ENREGISTRÉS', m + 4, y + 5)
    y += 9
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    data.payments.forEach(p => {
      const label = new Date(p.payment_date).toLocaleDateString('fr-FR') + ' \u2014 ' + p.method
      doc.text(label, m + 4, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.text(fmt(p.amount) + ' FCFA', m + cw - 4, y + 3, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      y += 6
    })
    y += 4
  }

  // ── Notes ──
  if (data.notes) {
    if (y > 250) { doc.addPage(); y = 20 }
    doc.setFillColor(248, 245, 238)
    doc.roundedRect(m, y, cw, 14, 2, 2, 'F')
    doc.setFontSize(6)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(136, 136, 136)
    doc.text('NOTES', m + 4, y + 5)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(85, 85, 85)
    doc.text(data.notes.slice(0, 120), m + 4, y + 11)
    y += 18
  }

  // ── Signatures ──
  if (y > 240) { doc.addPage(); y = 20 }
  y += 6
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.5)

  const sigW = (cw - 20) / 2
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(136, 136, 136)
  doc.text('ÉMETTEUR \u2014 HUB Distribution', m, y)
  doc.text('CLIENT \u2014 ' + (data.client?.name || 'Client'), m + sigW + 20, y)
  y += 4
  doc.setLineDashPattern([2, 2], 0)
  doc.roundedRect(m, y, sigW, 20, 2, 2, 'S')
  doc.roundedRect(m + sigW + 20, y, sigW, 20, 2, 2, 'S')
  doc.setFontSize(7)
  doc.setTextColor(200, 200, 200)
  doc.text('Signature & Cachet', m + sigW / 2, y + 12, { align: 'center' })
  doc.text('Lu et approuvé', m + sigW + 20 + sigW / 2, y + 12, { align: 'center' })
  doc.setLineDashPattern([], 0)

  // ── Footer ──
  const fy = 283
  doc.setFillColor(...DARK)
  doc.rect(0, fy, pw, 14, 'F')
  doc.setTextColor(255, 255, 255, 128)
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'normal')
  doc.text(
    'HUB Distribution \u2014 RCCM: BZV-XXXX-XX \u2014 NIF: XXXXXXXXXX \u2014 Brazzaville, Congo',
    m, fy + 6
  )
  doc.text(
    'Généré le ' + new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
    pw - m, fy + 6, { align: 'right' }
  )

  return doc
}
