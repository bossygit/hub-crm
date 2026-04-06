import jsPDF from 'jspdf'

export interface PayslipPDFData {
  employee_name: string
  position: string
  department: string
  employee_number?: string
  month: string
  year: string | number
  base_salary: number
  transport: number
  housing: number
  bonus: number
  gross: number
  cnss_rate: number
  cnss: number
  its_rate: number
  its: number
  other_deduction: number
  totalDeductions: number
  net: number
}

const GREEN = [26, 61, 43] as const
const DARK = [15, 31, 23] as const
const GOLD = [212, 160, 23] as const

function fmt(n: number): string {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}

export function generatePayslipPDF(data: PayslipPDFData): jsPDF {
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
  doc.text('Brazzaville, R\u00e9publique du Congo', m, 25)

  doc.setFillColor(...GOLD)
  doc.roundedRect(pw - m - 50, 6, 50, 10, 2, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('BULLETIN DE PAIE', pw - m - 25, 13, { align: 'center' })

  y = 42

  // ── Period ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...GREEN)
  doc.text(`${data.month} ${data.year}`, pw / 2, y, { align: 'center' })
  y += 10

  // ── Employee info boxes ──
  const boxW = (cw - 8) / 2
  doc.setFillColor(248, 245, 238)
  doc.roundedRect(m, y, boxW, 22, 2, 2, 'F')
  doc.setFontSize(6)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(136, 136, 136)
  doc.text('EMPLOY\u00c9', m + 4, y + 5)
  doc.setFontSize(10)
  doc.setTextColor(...GREEN)
  doc.text(data.employee_name, m + 4, y + 12)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(85, 85, 85)
  doc.text(`${data.position} \u2014 ${data.department}`, m + 4, y + 18)

  const bx2 = m + boxW + 8
  doc.setFillColor(248, 245, 238)
  doc.roundedRect(bx2, y, boxW, 22, 2, 2, 'F')
  doc.setFontSize(6)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(136, 136, 136)
  doc.text('MATRICULE', bx2 + 4, y + 5)
  doc.setFontSize(11)
  doc.setTextColor(...GREEN)
  doc.setFont('courier', 'bold')
  doc.text(data.employee_number || '\u2014', bx2 + 4, y + 14)
  doc.setFont('helvetica', 'normal')

  y += 28

  // ── Gains table ──
  function sectionTitle(title: string) {
    doc.setFillColor(...GOLD)
    doc.rect(m, y, cw, 0.8, 'F')
    y += 3
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...GREEN)
    doc.text(title, m, y + 4)
    y += 9
  }

  function tableHeader() {
    doc.setFillColor(...GREEN)
    doc.rect(m, y, cw, 7, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'bold')
    doc.text('RUBRIQUE', m + 4, y + 5)
    doc.text('MONTANT', m + cw - 4, y + 5, { align: 'right' })
    y += 9
  }

  function tableRow(label: string, value: string, bold = false, color?: readonly [number, number, number]) {
    if (bold) {
      doc.setFillColor(248, 245, 238)
      doc.rect(m, y - 1.5, cw, 8, 'F')
    }
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(8)
    doc.setTextColor(50, 50, 50)
    doc.text(label, m + 4, y + 4)
    if (color) doc.setTextColor(...color)
    doc.text(value, m + cw - 4, y + 4, { align: 'right' })
    y += 8
  }

  sectionTitle('Gains')
  tableHeader()
  tableRow('Salaire de base', `${fmt(data.base_salary)} FCFA`)
  if (data.transport > 0) tableRow('Indemnit\u00e9 de transport', `${fmt(data.transport)} FCFA`)
  if (data.housing > 0) tableRow('Indemnit\u00e9 de logement', `${fmt(data.housing)} FCFA`)
  if (data.bonus > 0) tableRow('Primes / Bonus', `${fmt(data.bonus)} FCFA`)
  tableRow('Salaire brut', `${fmt(data.gross)} FCFA`, true, GREEN)
  y += 4

  // ── Deductions table ──
  sectionTitle('Retenues')
  tableHeader()
  tableRow(`CNSS (${data.cnss_rate}%)`, `- ${fmt(data.cnss)} FCFA`, false, [220, 38, 38])
  tableRow(`ITS / IRPP (${data.its_rate}%)`, `- ${fmt(data.its)} FCFA`, false, [220, 38, 38])
  if (data.other_deduction > 0) tableRow('Autres retenues', `- ${fmt(data.other_deduction)} FCFA`, false, [220, 38, 38])
  tableRow('Total retenues', `- ${fmt(data.totalDeductions)} FCFA`, true, [220, 38, 38])
  y += 6

  // ── Net pay box ──
  doc.setFillColor(...GREEN)
  doc.roundedRect(m, y, cw, 18, 3, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('NET \u00c0 PAYER', m + 6, y + 7)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(`${fmt(data.net)} FCFA`, m + cw - 6, y + 13, { align: 'right' })
  y += 26

  // ── Signatures ──
  if (y > 240) { doc.addPage(); y = 20 }
  const sigW = (cw - 20) / 2
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(136, 136, 136)
  doc.text("L'EMPLOYEUR", m + sigW / 2, y, { align: 'center' })
  doc.text("L'EMPLOY\u00c9(E)", m + sigW + 20 + sigW / 2, y, { align: 'center' })
  y += 4
  doc.setLineDashPattern([2, 2], 0)
  doc.setDrawColor(200, 200, 200)
  doc.roundedRect(m, y, sigW, 18, 2, 2, 'S')
  doc.roundedRect(m + sigW + 20, y, sigW, 18, 2, 2, 'S')
  doc.setFontSize(7)
  doc.setTextColor(200, 200, 200)
  doc.text('Signature & cachet', m + sigW / 2, y + 10, { align: 'center' })
  doc.text('Signature', m + sigW + 20 + sigW / 2, y + 10, { align: 'center' })
  doc.setLineDashPattern([], 0)

  // ── Footer ──
  const fy = 283
  doc.setFillColor(...DARK)
  doc.rect(0, fy, pw, 14, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'normal')
  doc.text(
    'HUB Distribution SARL \u2014 RCCM: BZV-XXXX-XX \u2014 NIF: XXXXXXXXXX \u2014 Brazzaville, Congo',
    m, fy + 6
  )
  doc.text('Bulletin confidentiel', pw - m, fy + 6, { align: 'right' })

  return doc
}
