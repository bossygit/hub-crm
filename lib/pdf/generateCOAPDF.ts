import jsPDF from 'jspdf'
import type { CoaConclusion, CoaParameter } from '@/lib/quality/coa'
import { limitsLabel } from '@/lib/quality/coa'

export interface COAPDFData {
  coa_number: string
  product_name: string
  batch_number: string
  expiry_date?: string | null
  production_date?: string | null
  supplier?: string | null
  report_date: string
  laboratory: string
  parameters: CoaParameter[]
  conclusion: CoaConclusion
  notes?: string | null
}

const GREEN = [26, 61, 43] as const
const DARK = [15, 31, 23] as const
const GOLD = [212, 160, 23] as const
const RED = [153, 27, 27] as const
const LIGHT = [248, 245, 238] as const
const WHITE = [255, 255, 255] as const

function dateFR(d: string | Date): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function generateCOAPDF(data: COAPDFData): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pw = 210
  const m = 18
  const cw = pw - 2 * m
  let y = 0

  // ── En-tête ──
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
  doc.roundedRect(pw - m - 64, 6, 64, 10, 2, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('QUALIT\u00c9 / LABO', pw - m - 32, 13, { align: 'center' })

  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text(data.coa_number, pw - m - 32, 24, { align: 'center' })
  doc.setFontSize(6.5)
  doc.setTextColor(220, 220, 220)
  doc.text(`Lot ${data.batch_number}`, pw - m - 32, 30, { align: 'center' })

  y = 50

  // ── Titre ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...GREEN)
  doc.text("CERTIFICAT D'ANALYSE", pw / 2, y, { align: 'center' })
  y += 3
  doc.setFillColor(...GOLD)
  doc.rect(pw / 2 - 45, y, 90, 1, 'F')
  y += 12

  // ── Méta (2 colonnes) ──
  const boxW = cw / 2 - 4
  const boxH = 12
  function metaBox(x: number, label: string, value: string) {
    doc.setFillColor(...LIGHT)
    doc.roundedRect(x, y, boxW, boxH, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5.5)
    doc.setTextColor(140, 140, 140)
    doc.text(label, x + 5, y + 5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(30, 30, 30)
    const v = value || '\u2014'
    const cut = v.length > 42 ? v.slice(0, 41) + '\u2026' : v
    doc.text(cut, x + 5, y + 10)
  }

  metaBox(m, 'PRODUIT', data.product_name)
  metaBox(m + boxW + 8, "N\u00b0 DE LOT", data.batch_number)
  y += boxH + 4
  metaBox(m, 'FOURNISSEUR', data.supplier || '\u2014')
  metaBox(m + boxW + 8, 'LABORATOIRE', data.laboratory || '\u2014')
  y += boxH + 4
  metaBox(m, 'DATE DE PRODUCTION', data.production_date ? dateFR(data.production_date) : '\u2014')
  metaBox(m + boxW + 8, 'DATE DE P\u00c9REMPTION', data.expiry_date ? dateFR(data.expiry_date) : '\u2014')
  y += boxH + 4
  metaBox(m, 'DATE DU RAPPORT', dateFR(data.report_date))
  metaBox(m + boxW + 8, 'R\u00c9F\u00c9RENCE', data.coa_number)
  y += boxH + 10

  // ── Tableau des paramètres ──
  const cols = [
    { t: 'PARAM\u00c8TRE', x: m, w: 56 },
    { t: 'VALEUR MESUR\u00c9E', x: m + 56, w: 46 },
    { t: 'LIMITES', x: m + 102, w: 44 },
    { t: 'CONFORMIT\u00c9', x: m + 146, w: cw - 146 },
  ]
  const rowH = 9
  const headH = 8

  function drawHeader() {
    doc.setFillColor(...GREEN)
    doc.rect(m, y, cw, headH, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    for (const c of cols) doc.text(c.t, c.x + 4, y + 5.4)
    y += headH
  }

  drawHeader()

  if (data.parameters.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(120, 120, 120)
    doc.text('Aucun param\u00e8tre renseign\u00e9.', m + 4, y + 6)
    y += rowH
  } else {
    data.parameters.forEach((p, i) => {
      if (y > 258) {
        doc.addPage()
        y = 20
        drawHeader()
      }
      if (i % 2 === 0) doc.setFillColor(...LIGHT)
      else doc.setFillColor(...WHITE)
      doc.rect(m, y, cw, rowH, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(30, 30, 30)
      doc.text((p.label || '').slice(0, 34), cols[0].x + 4, y + 6)
      doc.setFont('helvetica', 'normal')
      doc.text(String(p.value || '\u2014').slice(0, 24), cols[1].x + 4, y + 6)
      doc.setTextColor(100, 100, 100)
      doc.text(limitsLabel(p).slice(0, 22), cols[2].x + 4, y + 6)
      const labelOk = p.ok ? 'Conforme' : 'Non conforme'
      if (p.ok) doc.setTextColor(...GREEN)
      else doc.setTextColor(...RED)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.text(labelOk, cols[3].x + 4, y + 6)
      y += rowH
    })
  }

  y += 4

  // ── Conclusion ──
  if (y > 245) { doc.addPage(); y = 25 }
  const conform = data.conclusion === 'conforme'
  if (conform) doc.setFillColor(...GREEN)
  else doc.setFillColor(...RED)
  doc.roundedRect(m, y, cw, 20, 3, 3, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6)
  doc.setTextColor(255, 255, 255)
  doc.text('CONCLUSION DU CERTIFICAT', m + 6, y + 7)
  doc.setFontSize(12)
  doc.text(conform ? 'CONFORME' : 'NON CONFORME', m + 6, y + 15)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(
    conform
      ? 'Le lot r\u00e9pond aux sp\u00e9cifications analys\u00e9es et peut \u00eatre lib\u00e9r\u00e9.'
      : 'Au moins un param\u00e8tre est hors sp\u00e9cification : la lib\u00e9ration du lot est bloqu\u00e9e.',
    m + 6, y + 17, { maxWidth: cw - 12 }
  )
  y += 26

  if (data.notes) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(30, 30, 30)
    doc.text('Notes :', m, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(80, 80, 80)
    const lines = doc.splitTextToSize(data.notes, cw)
    for (const line of lines as string[]) {
      if (y > 268) { doc.addPage(); y = 25 }
      doc.text(line, m, y)
      y += 4.5
    }
    y += 4
  }

  // ── Signatures ──
  if (y > 240) { doc.addPage(); y = 25 }
  y += 6
  const sigW = (cw - 12) / 2
  ;[
    { label: "L'ANALYSTE / LE LABORATOIRE", sub: data.laboratory || 'Signature' },
    { label: 'LE RESPONSABLE QUALIT\u00c9', sub: 'Signature & cachet' },
  ].forEach((sig, i) => {
    const sx = m + i * (sigW + 12)
    doc.setLineDashPattern([2, 2], 0)
    doc.setDrawColor(190, 190, 190)
    doc.roundedRect(sx, y, sigW, 20, 2, 2, 'S')
    doc.setLineDashPattern([], 0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(120, 120, 120)
    doc.text(sig.label, sx + sigW / 2, y + 6, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(sig.sub.slice(0, 40), sx + sigW / 2, y + 15, { align: 'center' })
  })

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
  doc.text(`COA: ${data.coa_number}`, pw - m, fy + 6, { align: 'right' })

  return doc
}
