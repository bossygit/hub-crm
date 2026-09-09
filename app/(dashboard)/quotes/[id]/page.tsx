'use client'
import { useCallback, useEffect, useState } from 'react'
import jsPDF from 'jspdf'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/components/ui/Toast'
import { savePDFAndUpdateRecord, getSignedPDFUrl } from '@/lib/storage/uploadPDF'

const statusConfig: Record<string, { label: string; badge: string; icon: string; color: [number, number, number] }> = {
  draft:     { label: 'Brouillon',  badge: 'badge-gray',  icon: '✏️', color: [107, 114, 128] },
  pending:   { label: 'En attente', badge: 'badge-amber', icon: '⏳', color: [180, 83, 9] },
  approved:  { label: 'Accepté',    badge: 'badge-green', icon: '✅', color: [6, 95, 70] },
  rejected:  { label: 'Refusé',     badge: 'badge-red',   icon: '❌', color: [153, 27, 27] },
  converted: { label: 'Converti',   badge: 'badge-blue',  icon: '🔄', color: [30, 64, 175] },
}

const GREEN: [number, number, number] = [26, 61, 43]
const DARK: [number, number, number] = [15, 31, 23]
const GOLD: [number, number, number] = [212, 160, 23]

const fmt = (n: number | string | null | undefined) =>
  Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })

const frDate = (d?: string | null) =>
  d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'

function todayISO(): string { return new Date().toISOString().slice(0, 10) }

// ── Générateur PDF devis (style lib/pdf/generateInvoicePDF.ts) ──
function generateQuotePDF(q: any, its: any[]): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pw = 210
  const m = 18
  const cw = pw - 2 * m
  let y = 0
  const cfg = statusConfig[q.status] || statusConfig.draft
  const client = q.client || {}
  const dateStr = (q.content?.document_date || new Date(q.created_at).toISOString().slice(0, 10))
  const notes = q.content?.notes || ''

  // ── Header ──
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

  doc.setFillColor(...GOLD)
  doc.roundedRect(pw - m - 45, 6, 45, 10, 2, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('DEVIS', pw - m - 22.5, 13, { align: 'center' })

  doc.setFontSize(13)
  doc.text(q.document_number || '', pw - m, 27, { align: 'right' })
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text(q.title || 'Devis commercial', pw - m, 32, { align: 'right' })

  y = 44

  // ── Meta ──
  const boxW = (cw - 8) / 3
  const metas = [
    ['Date du devis', frDate(dateStr)],
    ['Validité', frDate(q.due_date)],
    ['Conditions', q.payment_terms || '30 jours'],
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

  // ── Statut ──
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...cfg.color)
  doc.text(`${cfg.icon} ${cfg.label.toUpperCase()}`, m, y + 2)
  y += 6

  // ── Avertissement validité ──
  if (q.due_date) {
    doc.setFillColor(254, 243, 199)
    doc.roundedRect(m, y, cw, 8, 2, 2, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(146, 64, 14)
    doc.text(`Ce devis est valable jusqu'au ${frDate(q.due_date)}. Passé ce délai, les prix peuvent être révisés.`, m + 4, y + 5.5)
    y += 12
  }

  // ── Client ──
  doc.setDrawColor(45, 106, 79)
  doc.setLineWidth(1)
  doc.line(m, y, m, y + 20)
  doc.setFontSize(6)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(136, 136, 136)
  doc.text('CLIENT', m + 4, y + 5)
  doc.setFontSize(11)
  doc.setTextColor(...GREEN)
  doc.text(client.name || 'Client non renseigné', m + 4, y + 12)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(85, 85, 85)
  let cy = y + 17
  if (client.email) { doc.text(client.email, m + 4, cy); cy += 4 }
  if (client.phone) { doc.text(client.phone, m + 4, cy); cy += 4 }
  if (client.tax_id) { doc.text('NIF: ' + client.tax_id, m + 4, cy); cy += 4 }
  y = Math.max(y + 24, cy + 4)

  // ── Table articles ──
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

  its.forEach((item, i) => {
    if (y > 258) { doc.addPage(); y = 20 }
    if (i % 2 === 1) {
      doc.setFillColor(250, 250, 247)
      doc.rect(m, y - 2, cw, 9, 'F')
    }
    const lot = item.batch?.batch_number
    let displayName = item.name || '—'
    if (lot) displayName = `${displayName} — Lot ${lot}`
    if (displayName.length > 48) displayName = displayName.slice(0, 45) + '...'
    doc.setTextColor(...GREEN)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(displayName, m + 3, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(26, 26, 26)
    doc.text(String(item.quantity), m + 95, y + 4)
    doc.text(item.unit || '—', m + 112, y + 4)
    doc.text(fmt(item.unit_price) + ' FCFA', m + 130, y + 4)
    doc.setFont('helvetica', 'bold')
    doc.text(fmt(item.subtotal ?? item.quantity * item.unit_price) + ' FCFA', m + cw - 3, y + 4, { align: 'right' })
    y += 9
  })
  y += 6

  // ── Totaux ──
  const subtotal = Number(q.total_amount || 0) - Number(q.tax_amount || 0) + Number(q.discount || 0)
  const tx = m + cw - 85
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(102, 102, 102)
  doc.text('Sous-total HT', tx, y + 4)
  doc.setTextColor(0, 0, 0)
  doc.text(fmt(subtotal) + ' FCFA', m + cw - 3, y + 4, { align: 'right' })
  y += 7
  if (Number(q.discount || 0) > 0) {
    doc.setTextColor(102, 102, 102)
    doc.text('Remise', tx, y + 4)
    doc.setTextColor(220, 38, 38)
    doc.text('- ' + fmt(q.discount) + ' FCFA', m + cw - 3, y + 4, { align: 'right' })
    y += 7
  }
  doc.setTextColor(102, 102, 102)
  doc.text('TVA (' + (q.tax_rate || 18) + '%)', tx, y + 4)
  doc.setTextColor(0, 0, 0)
  doc.text(fmt(q.tax_amount) + ' FCFA', m + cw - 3, y + 4, { align: 'right' })
  y += 10

  doc.setFillColor(...GREEN)
  doc.roundedRect(tx - 3, y, 88, 15, 3, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('TOTAL TTC', tx + 2, y + 6)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(fmt(q.total_amount) + ' FCFA', m + cw - 6, y + 12, { align: 'right' })
  y += 22

  // ── Notes ──
  if (notes) {
    if (y > 252) { doc.addPage(); y = 20 }
    doc.setFillColor(248, 245, 238)
    doc.roundedRect(m, y, cw, 14, 2, 2, 'F')
    doc.setFontSize(6)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(136, 136, 136)
    doc.text('NOTES', m + 4, y + 5)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(85, 85, 85)
    doc.text(String(notes).slice(0, 110), m + 4, y + 11)
    y += 18
  }

  // ── Signatures ──
  if (y > 240) { doc.addPage(); y = 20 }
  y += 4
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.5)
  const sigW = (cw - 20) / 2
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(136, 136, 136)
  doc.text('ÉMETTEUR \u2014 HUB Distribution', m, y)
  doc.text('CLIENT \u2014 ' + (client.name || 'Client'), m + sigW + 20, y)
  y += 4
  doc.setLineDashPattern([2, 2], 0)
  doc.roundedRect(m, y, sigW, 20, 2, 2, 'S')
  doc.roundedRect(m + sigW + 20, y, sigW, 20, 2, 2, 'S')
  doc.setFontSize(7)
  doc.setTextColor(200, 200, 200)
  doc.text('Signature & Cachet', m + sigW / 2, y + 12, { align: 'center' })
  doc.text('Bon pour accord', m + sigW + 20 + sigW / 2, y + 12, { align: 'center' })
  doc.setLineDashPattern([], 0)

  // ── Footer ──
  const fy = 283
  doc.setFillColor(...DARK)
  doc.rect(0, fy, pw, 14, 'F')
  doc.setTextColor(255, 255, 255, 128)
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'normal')
  doc.text('HUB Distribution \u2014 RCCM: BZV-XXXX-XX \u2014 NIF: XXXXXXXXXX \u2014 Brazzaville, Congo', m, fy + 6)
  doc.text('Généré le ' + new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }), pw - m, fy + 6, { align: 'right' })

  return doc
}

export default function QuoteDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [doc, setDoc] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectMotif, setRejectMotif] = useState('')
  const [archiving, setArchiving] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [{ data: d, error: dErr }, { data: it }] = await Promise.all([
      supabase.from('documents').select('*, client:clients(*), creator:profiles!documents_created_by_fkey(full_name)').eq('id', id).single(),
      supabase.from('document_items').select('*, batch:product_batches(batch_number, expiry_date)').eq('document_id', id).order('sort_order'),
    ])
    if (dErr || !d) { setLoadError('Devis introuvable.'); setLoading(false); return }
    setDoc(d)
    setItems(it || [])
    setLoading(false)
  }, [id, supabase])

  // Permissions (managers peuvent valider / refuser)
  useEffect(() => {
    async function loadProfile() {
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id || null
      setCurrentUser(uid)
      if (uid) {
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', uid).single()
        setCanManage(['admin', 'ceo', 'manager'].includes(profile?.role))
      }
    }
    loadProfile()
  }, [supabase])

  useEffect(() => { load() }, [load])

  const pastDue = !!doc?.due_date && doc.due_date < todayISO()
  const isExpired = pastDue && ['draft', 'pending'].includes(doc?.status)
  const approvedOverdue = pastDue && doc?.status === 'approved' && !doc?.invoice_id
  const isCreator = !!currentUser && doc?.created_by === currentUser
  const quoteDate = doc ? (doc.content?.document_date || new Date(doc.created_at).toISOString().slice(0, 10)) : null

  async function pushNotification(type: string, title: string, message: string, recipientId?: string | null) {
    if (!recipientId) return
    try {
      await supabase.from('notifications').insert({
        type, title, message,
        reference_id: id, reference_type: 'quote',
        link: `/quotes/${id}`, recipient_id: recipientId,
      })
    } catch { /* best-effort */ }
  }

  async function doTransition(status: string) {
    if (busy || !doc) return

    // ── Garde-fous workflow ──
    if (status === 'pending' && doc.status !== 'draft' && doc.status !== 'rejected') {
      toast('warning', 'Seul un brouillon peut être soumis.'); return
    }
    if (status === 'pending' && isExpired && doc.status === 'draft') {
      toast('warning', 'Ce devis est expiré : modifiez-le pour prolonger sa validité avant de soumettre.'); return
    }
    if ((status === 'approved' || status === 'rejected') && !canManage) {
      toast('error', 'Seul un gestionnaire (admin, CEO, manager) peut valider ou refuser un devis.'); return
    }
    if (status === 'approved' && doc.status !== 'pending') { toast('warning', 'Seul un devis en attente peut être accepté.'); return }
    if (status === 'rejected' && doc.status !== 'pending') { toast('warning', 'Seul un devis en attente peut être refusé.'); return }
    if (status === 'approved' && isExpired) { toast('warning', 'Ce devis a dépassé sa date de validité : il ne peut plus être accepté tel quel. Revenez en brouillon pour prolonger la validité, ou refusez-le.'); return }
    if (status === 'draft' && !['pending', 'rejected'].includes(doc.status)) { toast('warning', 'Transition impossible.'); return }
    if (status === 'draft' && doc.status === 'pending' && !canManage) { toast('error', 'Seul un gestionnaire peut reprendre un devis en attente.'); return }

    setBusy(status)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const nowIso = new Date().toISOString()
      const patch: Record<string, unknown> = { status, updated_at: nowIso }

      if (status === 'approved') {
        patch.approved_by = userData.user?.id
        patch.approved_at = nowIso
        patch.validated_by = userData.user?.id
        patch.validated_at = nowIso
        patch.rejection_reason = null
      }
      if (status === 'rejected') {
        const motif = rejectMotif.trim()
        if (!motif) { setBusy(null); toast('warning', 'Le motif de refus est obligatoire.'); return }
        patch.rejection_reason = motif
        patch.validated_by = userData.user?.id
        patch.validated_at = nowIso
      }
      if (status === 'draft' && doc.status === 'pending') {
        // Retour brouillon (gestionnaire) : on garde le motif s'il existe
        patch.updated_at = nowIso
      }
      if (status === 'draft' && doc.status === 'rejected') {
        // Reprise par le créateur — le motif reste visible jusqu'à la prochaine soumission
        patch.updated_at = nowIso
      }

      const { error } = await supabase.from('documents').update(patch).eq('id', id)
      if (error) throw new Error(error.message)

      if (status === 'pending') {
        try {
          await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'quote_pending',
              title: `Devis ${doc.document_number} en attente`,
              message: `Devis ${doc.title || doc.document_number} — ${fmt(doc.total_amount)} FCFA`,
              referenceId: id, referenceType: 'quote', link: `/quotes/${id}`,
            }),
          })
        } catch { /* best-effort */ }
      } else if (status === 'approved') {
        await pushNotification('quote_approved', `Devis ${doc.document_number} accepté`, `Votre devis pour ${doc.client?.name || 'le client'} a été accepté. Vous pouvez le convertir en facture.`, doc.created_by)
        await archivePDF(false) // archivage silencieux dès l'acceptation
      } else if (status === 'rejected') {
        await pushNotification('quote_rejected', `Devis ${doc.document_number} refusé`, `Votre devis a été refusé : ${rejectMotif.trim()}`, doc.created_by)
      }

      toast('success',
        status === 'approved' ? 'Devis accepté.' :
        status === 'rejected' ? 'Devis refusé (motif enregistré).' :
        status === 'pending' ? 'Devis soumis pour validation.' :
        'Devis revenu en brouillon.')
      setRejectMotif('')
      setShowRejectModal(false)
      await load()
    } catch (err: unknown) {
      toast('error', 'Erreur : ' + (err instanceof Error ? err.message : String(err)))
    } finally { setBusy(null) }
  }

  async function convertToInvoice() {
    if (busy || !doc) return
    if (doc.status === 'converted') {
      toast('info', 'Ce devis a déjà été converti en facture.')
      if (doc.invoice_id) router.push(`/invoices/${doc.invoice_id}`)
      return
    }
    if (doc.status !== 'approved') { toast('warning', 'Seul un devis accepté peut être converti en facture.'); return }
    if (!confirm('Convertir ce devis en facture ? Le devis sera marqué « converti » et la facture créée en attente de validation (anti-doublon garanti).')) return

    setBusy('convert')
    try {
      const { data: invId, error: rpcErr } = await supabase.rpc('convert_quote_to_invoice', { p_quote_id: id })
      if (rpcErr) {
        if (/déjà converti/i.test(rpcErr.message)) {
          toast('info', 'Ce devis a déjà été converti en facture.')
          await load()
        } else {
          toast('error', 'Conversion impossible : ' + rpcErr.message)
        }
        return
      }
      if (!invId) throw new Error('Aucune facture créée.')

      const invNum = ''
      const { data: inv } = await supabase.from('invoices').select('invoice_number').eq('id', invId).single()
      const invoiceNumber = (inv as any)?.invoice_number || invNum

      // Notifications : validateur (+ créateur du devis)
      await pushNotification('quote_converted', `Devis ${doc.document_number} converti en facture`, invoiceNumber ? `La facture ${invoiceNumber} a été créée depuis votre devis accepté.` : 'Votre devis accepté a été converti en facture.', doc.created_by)
      try {
        await fetch('/api/notifications/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'invoice_pending',
            title: `Facture ${invoiceNumber} en attente`,
            message: `Facture créée depuis le devis ${doc.document_number} — ${fmt(doc.total_amount)} FCFA`,
            referenceId: invId, referenceType: 'invoice', link: `/invoices/${invId}`,
          }),
        })
      } catch { /* best-effort */ }

      // Recharger l'état « converti » puis archiver le PDF définitif
      await load()
      try { await archivePDF(false) } catch { /* best-effort */ }

      toast('success', 'Devis converti en facture.')
      router.push(`/invoices/${invId}`)
    } catch (err: unknown) {
      toast('error', 'Conversion impossible : ' + (err instanceof Error ? err.message : String(err)))
      load()
    } finally { setBusy(null) }
  }

  // ── PDF ──
  function pdfBlob() {
    if (!doc) return null
    return generateQuotePDF(doc, items)
  }

  function downloadPDF() {
    const pdf = pdfBlob()
    if (!pdf) return
    pdf.save(`${(doc.document_number || 'devis').replace(/\//g, '-')}.pdf`)
  }

  function printPDF() {
    const pdf = pdfBlob()
    if (!pdf) return
    const url = pdf.output('bloburl')
    window.open(url.toString(), '_blank')
  }

  async function archivePDF(notify = true) {
    if (!doc || archiving) return
    setArchiving(true)
    try {
      const pdf = generateQuotePDF(doc, items)
      const blob = pdf.output('blob')
      const filePath = `${(doc.document_number || 'devis').replace(/\//g, '-')}.pdf`
      const { success, error } = await savePDFAndUpdateRecord('devis-pdf', filePath, blob, 'documents', id)
      if (success) {
        if (notify) { toast('success', 'PDF archivé avec succès.') ; load() }
      } else if (notify) {
        toast('warning', 'PDF non archivé : ' + (error || 'erreur inconnue'))
      }
    } finally { setArchiving(false) }
  }

  async function openStoredPDF() {
    if (!doc?.file_url) return
    const parts = doc.file_url.split('/')
    const bucket = parts[0]
    const path = parts.slice(1).join('/')
    const url = await getSignedPDFUrl(bucket, path)
    if (url) window.open(url, '_blank')
    else toast('error', 'Impossible de récupérer le PDF archivé')
  }

  async function removeQuote() {
    if (!doc || busy) return
    if (doc.status !== 'draft') { toast('warning', 'Seul un brouillon peut être supprimé.'); return }
    if (!confirm(`Supprimer définitivement le devis ${doc.document_number} ? Cette action est irréversible.`)) return
    setBusy('delete')
    const { error } = await supabase.from('documents').delete().eq('id', id).eq('status', 'draft')
    setBusy(null)
    if (error) toast('error', 'Suppression impossible : ' + error.message)
    else { toast('success', 'Devis supprimé.'); router.push('/quotes') }
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#999' }}>Chargement...</div>
  if (loadError || !doc) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
      {loadError || 'Devis introuvable'}
      <div style={{ marginTop: 16 }}><Link href="/quotes" className="btn-primary" style={{ textDecoration: 'none' }}>← Retour aux devis</Link></div>
    </div>
  )

  const cfg = statusConfig[doc.status] || statusConfig.draft
  const canSubmitDraft = doc.status === 'draft' && !isExpired

  return (
    <div className="invoice-page invoice-page--detail">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>📝 {doc.document_number || 'Devis'}</h2>
          <span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span>
          {isExpired && <span className="badge badge-red">⚠️ Expiré</span>}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn-ghost" onClick={downloadPDF} disabled={!!busy}>📥 Télécharger PDF</button>
          <button type="button" className="btn-ghost" onClick={printPDF} disabled={!!busy}>🖨️ Imprimer</button>
          {doc.file_url ? (
            <button type="button" className="btn-ghost" onClick={openStoredPDF}>📄 Voir PDF archivé</button>
          ) : (['approved', 'converted'].includes(doc.status)) ? (
            <button type="button" className="btn-ghost" onClick={() => archivePDF(true)} disabled={archiving}>{archiving ? '⏳...' : '🗄️ Archiver le PDF'}</button>
          ) : null}
          {doc.status === 'draft' && (
            <Link href={`/quotes/new?edit=${id}`} className="btn-amber" style={{ textDecoration: 'none' }}>✏️ Modifier</Link>
          )}
          {doc.status === 'approved' && !doc.invoice_id && (
            <button type="button" className="btn-primary" onClick={convertToInvoice} disabled={busy !== null}>
              {busy === 'convert' ? '⏳ Conversion...' : '🔄 Convertir en Facture'}
            </button>
          )}
          {doc.invoice_id && (
            <Link href={`/invoices/${doc.invoice_id}`} className="btn-primary" style={{ textDecoration: 'none' }}>🧾 Voir la facture liée</Link>
          )}
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
        {/* Bandeau motif de refus */}
        {doc.status === 'rejected' && doc.rejection_reason && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 18px', marginBottom: 20 }}>
            <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>❌ Devis refusé — motif</div>
            <div style={{ color: '#7f1d1d', fontSize: '0.9rem' }}>{doc.rejection_reason}</div>
          </div>
        )}
        {doc.status === 'draft' && doc.rejection_reason && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 18px', marginBottom: 20, fontSize: '0.85rem', color: '#92400e' }}>
            ℹ️ <strong>Motif du refus précédent :</strong> {doc.rejection_reason} — corrigez puis re-soumettez.
          </div>
        )}
        {approvedOverdue && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 18px', marginBottom: 20, fontSize: '0.85rem', color: '#92400e' }}>
            ⏳ La validité de ce devis est dépassée depuis le {frDate(doc.due_date)}, mais l'accord a été donné à temps : la conversion reste possible.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
          {/* Colonne principale */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header card */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div style={{ background: 'var(--hub-green)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'white' }}>
                  <div>
                    <div style={{ fontFamily: 'Georgia, serif', fontWeight: 800, fontSize: '1.1rem' }}>HUB Distribution</div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.65, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Devis commercial</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', color: 'white' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '1.2rem', fontWeight: 700 }}>{doc.document_number}</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{frDate(quoteDate)}</div>
                </div>
              </div>
              <div style={{ padding: '20px 24px' }}>
                {doc.title && <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--hub-green)', marginBottom: 12 }}>{doc.title}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
                  {[['Date', frDate(quoteDate)], ['Validité', doc.due_date ? frDate(doc.due_date) : '—'], ['Conditions', doc.payment_terms || '30 jours']].map(([l, v]) => (
                    <div key={l} style={{ background: '#f8f5ee', padding: '12px 14px', borderRadius: 8 }}>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', fontWeight: 700, marginBottom: 3 }}>{l}</div>
                      <div style={{ fontWeight: 600, color: isExpired && l === 'Validité' ? '#dc2626' : 'var(--hub-green)' }}>{v}</div>
                    </div>
                  ))}
                </div>
                {doc.client && (
                  <div style={{ padding: '14px 18px', borderLeft: '4px solid var(--hub-green-mid)', background: '#f8f5ee', borderRadius: '0 8px 8px 0' }}>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', fontWeight: 700, marginBottom: 4 }}>Client</div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--hub-green)' }}>{doc.client.name}</div>
                    {doc.client.email && <div style={{ fontSize: '0.8rem', color: '#666' }}>📧 {doc.client.email}</div>}
                    {doc.client.phone && <div style={{ fontSize: '0.8rem', color: '#666' }}>📱 {doc.client.phone}</div>}
                  </div>
                )}
              </div>
            </div>

            {/* Articles */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.875rem' }}>📦 Articles</div>
              {items.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>Aucune ligne</div>
              ) : (
                <table className="hub-table">
                  <thead><tr><th>Désignation</th><th>Qté</th><th>Unité</th><th>Prix unit.</th><th>Total HT</th></tr></thead>
                  <tbody>
                    {items.map((it: any) => (
                      <tr key={it.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{it.name}</div>
                          {it.description && <div style={{ fontSize: '0.75rem', color: '#999' }}>{it.description}</div>}
                          {it.batch?.batch_number && <div style={{ fontSize: '0.75rem', color: '#065f46' }}>Lot {it.batch.batch_number}{it.batch.expiry_date ? ` · exp. ${new Date(it.batch.expiry_date + 'T00:00:00').toLocaleDateString('fr-FR')}` : ''}</div>}
                        </td>
                        <td style={{ fontWeight: 700 }}>{it.quantity}</td>
                        <td style={{ color: '#666' }}>{it.unit || '—'}</td>
                        <td>{fmt(it.unit_price)} FCFA</td>
                        <td style={{ fontWeight: 700 }}>{fmt(it.subtotal ?? it.quantity * it.unit_price)} FCFA</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ padding: '16px 20px', background: '#f8f5ee', display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ width: 300 }}>
                  {[['Sous-total HT', `${fmt(Number(doc.total_amount || 0) - Number(doc.tax_amount || 0) + Number(doc.discount || 0))} FCFA`],
                    ...(Number(doc.discount) > 0 ? [['Remise', `- ${fmt(doc.discount)} FCFA`]] : []),
                    [`TVA (${doc.tax_rate || 18}%)`, `${fmt(doc.tax_amount)} FCFA`],
                  ].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.875rem', borderBottom: '1px solid #e8e4db' }}>
                      <span style={{ color: '#666' }}>{l}</span><span>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, padding: '12px 16px', background: 'var(--hub-green)', color: 'white', borderRadius: 8 }}>
                    <span style={{ fontWeight: 700 }}>Total TTC</span>
                    <span style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', fontWeight: 800 }}>{fmt(doc.total_amount)} FCFA</span>
                  </div>
                </div>
              </div>
            </div>

            {doc.content?.notes && (
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '16px 20px' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', marginBottom: 6 }}>Notes</div>
                <div style={{ color: '#555', fontSize: '0.875rem' }}>{String(doc.content.notes)}</div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 80 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Actions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {canSubmitDraft && (
                  <button type="button" className="btn-amber" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => doTransition('pending')} disabled={busy !== null}>
                    {busy === 'pending' ? '⏳...' : '📤 Soumettre pour validation'}
                  </button>
                )}
                {doc.status === 'draft' && isExpired && (
                  <div style={{ padding: '10px 14px', background: '#fef3c7', borderRadius: 8, fontSize: '0.78rem', color: '#92400e', textAlign: 'center' }}>
                    ⚠️ Devis expiré — modifiez-le pour prolonger la validité.
                  </div>
                )}
                {doc.status === 'pending' && canManage && !isExpired && (
                  <>
                    <button type="button" className="btn-primary" style={{ justifyContent: 'center', padding: '11px', background: '#065f46' }} onClick={() => doTransition('approved')} disabled={busy !== null}>
                      {busy === 'approved' ? '⏳...' : '✅ Accepter'}
                    </button>
                    <button type="button" className="btn-danger" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => { setRejectMotif(''); setShowRejectModal(true) }} disabled={busy !== null}>
                      ❌ Refuser (avec motif)
                    </button>
                  </>
                )}
                {doc.status === 'pending' && canManage && isExpired && (
                  <>
                    <div style={{ padding: '10px 14px', background: '#fef3c7', borderRadius: 8, fontSize: '0.78rem', color: '#92400e', textAlign: 'center' }}>
                      ⚠️ Validité dépassée : acceptation bloquée. Retournez le devis en brouillon pour prolonger la date.
                    </div>
                    <button type="button" className="btn-ghost" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => doTransition('draft')} disabled={busy !== null}>
                      ↩️ Retour en brouillon
                    </button>
                    <button type="button" className="btn-danger" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => { setRejectMotif(''); setShowRejectModal(true) }} disabled={busy !== null}>
                      ❌ Refuser (avec motif)
                    </button>
                  </>
                )}
                {doc.status === 'pending' && !canManage && (
                  <div style={{ padding: '10px 14px', background: '#fef3c7', borderRadius: 8, fontSize: '0.78rem', color: '#92400e', textAlign: 'center' }}>
                    ⏳ En attente de validation par un gestionnaire
                  </div>
                )}
                {doc.status === 'approved' && !doc.invoice_id && (
                  <>
                    <button type="button" className="btn-primary" style={{ justifyContent: 'center', padding: '11px' }} onClick={convertToInvoice} disabled={busy !== null}>
                      {busy === 'convert' ? '⏳ Conversion...' : '🔄 Convertir en Facture'}
                    </button>
                    {approvedOverdue && (
                      <div style={{ padding: '10px 14px', background: '#fffbeb', borderRadius: 8, fontSize: '0.75rem', color: '#92400e', textAlign: 'center' }}>
                        Validité dépassée — l'accord ayant été donné à temps, la conversion reste possible.
                      </div>
                    )}
                  </>
                )}
                {doc.invoice_id && (
                  <Link href={`/invoices/${doc.invoice_id}`} className="btn-ghost" style={{ textDecoration: 'none', textAlign: 'center', padding: '11px' }}>🧾 Voir la facture liée</Link>
                )}
                {doc.status === 'rejected' && (isCreator || canManage) && (
                  <button type="button" className="btn-ghost" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => doTransition('draft')} disabled={busy !== null}>
                    {busy === 'draft' ? '⏳...' : '↩️ Reprendre en brouillon'}
                  </button>
                )}
                {doc.status === 'draft' && (
                  <>
                    <button type="button" className="btn-ghost" style={{ justifyContent: 'center', padding: '11px' }} onClick={downloadPDF} disabled={busy !== null}>📥 Télécharger PDF</button>
                    <Link href={`/quotes/new?edit=${id}`} className="btn-amber" style={{ textDecoration: 'none', textAlign: 'center', padding: '11px' }}>✏️ Modifier le brouillon</Link>
                    <button type="button" className="btn-danger" style={{ justifyContent: 'center', padding: '10px' }} onClick={removeQuote} disabled={busy !== null}>
                      {busy === 'delete' ? '⏳...' : '🗑️ Supprimer le brouillon'}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '16px 20px', fontSize: '0.7rem', color: '#999', lineHeight: 1.8 }}>
              <div>Créé par: {doc.creator?.full_name || '—'}</div>
              <div>Créé le: {new Date(doc.created_at).toLocaleString('fr-FR')}</div>
              {doc.validated_at && <div>{doc.status === 'rejected' ? 'Refusé le' : doc.status === 'approved' ? 'Accepté le' : 'Validé le'}: {new Date(doc.validated_at).toLocaleString('fr-FR')}</div>}
              {doc.converted_at && <div>Converti le: {new Date(doc.converted_at).toLocaleString('fr-FR')}</div>}
              {doc.approved_at && !doc.validated_at && <div>Accepté le: {new Date(doc.approved_at).toLocaleString('fr-FR')}</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Modal refus avec motif obligatoire */}
      {showRejectModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowRejectModal(false)}>
          <div className="modal-box" style={{ maxWidth: 460 }}>
            <div className="modal-title" style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 14 }}>❌ Refuser le devis {doc.document_number}</div>
            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: 12 }}>
              Le motif sera enregistré, affiché sur le devis et notifié au créateur.
            </div>
            <div className="hub-form-group">
              <label className="invoice-field__label">Motif du refus *</label>
              <textarea className="hub-input" rows={3} value={rejectMotif} autoFocus
                onChange={e => setRejectMotif(e.target.value)}
                placeholder="Ex: prix trop élevé, délai trop long, produit indisponible..."
                style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn-ghost" onClick={() => setShowRejectModal(false)}>Annuler</button>
              <button type="button" className="btn-danger" disabled={!rejectMotif.trim() || busy !== null}
                onClick={() => doTransition('rejected')}>
                {busy === 'rejected' ? '⏳...' : '❌ Confirmer le refus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
