'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/components/ui/Toast'
import { deliveryNoteAffectsStock } from '@/lib/stock/stockExit'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft:    { label: 'Brouillon', badge: 'badge-gray',  icon: '✏️' },
  pending:  { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Livré', badge: 'badge-green', icon: '✅' },
  rejected: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

type Content = Record<string, unknown> & { notes?: string; reception?: { received_by: string; received_at: string; signed_by?: string | null }; rejection?: { reason: string; rejected_at: string; rejected_by?: string | null }; annulation?: { reason: string; annulated_at: string; annulated_by?: string | null } }

const nowLocal = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export default function DeliveryNoteDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const [doc, setDoc] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [people, setPeople] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const busyRef = useRef(false)
  const supabase = createClient()
  const { toast } = useToast()

  // Modales
  const [showDelivery, setShowDelivery] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [reception, setReception] = useState({ received_by: '', received_at: nowLocal(), signed_by: '' })
  const [motif, setMotif] = useState('')

  async function load() {
    setLoading(true); setError(null)
    try {
      const [{ data: d, error: dErr }, { data: it }] = await Promise.all([
        supabase.from('documents').select('*, client:clients(*), invoice:invoices(id,invoice_number)').eq('id', id).single(),
        supabase.from('document_items').select('*, product:products(name,unit), batch:product_batches(batch_number,expiry_date)').eq('document_id', id).order('sort_order'),
      ])
      if (dErr || !d) throw new Error(dErr?.message || 'Bon de livraison introuvable')
      setDoc(d); setItems(it || [])
      // Noms des utilisateurs (créateur / valideur) — optionnel, ne bloque jamais le rendu.
      const ids = [d.created_by, d.validated_by].filter(Boolean)
      if (ids.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids)
        const map: Record<string, string> = {}
        for (const p of (profiles || [])) map[p.id] = p.full_name || ''
        setPeople(map)
      }
    } catch (e) {
      setDoc(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [id])

  const guard = async (fn: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setUpdating(true)
    try { await fn() } finally { busyRef.current = false; setUpdating(false) }
  }

  const contentOf = (): Content => ((doc?.content as Content) || {})
  const mergeContent = (patch: Record<string, unknown>): Content => ({ ...contentOf(), ...patch })

  async function submitForValidation() {
    await guard(async () => {
      const content = mergeContent({ rejection: null })
      const { error } = await supabase.from('documents')
        .update({ status: 'pending', rejection_reason: null, content, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) { toast('error', 'Erreur: ' + error.message); return }
      try {
        await fetch('/api/notifications/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'bl_pending',
            title: `BL ${doc.document_number} en attente`,
            message: `Bon de livraison ${doc.title || doc.document_number} pour ${doc.client?.name || 'client non defini'}`,
            referenceId: id, referenceType: 'delivery_note', link: `/delivery-notes/${id}`,
          }),
        })
      } catch { /* best-effort */ }
      toast('success', 'BL soumis pour validation')
      setShowReject(false); setMotif('')
      load()
    })
  }

  /** Livraison confirmée : enregistre la réception signée puis passe en « Livré » (une seule transition possible, le trigger SQL est la source de vérité). */
  async function confirmDelivery() {
    const rb = reception.received_by.trim()
    if (!rb) { toast('warning', 'Indiquez qui réceptionne la marchandise.'); return }
    await guard(async () => {
      const { data: userData } = await supabase.auth.getUser()
      const content = mergeContent({
        rejection: null,
        reception: {
          received_by: rb,
          received_at: new Date(reception.received_at).toISOString(),
          signed_by: reception.signed_by.trim() || null,
        },
      })
      const { error } = await supabase.from('documents')
        .update({ status: 'approved', content, validated_by: userData.user?.id, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) {
        const msg = /stock insuffisant/i.test(error.message)
          ? 'Stock insuffisant : la livraison n’a pas pu être confirmée.'
          : 'Erreur: ' + error.message
        toast('error', msg); return
      }
      toast('success', 'Livraison confirmée')
      setShowDelivery(false)
      load()
    })
  }

  /** Rejet par le gestionnaire : motif obligatoire, retour en brouillon (aucun mouvement de stock, rien n’est livré). */
  async function rejectBL() {
    const reason = motif.trim()
    if (!reason) { toast('warning', 'Le motif du rejet est obligatoire.'); return }
    await guard(async () => {
      const { data: userData } = await supabase.auth.getUser()
      const content = mergeContent({
        rejection: { reason, rejected_at: new Date().toISOString(), rejected_by: userData.user?.id },
      })
      const { error } = await supabase.from('documents')
        .update({ status: 'draft', rejection_reason: reason, content, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) { toast('error', 'Erreur: ' + error.message); return }
      toast('success', 'BL rejeté — retour en brouillon avec motif enregistré')
      setShowReject(false); setMotif('')
      load()
    })
  }

  /** Annulation (terminale) : motif obligatoire. BL autonome déjà livré → le stock est restauré par le trigger. */
  async function cancelBL() {
    const reason = motif.trim()
    if (!reason) { toast('warning', 'Le motif de l’annulation est obligatoire.'); return }
    await guard(async () => {
      const { data: userData } = await supabase.auth.getUser()
      const content = mergeContent({
        annulation: { reason, annulated_at: new Date().toISOString(), annulated_by: userData.user?.id },
      })
      const { error } = await supabase.from('documents')
        .update({ status: 'rejected', rejection_reason: reason, content, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) { toast('error', 'Erreur: ' + error.message); return }
      toast('success', doc.status === 'approved'
        ? (deliveryNoteAffectsStock(doc.invoice_id) ? 'BL annulé — stock restauré' : 'BL annulé (aucun impact stock)')
        : 'BL annulé')
      setShowCancel(false); setMotif('')
      load()
    })
  }

  async function deleteDraft() {
    if (!window.confirm('Supprimer définitivement ce brouillon et ses lignes ? Cette action est irréversible.')) return
    await guard(async () => {
      const { error } = await supabase.from('documents').delete().eq('id', id)
      if (error) { toast('error', 'Erreur: ' + error.message); return }
      toast('success', 'Brouillon supprimé')
      router.push('/delivery-notes')
    })
  }

  function generatePDF() {
    if (!doc) return
    const wasDelivered = !!doc.validated_at
    const content = contentOf()
    const reception_ = content.reception
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>BL ${doc.document_number}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:white}@page{margin:15mm 18mm;size:A4}
.header{display:flex;justify-content:space-between;align-items:flex-start;padding:24px 32px 20px;background:#1a3d2b;color:white}
.company-name{font-size:1.4rem;font-weight:800;font-family:Georgia,serif}.company-sub{font-size:0.7rem;opacity:0.65;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px}
.badge-type{background:#d4a017;color:white;padding:5px 14px;border-radius:4px;font-weight:700;font-size:0.85rem}
.status-pill{display:inline-block;margin-top:6px;padding:3px 10px;border-radius:20px;font-size:0.7rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase}
.body{padding:28px 32px}
.meta-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px}
.meta-box{background:#f8f5ee;padding:14px 16px;border-radius:8px}.meta-label{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:4px}.meta-value{font-size:0.9rem;font-weight:600;color:#1a3d2b}
.client-section{margin-bottom:24px;padding:16px 20px;border-left:4px solid #2d6a4f;background:#f8f5ee;border-radius:0 8px 8px 0}
table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:0.875rem}thead tr{background:#1a3d2b;color:white}
th{padding:10px 14px;text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.07em;font-weight:700}
td{padding:10px 14px;border-bottom:1px solid #f0ece4}
.sig-section{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px;padding-top:20px;border-top:1px solid #ddd}
.sig-box{text-align:center}.sig-area{border:1.5px dashed #ccc;border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:0.8rem}
.sig-name{margin-top:6px;font-size:0.85rem;font-weight:700;color:#1a3d2b}
.footer{padding:12px 32px;background:#0f1f17;color:rgba(255,255,255,0.5);font-size:0.7rem;display:flex;justify-content:space-between}
.receive-box{padding:16px 20px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;margin-bottom:24px}
.cancel-box{padding:14px 18px;background:#fee2e2;border:1px solid #fecaca;border-radius:8px;margin-bottom:24px;color:#991b1b}
</style></head><body>
<div class="header"><div><div class="company-name">HUB Distribution</div><div class="company-sub">Transformation & Distribution Agricole</div></div>
<div style="text-align:right"><div class="badge-type">🚚 BON DE LIVRAISON</div><div style="font-family:monospace;font-size:1.1rem;font-weight:700;margin-top:6px">${esc(doc.document_number)}</div>
<span class="status-pill" style="background:${doc.status === 'approved' ? '#d1fae5;color:#065f46' : doc.status === 'rejected' ? '#fee2e2;color:#991b1b' : doc.status === 'pending' ? '#fef3c7;color:#92400e' : '#f3f4f6;color:#374151'}">${esc((statusConfig[doc.status] || statusConfig.draft).label)}</span></div></div>
<div class="body">
${doc.status === 'rejected' && (doc.rejection_reason || content.annulation?.reason) ? `<div class="cancel-box"><strong>${wasDelivered ? 'Annulé après livraison' : 'Annulé'}</strong> — ${esc(doc.rejection_reason || content.annulation?.reason)}${wasDelivered && deliveryNoteAffectsStock(doc.invoice_id) ? ' · Stock restauré.' : ''}</div>` : ''}
<div class="meta-grid">
<div class="meta-box"><div class="meta-label">Date</div><div class="meta-value">${new Date(doc.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
<div class="meta-box"><div class="meta-label">Facture liée</div><div class="meta-value">${esc(doc.invoice?.invoice_number || '—')}</div></div>
<div class="meta-box"><div class="meta-label">Livraison prévue le</div><div class="meta-value">${doc.due_date ? new Date(doc.due_date).toLocaleDateString('fr-FR') : '—'}</div></div>
</div>
${doc.client ? `<div class="client-section"><div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:4px">Destinataire</div><div style="font-size:1.05rem;font-weight:700;color:#1a3d2b">${esc(doc.client.name)}</div>${doc.client.address ? `<div style="font-size:0.8rem;color:#555;margin-top:2px">📍 ${esc(doc.client.address)}</div>` : ''}${doc.client.phone ? `<div style="font-size:0.8rem;color:#555">📱 ${esc(doc.client.phone)}</div>` : ''}</div>` : ''}
<table><thead><tr><th style="width:5%">#</th><th style="width:40%">Désignation</th><th style="width:15%">Qté</th><th style="width:15%">Unité</th><th style="width:25%">Observations</th></tr></thead>
<tbody>${items.map((it: any, i: number) => `<tr><td>${i + 1}</td><td><strong>${esc(it.name)}</strong>${it.description ? `<br><span style="font-size:0.75rem;color:#888">${esc(it.description)}</span>` : ''}${it.batch?.batch_number ? `<br><span style="font-size:0.75rem;color:#065f46">Lot ${esc(it.batch.batch_number)}</span>` : ''}</td><td style="font-weight:700">${it.quantity}</td><td>${esc(it.unit || '—')}</td><td></td></tr>`).join('')}</tbody></table>
${reception_ ? `<div class="receive-box"><div style="font-weight:700;color:#065f46;margin-bottom:4px">📋 Réception confirmée</div>
<div style="font-size:0.82rem;color:#555">Réceptionné par <strong>${esc(reception_.received_by)}</strong> le ${new Date(reception_.received_at).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${reception_.signed_by ? ` — signé par <strong>${esc(reception_.signed_by)}</strong>` : ''}.</div></div>`
: `<div class="receive-box"><div style="font-weight:700;color:#065f46;margin-bottom:4px">📋 Réception marchandises</div><div style="font-size:0.82rem;color:#555">Le client confirme avoir reçu les marchandises listées ci-dessus en bon état, sauf mention contraire dans les observations.</div></div>`}
${content.notes ? `<div style="padding:12px 16px;background:#f8f5ee;border-radius:8px;font-size:0.8rem;color:#555;margin-bottom:20px"><strong>Notes livraison :</strong> ${esc(content.notes)}</div>` : ''}
<div class="sig-section">
<div class="sig-box"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Livreur — HUB Distribution</div><div class="sig-area">Signature livreur</div></div>
<div class="sig-box"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Client — ${esc(doc.client?.name || 'Destinataire')}</div><div class="sig-area">Signature & cachet client</div>${reception_?.signed_by ? `<div class="sig-name">${esc(reception_.signed_by)}</div>` : ''}</div>
</div></div>
<div class="footer"><span>HUB Distribution — RCCM: BZV-XXXX-XX — NIF: XXXXXXXXXX — Brazzaville, Congo</span><span>Imprimé le ${new Date().toLocaleDateString('fr-FR')}</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 800) }
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#999' }}>Chargement...</div>
  if (error || !doc) return (
    <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>
      <div style={{ fontSize: '1.2rem', marginBottom: 12 }}>🚚</div>
      <div>{error || 'Bon de livraison introuvable'}</div>
      <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button type="button" className="btn-ghost" onClick={() => router.push('/delivery-notes')}>← Retour à la liste</button>
        {error && <button type="button" className="btn-primary" onClick={load}>↻ Réessayer</button>}
      </div>
    </div>
  )

  const cfg = statusConfig[doc.status] || statusConfig.draft
  const affectsStock = deliveryNoteAffectsStock(doc.invoice_id)
  const content = contentOf()
  const reception_ = content.reception
  const rejection_ = content.rejection
  const annulation_ = content.annulation
  const wasDelivered = !!doc.validated_at
  const draftRejected = doc.status === 'draft' && !!(doc.rejection_reason || rejection_?.reason)

  const openModal = (m: 'delivery' | 'reject' | 'cancel') => {
    setMotif('')
    if (m === 'delivery') setReception(r => ({ ...r, received_at: nowLocal() }))
    if (m === 'delivery') setShowDelivery(true)
    if (m === 'reject') setShowReject(true)
    if (m === 'cancel') setShowCancel(true)
  }

  return (
    <div className="invoice-page invoice-page--detail">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>🚚 {doc.document_number || 'BL'}</h2>
          <span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span>
          {doc.status === 'approved' && reception_?.signed_by && <span className="badge badge-blue">✍️ Réception signée</span>}
          {doc.status === 'approved' && reception_ && !reception_?.signed_by && <span className="badge badge-green">📦 Réceptionné</span>}
          {doc.status === 'rejected' && wasDelivered && <span className="badge badge-red">↩️ Après livraison</span>}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn-ghost" onClick={generatePDF}>🖨️ Imprimer BL</button>
          {doc.invoice && <Link href={`/invoices/${doc.invoice.id}`} className="btn-ghost" style={{ textDecoration: 'none' }}>🧾 {doc.invoice.invoice_number}</Link>}
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
        {draftRejected && (
          <div style={{ marginBottom: 20, padding: '14px 18px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#991b1b', fontSize: '0.875rem', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ fontSize: '1.2rem' }}>⚠️</div>
            <div>
              <strong>BL rejeté</strong> — {esc(doc.rejection_reason || rejection_?.reason || 'Motif non précisé')}
              {rejection_?.rejected_at && <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: 2 }}>Rejeté le {new Date(rejection_.rejected_at).toLocaleString('fr-FR')}</div>}
              <div style={{ fontSize: '0.8rem', marginTop: 4 }}>Corrigez le BL puis « 📤 Préparer livraison » pour le soumettre à nouveau.</div>
            </div>
          </div>
        )}
        {doc.status === 'rejected' && (doc.rejection_reason || annulation_?.reason || rejection_?.reason) && (
          <div style={{ marginBottom: 20, padding: '14px 18px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#991b1b', fontSize: '0.875rem' }}>
            <strong>❌ {wasDelivered ? 'Annulé après livraison' : 'Annulé'}</strong> — {esc(doc.rejection_reason || annulation_?.reason || rejection_?.reason || 'Motif non précisé')}
            {annulation_?.annulated_at && <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: 2 }}>Annulé le {new Date(annulation_.annulated_at).toLocaleString('fr-FR')}</div>}
            {wasDelivered && affectsStock && <div style={{ fontSize: '0.78rem', marginTop: 4 }}>Le stock sorti à la livraison a été restauré.</div>}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div style={{ background: 'var(--hub-green)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ color: 'white' }}>
                  <div style={{ fontFamily: 'Georgia, serif', fontWeight: 800, fontSize: '1.1rem' }}>HUB Distribution</div>
                  <div style={{ fontSize: '0.7rem', opacity: 0.65, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Bon de Livraison</div>
                </div>
                <div style={{ textAlign: 'right', color: 'white' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '1.2rem', fontWeight: 700 }}>{doc.document_number}</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{new Date(doc.created_at).toLocaleDateString('fr-FR')}</div>
                </div>
              </div>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
                  {[['Date', new Date(doc.created_at).toLocaleDateString('fr-FR')], ['Facture', doc.invoice?.invoice_number || '—'], ['Statut', cfg.label]].map(([l, v]) => (
                    <div key={l} style={{ background: '#f8f5ee', padding: '12px 14px', borderRadius: 8 }}>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', fontWeight: 700, marginBottom: 3 }}>{l}</div>
                      <div style={{ fontWeight: 600, color: 'var(--hub-green)' }}>{v}</div>
                    </div>
                  ))}
                </div>
                {doc.client && (
                  <div style={{ padding: '14px 18px', borderLeft: '4px solid var(--hub-green-mid)', background: '#f8f5ee', borderRadius: '0 8px 8px 0' }}>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', fontWeight: 700, marginBottom: 4 }}>Destinataire</div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--hub-green)' }}>{doc.client.name}</div>
                    {doc.client.address && <div style={{ fontSize: '0.8rem', color: '#666' }}>📍 {doc.client.address}</div>}
                    {doc.client.phone && <div style={{ fontSize: '0.8rem', color: '#666' }}>📱 {doc.client.phone}</div>}
                  </div>
                )}
              </div>
            </div>

            {/* Articles */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.875rem' }}>📦 Articles livrés</div>
              <table className="hub-table">
                <thead><tr><th>#</th><th>Désignation</th><th>Qté</th><th>Unité</th></tr></thead>
                <tbody>
                  {items.map((it: any, i: number) => (
                    <tr key={it.id}>
                      <td style={{ color: '#999' }}>{i + 1}</td>
                      <td><div style={{ fontWeight: 600 }}>{it.name}</div>{it.description && <div style={{ fontSize: '0.75rem', color: '#999' }}>{it.description}</div>}{it.batch?.batch_number && <div style={{ fontSize: '0.75rem', color: '#065f46' }}>Lot {it.batch.batch_number}</div>}</td>
                      <td style={{ fontWeight: 700 }}>{it.quantity}</td>
                      <td style={{ color: '#666' }}>{it.unit || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {content.notes && (
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '16px 20px' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', marginBottom: 6 }}>Notes livraison</div>
                <div style={{ color: '#555', fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>{content.notes}</div>
              </div>
            )}

            {/* Réception */}
            {reception_ && (
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '16px 20px' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', marginBottom: 8 }}>📋 Réception</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#999' }}>Réceptionné par</div>
                    <div style={{ fontWeight: 700 }}>{reception_.received_by || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#999' }}>Le</div>
                    <div style={{ fontWeight: 600 }}>{reception_.received_at ? new Date(reception_.received_at).toLocaleString('fr-FR') : '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#999' }}>Signataire client</div>
                    <div style={{ fontWeight: 600 }}>{reception_.signed_by ? `✍️ ${reception_.signed_by}` : '—'}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 80 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Actions</div>
              {!affectsStock && (
                <div style={{ padding: '10px 12px', background: '#f8f5ee', borderRadius: 8, fontSize: '0.78rem', color: '#555', marginBottom: 12, lineHeight: 1.5 }}>
                  Lié à une facture : le stock a déjà été déduit à la validation. Ce BL n’effectue pas de mouvement.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button type="button" className="btn-primary" style={{ justifyContent: 'center', padding: '11px' }} onClick={generatePDF}>🖨️ Imprimer BL</button>
                {doc.status === 'draft' && (
                  <button type="button" className="btn-amber" style={{ justifyContent: 'center', padding: '11px' }} onClick={submitForValidation} disabled={updating}>📤 Préparer livraison</button>
                )}
                {doc.status === 'pending' && (
                  <button type="button" className="btn-primary" style={{ justifyContent: 'center', padding: '11px', background: '#065f46' }} onClick={() => openModal('delivery')} disabled={updating}>✅ Confirmer livraison</button>
                )}
                {doc.status === 'pending' && (
                  <button type="button" className="btn-ghost" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => openModal('reject')} disabled={updating}>↩️ Rejeter (retour brouillon)</button>
                )}
                {['draft', 'pending', 'approved'].includes(doc.status) && (
                  <button type="button" className="btn-danger" style={{ padding: '10px', justifyContent: 'center' }}
                    onClick={() => openModal('cancel')} disabled={updating}>
                    {doc.status === 'approved' ? '❌ Annuler (restaurer)' : '❌ Annuler'}
                  </button>
                )}
                {doc.status === 'draft' && (
                  <button type="button" className="btn-ghost" style={{ padding: '10px', justifyContent: 'center', color: '#991b1b', borderColor: '#fecaca' }}
                    onClick={deleteDraft} disabled={updating}>🗑️ Supprimer le brouillon</button>
                )}
                {doc.status === 'approved' && (
                  <div style={{ padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, fontSize: '0.78rem', color: '#065f46', textAlign: 'center' }}>
                    {affectsStock
                      ? 'Livraison confirmée — stock décrémenté'
                      : 'Livraison confirmée — stock déjà déduit via la facture'}
                  </div>
                )}
                {doc.status === 'rejected' && (
                  <div style={{ padding: '10px 14px', background: '#fef2f2', borderRadius: 8, fontSize: '0.78rem', color: '#991b1b', textAlign: 'center' }}>
                    {wasDelivered ? 'Livraison annulée' : 'BL annulé'}
                  </div>
                )}
              </div>
            </div>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '16px 20px', fontSize: '0.7rem', color: '#999', lineHeight: 1.8 }}>
              <div>Créé par: {people[doc.created_by] || '—'}</div>
              <div>Créé le: {new Date(doc.created_at).toLocaleString('fr-FR')}</div>
              {doc.validated_at && <div>Livré le: {new Date(doc.validated_at).toLocaleString('fr-FR')}{people[doc.validated_by] ? ` par ${people[doc.validated_by]}` : ''}</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Modale : confirmation de livraison avec réception signée */}
      {showDelivery && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowDelivery(false)}>
          <div className="modal-box" style={{ maxWidth: 480 }}>
            <div className="modal-title">✅ Confirmer la livraison</div>
            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: 16, lineHeight: 1.5 }}>
              {affectsStock
                ? 'La validation décrémentera le stock une seule fois.'
                : 'BL lié à une facture : aucun mouvement de stock (déjà déduit à la validation de la facture).'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="hub-form-group">
                <label className="invoice-field__label">Réceptionné par *</label>
                <input className="hub-input" value={reception.received_by} onChange={e => setReception(r => ({ ...r, received_by: e.target.value }))} placeholder="Nom du réceptionnaire" />
              </div>
              <div className="hub-form-group">
                <label className="invoice-field__label">Date / heure de réception</label>
                <input className="hub-input" type="datetime-local" value={reception.received_at} onChange={e => setReception(r => ({ ...r, received_at: e.target.value }))} />
              </div>
              <div className="hub-form-group">
                <label className="invoice-field__label">Signature client (nom du signataire)</label>
                <input className="hub-input" value={reception.signed_by} onChange={e => setReception(r => ({ ...r, signed_by: e.target.value }))} placeholder="Nom du signataire / cachet — affiché sur le PDF" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" className="btn-ghost" onClick={() => setShowDelivery(false)} disabled={updating}>Annuler</button>
              <button type="button" className="btn-primary" onClick={confirmDelivery} disabled={updating}>{updating ? '⏳...' : '✅ Confirmer la livraison'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modale : rejet avec motif obligatoire */}
      {showReject && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowReject(false)}>
          <div className="modal-box" style={{ maxWidth: 480 }}>
            <div className="modal-title">↩️ Rejeter ce BL</div>
            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: 16, lineHeight: 1.5 }}>
              Le BL retournera en <strong>brouillon</strong> (aucun mouvement de stock — rien n’est livré). L’équipe pourra le corriger puis le soumettre à nouveau.
            </div>
            <div className="hub-form-group">
              <label className="invoice-field__label">Motif du rejet *</label>
              <textarea className="hub-input" rows={3} value={motif} onChange={e => setMotif(e.target.value)} placeholder="Ex: quantités erronées, lot manquant, adresse incomplète..." style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" className="btn-ghost" onClick={() => setShowReject(false)} disabled={updating}>Retour</button>
              <button type="button" className="btn-danger" onClick={rejectBL} disabled={updating}>{updating ? '⏳...' : '↩️ Rejeter avec motif'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modale : annulation avec motif obligatoire */}
      {showCancel && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCancel(false)}>
          <div className="modal-box" style={{ maxWidth: 480 }}>
            <div className="modal-title">❌ Annuler ce BL</div>
            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: 16, lineHeight: 1.5 }}>
              {doc.status === 'approved' && affectsStock && <>BL autonome déjà livré : l’annulation <strong>restaurera le stock</strong> (mouvement inverse automatique).</>}
              {doc.status === 'approved' && !affectsStock && <>BL lié à une facture : l’annulation n’a aucun impact sur le stock.</>}
              {doc.status !== 'approved' && <>Le BL passera au statut Annulé. Aucun mouvement de stock n’est concerné à ce stade.</>}
            </div>
            <div className="hub-form-group">
              <label className="invoice-field__label">Motif de l’annulation *</label>
              <textarea className="hub-input" rows={3} value={motif} onChange={e => setMotif(e.target.value)} placeholder="Ex: annulation client, erreur de saisie..." style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" className="btn-ghost" onClick={() => setShowCancel(false)} disabled={updating}>Retour</button>
              <button type="button" className="btn-danger" onClick={cancelBL} disabled={updating}>{updating ? '⏳...' : '❌ Confirmer l’annulation'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
