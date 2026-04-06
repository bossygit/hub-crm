import jsPDF from 'jspdf'

export interface CertificatePDFData {
  employee_name: string
  position: string
  department: string
  contract_type: string
  hire_date: string
  employee_number?: string
  purpose?: string
  issued_date: string
  doc_ref?: string
}

const GREEN = [26, 61, 43] as const
const DARK = [15, 31, 23] as const
const GOLD = [212, 160, 23] as const

const contractLabels: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', stage: 'Stage', freelance: 'Freelance' }

function dateFR(d: string | Date): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function generateCertificatePDF(data: CertificatePDFData): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pw = 210
  const m = 22
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
  doc.text('DOCUMENT OFFICIEL', pw - m - 25, 13, { align: 'center' })

  y = 52

  // ── Title ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...GREEN)
  doc.text('ATTESTATION DE TRAVAIL', pw / 2, y, { align: 'center' })
  y += 3
  doc.setFillColor(...GOLD)
  doc.rect(pw / 2 - 35, y, 70, 1, 'F')
  y += 14

  // ── Body text ──
  const today = new Date()
  const hireDate = new Date(data.hire_date)
  const diffMs = today.getTime() - hireDate.getTime()
  const years = Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000))
  const months = Math.floor((diffMs / (30.44 * 24 * 60 * 60 * 1000)) % 12)

  const maxW = cw - 10
  const leftX = m + 5

  function paragraph(text: string) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(50, 50, 50)
    const lines = doc.splitTextToSize(text, maxW)
    lines.forEach((line: string) => {
      if (y > 265) { doc.addPage(); y = 25 }
      doc.text(line, leftX, y)
      y += 5
    })
    y += 4
  }

  paragraph(
    'Je soussign\u00e9, le Directeur G\u00e9n\u00e9ral de HUB Distribution SARL, ' +
    'soci\u00e9t\u00e9 sp\u00e9cialis\u00e9e dans la transformation et la distribution ' +
    'de produits agricoles, sise \u00e0 Brazzaville, R\u00e9publique du Congo,'
  )

  const matriculeStr = data.employee_number ? ` (matricule ${data.employee_number})` : ''
  paragraph(
    `Certifie par la pr\u00e9sente que ${data.employee_name}${matriculeStr} ` +
    `est employ\u00e9(e) au sein de notre soci\u00e9t\u00e9 depuis le ${dateFR(data.hire_date)}, ` +
    `soit une anciennet\u00e9 de ${years} an(s) et ${months} mois.`
  )

  paragraph(
    `Il/Elle occupe le poste de ${data.position} au sein du d\u00e9partement ` +
    `${data.department}, sous contrat ${contractLabels[data.contract_type] || '\u2014'}.`
  )

  const purposeStr = data.purpose
    ? `, notamment pour ${data.purpose}`
    : ''
  paragraph(
    `Cette attestation est d\u00e9livr\u00e9e \u00e0 l'int\u00e9ress\u00e9(e) pour servir ` +
    `et valoir ce que de droit${purposeStr}.`
  )

  y += 8
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(85, 85, 85)
  doc.text(`Fait \u00e0 Brazzaville, le ${dateFR(data.issued_date)}.`, leftX, y)
  y += 16

  // ── Signature (right-aligned) ──
  const sigX = pw - m - 60
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(136, 136, 136)
  doc.text('LE DIRECTEUR G\u00c9N\u00c9RAL', sigX + 30, y, { align: 'center' })
  y += 3
  doc.setFontSize(8)
  doc.setTextColor(85, 85, 85)
  doc.setFont('helvetica', 'normal')
  doc.text('HUB Distribution SARL', sigX + 30, y, { align: 'center' })
  y += 5
  doc.setLineDashPattern([2, 2], 0)
  doc.setDrawColor(200, 200, 200)
  doc.roundedRect(sigX, y, 60, 22, 2, 2, 'S')
  doc.setFontSize(7)
  doc.setTextColor(200, 200, 200)
  doc.text('Signature & cachet', sigX + 30, y + 13, { align: 'center' })
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
  if (data.doc_ref) {
    doc.text(`R\u00e9f: ATT-${data.doc_ref}`, pw - m, fy + 6, { align: 'right' })
  }

  return doc
}
