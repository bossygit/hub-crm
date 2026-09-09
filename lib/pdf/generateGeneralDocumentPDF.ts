import jsPDF from 'jspdf'

export interface GeneralDocumentRecipient {
  type: 'client' | 'employee'
  name: string
  company?: string
  address?: string
}

export interface GeneralDocumentPDFData {
  reference: string
  doc_date: string
  typeLabel: string
  object?: string
  recipient?: GeneralDocumentRecipient | null
  body: string
  signed_by?: string
  generated_at?: string
}

const GREEN = [26, 61, 43] as const
const DARK = [15, 31, 23] as const
const GOLD = [212, 160, 23] as const

function dateFR(d: string | Date): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

// Caractères sûrs pour les polices standard jsPDF (WinAnsi) : on retire tout
// ce qui ne peut pas être encodé (emojis, autres scripts) sans faire planter
// ou dégrader le rendu du corps du document.
const WIN_ANSI_SAFE = /^[\x20-\x7E\u00A0-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]$/

function sanitize(text: string): string {
  return Array.from(text)
    .map(ch => (WIN_ANSI_SAFE.test(ch) ? ch : ''))
    .join('')
}

export function generateGeneralDocumentPDF(data: GeneralDocumentPDFData): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pw = 210
  const m = 22
  const cw = pw - 2 * m
  const bodyMaxW = cw - 6
  const leftX = m + 3
  let y = 0

  // ── Bandeau d'en-tête ──
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
  doc.roundedRect(pw - m - 56, 6, 56, 10, 2, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('DOCUMENT G\u00c9N\u00c9RAL', pw - m - 28, 13, { align: 'center' })

  // ── Titre (catégorie du document) ──
  y = 50
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...GREEN)
  doc.text(sanitize(data.typeLabel).toUpperCase(), pw / 2, y, { align: 'center' })
  y += 3
  doc.setFillColor(...GOLD)
  const labelW = Math.max(24, Math.min(84, sanitize(data.typeLabel).length * 2.4))
  doc.rect(pw / 2 - labelW / 2, y, labelW, 0.9, 'F')
  y += 7

  // ── Référence + date ──
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(85, 85, 85)
  const refLine = `R\u00e9f. ${data.reference}   \u2014   Fait \u00e0 Brazzaville, le ${dateFR(data.doc_date)}`
  doc.text(refLine, pw / 2, y, { align: 'center' })
  y += 10

  // ── Objet ──
  if (data.object && data.object.trim()) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(...GOLD)
    doc.text('OBJET', leftX, y)
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...DARK)
    const objLines = doc.splitTextToSize(sanitize(data.object.trim()), bodyMaxW) as string[]
    objLines.forEach((line: string) => {
      if (y > 268) { doc.addPage(); y = 22 }
      doc.text(line, leftX, y)
      y += 5.4
    })
    y += 6
  }

  // ── Destinataire ──
  if (data.recipient && data.recipient.name) {
    const r = data.recipient
    const boxH = 24
    if (y + boxH > 272) { doc.addPage(); y = 22 }
    doc.setFillColor(248, 245, 238)
    doc.roundedRect(m, y, cw, boxH, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(136, 136, 136)
    doc.text('DESTINATAIRE', m + 4, y + 5)
    doc.setFontSize(10)
    doc.setTextColor(...GREEN)
    doc.text(sanitize(r.name), m + 4, y + 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(85, 85, 85)
    const kindLabel = r.type === 'client' ? 'Client / Partenaire' : 'Employ\u00e9(e)'
    const comp = r.company && r.company.trim() ? ` \u2014 ${sanitize(r.company.trim())}` : ''
    doc.text(kindLabel + comp, m + 4, y + 17)
    if (r.address && r.address.trim()) {
      doc.text(sanitize(r.address.trim()), m + 4, y + 21)
    }
    y += boxH + 8
  } else {
    y += 4
  }

  // ── Corps du document ──
  const paragraphs = (data.body || '').split(/\n+/).map(p => p.trim()).filter(Boolean)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(50, 50, 50)
  if (paragraphs.length === 0) {
    doc.setTextColor(170, 170, 170)
    doc.text('(Aucun contenu)', leftX, y)
    y += 6
  } else {
    paragraphs.forEach(para => {
      const lines = doc.splitTextToSize(sanitize(para), bodyMaxW) as string[]
      lines.forEach((line: string) => {
        if (y > 268) { doc.addPage(); y = 22 }
        doc.text(line, leftX, y)
        y += 5
      })
      y += 3.5
    })
  }

  // ── Clôture + signature ──
  y += 6
  if (y > 262) { doc.addPage(); y = 24 }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(85, 85, 85)
  doc.text(`Fait \u00e0 Brazzaville, le ${dateFR(data.doc_date)}.`, leftX, y)
  y += 16

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
  if (data.signed_by && data.signed_by.trim()) {
    doc.setFontSize(6.5)
    doc.setTextColor(150, 150, 150)
    doc.text(`Par : ${sanitize(data.signed_by.trim())}`, sigX + 30, y + 25, { align: 'center' })
  }

  // ── Pied de page ──
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
  const genAt = data.generated_at
    ? `G\u00e9n\u00e9r\u00e9 le ${dateFR(data.generated_at)}`
    : `G\u00e9n\u00e9r\u00e9 le ${dateFR(new Date().toISOString())}`
  doc.text(`R\u00e9f: ${data.reference} \u2022 ${genAt}`, pw - m, fy + 6, { align: 'right' })

  return doc
}
