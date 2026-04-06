import jsPDF from 'jspdf'

export interface ContractPDFData {
  employee_name: string
  position: string
  department: string
  contract_type: string
  salary: number
  start_date: string
  end_date?: string | null
  issued_date: string
  clauses?: string
}

const GREEN = [26, 61, 43] as const
const DARK = [15, 31, 23] as const
const GOLD = [212, 160, 23] as const

const contractLabels: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', stage: 'Stage', freelance: 'Freelance' }

function fmt(n: number): string {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}

function dateFR(d: string): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function trialPeriod(type: string): string {
  if (type === 'cdi') return 'trois (3) mois'
  if (type === 'cdd') return 'un (1) mois'
  return 'quinze (15) jours'
}

export function generateContractPDF(data: ContractPDFData): jsPDF {
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
  doc.roundedRect(pw - m - 55, 6, 55, 10, 2, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('CONTRAT DE TRAVAIL', pw - m - 27.5, 13, { align: 'center' })

  y = 44

  // ── Parties ──
  const boxW = (cw - 8) / 2

  doc.setFillColor(248, 245, 238)
  doc.roundedRect(m, y, boxW, 26, 2, 2, 'F')
  doc.setFontSize(6)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(136, 136, 136)
  doc.text('EMPLOYEUR', m + 4, y + 5)
  doc.setFontSize(10)
  doc.setTextColor(...GREEN)
  doc.text('HUB Distribution SARL', m + 4, y + 12)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(85, 85, 85)
  doc.text('Brazzaville, Congo', m + 4, y + 17)
  doc.text('RCCM: BZV-XXXX-XX \u2014 NIF: XXXXXXXXXX', m + 4, y + 22)

  const bx2 = m + boxW + 8
  doc.setFillColor(248, 245, 238)
  doc.roundedRect(bx2, y, boxW, 26, 2, 2, 'F')
  doc.setFontSize(6)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(136, 136, 136)
  doc.text('EMPLOYE(E)', bx2 + 4, y + 5)
  doc.setFontSize(10)
  doc.setTextColor(...GREEN)
  doc.text(data.employee_name, bx2 + 4, y + 12)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(85, 85, 85)
  doc.text(`Poste: ${data.position}`, bx2 + 4, y + 17)
  doc.text(`D\u00e9partement: ${data.department}`, bx2 + 4, y + 22)

  y += 32

  // ── Articles ──
  function articleTitle(num: number, title: string) {
    if (y > 255) { doc.addPage(); y = 20 }
    doc.setFillColor(...GOLD)
    doc.rect(m, y, cw, 0.8, 'F')
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...GREEN)
    doc.text(`Article ${num} \u2014 ${title}`, m, y + 4)
    y += 9
  }

  function articleBody(text: string) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(50, 50, 50)
    const lines = doc.splitTextToSize(text, cw)
    lines.forEach((line: string) => {
      if (y > 270) { doc.addPage(); y = 20 }
      doc.text(line, m, y)
      y += 4.2
    })
    y += 3
  }

  const ctLabel = contractLabels[data.contract_type] || 'CDI'

  articleTitle(1, 'Objet du contrat')
  articleBody(`Le pr\u00e9sent contrat est un ${ctLabel}. L'employ\u00e9(e) est engag\u00e9(e) en qualit\u00e9 de ${data.position} au sein du d\u00e9partement ${data.department}.`)

  articleTitle(2, 'Dur\u00e9e')
  const startStr = dateFR(data.start_date)
  const durationText = data.end_date
    ? `Le contrat prend effet \u00e0 compter du ${startStr} et se termine le ${dateFR(data.end_date)}.`
    : `Le contrat prend effet \u00e0 compter du ${startStr}, pour une dur\u00e9e ind\u00e9termin\u00e9e.`
  articleBody(durationText)

  articleTitle(3, 'R\u00e9mun\u00e9ration')
  articleBody(`L'employ\u00e9(e) percevra une r\u00e9mun\u00e9ration mensuelle brute de ${fmt(data.salary)} FCFA, payable \u00e0 terme \u00e9chu.`)

  articleTitle(4, "P\u00e9riode d'essai")
  articleBody(`Le contrat est soumis \u00e0 une p\u00e9riode d'essai de ${trialPeriod(data.contract_type)}, renouvelable une fois.`)

  articleTitle(5, 'Obligations')
  articleBody("L'employ\u00e9(e) s'engage \u00e0 respecter le r\u00e8glement int\u00e9rieur, les horaires de travail et les consignes de s\u00e9curit\u00e9. Il/elle est tenu(e) \u00e0 une obligation de confidentialit\u00e9 concernant les informations de l'entreprise.")

  articleTitle(6, 'Cong\u00e9s')
  articleBody("L'employ\u00e9(e) b\u00e9n\u00e9ficie de trente (30) jours de cong\u00e9 annuel pay\u00e9 conform\u00e9ment \u00e0 la l\u00e9gislation en vigueur.")

  let nextArticle = 7
  if (data.clauses) {
    articleTitle(nextArticle, 'Clauses particuli\u00e8res')
    articleBody(data.clauses)
    nextArticle++
  }

  articleTitle(nextArticle, 'Droit applicable')
  articleBody('Le pr\u00e9sent contrat est r\u00e9gi par le droit du travail de la R\u00e9publique du Congo.')

  // ── Fait à ──
  y += 4
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(85, 85, 85)
  doc.text(`Fait en deux exemplaires originaux \u00e0 Brazzaville, le ${dateFR(data.issued_date)}.`, m, y)
  y += 10

  // ── Signatures ──
  if (y > 240) { doc.addPage(); y = 20 }
  const sigW = (cw - 20) / 2
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(136, 136, 136)
  doc.text('L\'EMPLOYEUR \u2014 HUB Distribution', m, y)
  doc.text(`L'EMPLOYE(E) \u2014 ${data.employee_name}`, m + sigW + 20, y)
  y += 4
  doc.setLineDashPattern([2, 2], 0)
  doc.setDrawColor(200, 200, 200)
  doc.roundedRect(m, y, sigW, 20, 2, 2, 'S')
  doc.roundedRect(m + sigW + 20, y, sigW, 20, 2, 2, 'S')
  doc.setFontSize(7)
  doc.setTextColor(200, 200, 200)
  doc.text('Signature & cachet', m + sigW / 2, y + 12, { align: 'center' })
  doc.text('Lu et approuv\u00e9, signature', m + sigW + 20 + sigW / 2, y + 12, { align: 'center' })
  doc.setLineDashPattern([], 0)

  // ── Footer ──
  const fy = 283
  doc.setFillColor(...DARK)
  doc.rect(0, fy, pw, 14, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'normal')
  doc.text('HUB Distribution SARL \u2014 RCCM: BZV-XXXX-XX \u2014 NIF: XXXXXXXXXX \u2014 Brazzaville, Congo', m, fy + 6)
  doc.text(
    'G\u00e9n\u00e9r\u00e9 le ' + new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
    pw - m, fy + 6, { align: 'right' }
  )

  return doc
}
