'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft:    { label: 'Brouillon', badge: 'badge-gray',  icon: '✏️' },
  pending:  { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Livré', badge: 'badge-green', icon: '✅' },
  rejected: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

export default function DeliveryNoteDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const [doc, setDoc] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const supabase = createClient()

  async function load() {
    setLoading(true)
    const [{ data: d }, { data: it }] = await Promise.all([
      supabase.from('documents').select('*, client:clients(*), invoice:invoices(id,invoice_number)').eq('id', id).single(),
      supabase.from('document_items').select('*, product:products(name,unit)').eq('document_id', id).order('sort_order'),
    ])
    setDoc(d); setItems(it || []); setLoading(false)
  }
  useEffect(() => { load() }, [id])

  async function updateStatus(status: string) {
    setUpdating(true)
    const { data: userData } = await supabase.auth.getUser()
    const extra: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (status === 'approved') { extra.validated_by = userData.user?.id; extra.validated_at = new Date().toISOString() }
    const { error } = await supabase.from('documents').update({ status, ...extra }).eq('id', id)
    if (error) alert('Erreur: ' + error.message)
    else load()
    setUpdating(false)
  }

  function generatePDF() {
    if (!doc) return
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>BL ${doc.document_number}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:white}@page{margin:15mm 18mm;size:A4}
.header{display:flex;justify-content:space-between;align-items:flex-start;padding:24px 32px 20px;background:#1a3d2b;color:white}
.company-name{font-size:1.4rem;font-weight:800;font-family:Georgia,serif}.company-sub{font-size:0.7rem;opacity:0.65;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px}
.badge-type{background:#d4a017;color:white;padding:5px 14px;border-radius:4px;font-weight:700;font-size:0.85rem}
.body{padding:28px 32px}
.meta-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px}
.meta-box{background:#f8f5ee;padding:14px 16px;border-radius:8px}.meta-label{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:4px}.meta-value{font-size:0.9rem;font-weight:600;color:#1a3d2b}
.client-section{margin-bottom:24px;padding:16px 20px;border-left:4px solid #2d6a4f;background:#f8f5ee;border-radius:0 8px 8px 0}
table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:0.875rem}thead tr{background:#1a3d2b;color:white}
th{padding:10px 14px;text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.07em;font-weight:700}
td{padding:10px 14px;border-bottom:1px solid #f0ece4}
.sig-section{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px;padding-top:20px;border-top:1px solid #ddd}
.sig-box{text-align:center}.sig-area{border:1.5px dashed #ccc;border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:0.8rem}
.footer{padding:12px 32px;background:#0f1f17;color:rgba(255,255,255,0.5);font-size:0.7rem;display:flex;justify-content:space-between}
.receive-box{padding:16px 20px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;margin-bottom:24px}
</style></head><body>
<div class="header"><div><div class="company-name">HUB Distribution</div><div class="company-sub">Transformation & Distribution Agricole</div></div>
<div style="text-align:right"><div class="badge-type">🚚 BON DE LIVRAISON</div><div style="font-family:monospace;font-size:1.1rem;font-weight:700;margin-top:6px">${doc.document_number || ''}</div></div></div>
<div class="body">
<div class="meta-grid">
<div class="meta-box"><div class="meta-label">Date</div><div class="meta-value">${new Date(doc.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
<div class="meta-box"><div class="meta-label">Facture liée</div><div class="meta-value">${doc.invoice?.invoice_number || '—'}</div></div>
<div class="meta-box"><div class="meta-label">Statut</div><div class="meta-value">${(statusConfig[doc.status] || statusConfig.draft).label}</div></div>
</div>
${doc.client ? `<div class="client-section"><div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:4px">Destinataire</div><div style="font-size:1.05rem;font-weight:700;color:#1a3d2b">${doc.client.name}</div>${doc.client.address ? `<div style="font-size:0.8rem;color:#555;margin-top:2px">📍 ${doc.client.address}</div>` : ''}${doc.client.phone ? `<div style="font-size:0.8rem;color:#555">📱 ${doc.client.phone}</div>` : ''}</div>` : ''}
<table><thead><tr><th style="width:5%">#</th><th style="width:40%">Désignation</th><th style="width:15%">Qté</th><th style="width:15%">Unité</th><th style="width:25%">Observations</th></tr></thead>
<tbody>${items.map((it: any, i: number) => `<tr><td>${i + 1}</td><td><strong>${it.name}</strong>${it.description ? `<br><span style="font-size:0.75rem;color:#888">${it.description}</span>` : ''}</td><td style="font-weight:700">${it.quantity}</td><td>${it.unit || '—'}</td><td></td></tr>`).join('')}</tbody></table>
<div class="receive-box"><div style="font-weight:700;color:#065f46;margin-bottom:4px">📋 Réception marchandises</div><div style="font-size:0.82rem;color:#555">Le client confirme avoir reçu les marchandises listées ci-dessus en bon état, sauf mention contraire dans les observations.</div></div>
<div class="sig-section">
<div class="sig-box"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Livreur — HUB Distribution</div><div class="sig-area">Signature livreur</div></div>
<div class="sig-box"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Client — ${doc.client?.name || 'Destinataire'}</div><div class="sig-area">Signature & cachet client</div></div>
</div></div>
<div class="footer"><span>HUB Distribution — RCCM: BZV-XXXX-XX — NIF: XXXXXXXXXX — Brazzaville, Congo</span><span>Imprimé le ${new Date().toLocaleDateString('fr-FR')}</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 800) }
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#999' }}>Chargement...</div>
  if (!doc) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Bon de livraison introuvable</div>

  const cfg = statusConfig[doc.status] || statusConfig.draft

  return (
    <div className="invoice-page invoice-page--detail">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>🚚 {doc.document_number || 'BL'}</h2>
          <span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn-ghost" onClick={generatePDF}>🖨️ Imprimer BL</button>
          {doc.invoice && <Link href={`/invoices/${doc.invoice.id}`} className="btn-ghost" style={{ textDecoration: 'none' }}>🧾 {doc.invoice.invoice_number}</Link>}
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
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
                      <td><div style={{ fontWeight: 600 }}>{it.name}</div>{it.description && <div style={{ fontSize: '0.75rem', color: '#999' }}>{it.description}</div>}</td>
                      <td style={{ fontWeight: 700 }}>{it.quantity}</td>
                      <td style={{ color: '#666' }}>{it.unit || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {doc.content?.notes && (
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '16px 20px' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', marginBottom: 6 }}>Notes livraison</div>
                <div style={{ color: '#555', fontSize: '0.875rem' }}>{String(doc.content.notes)}</div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 80 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Actions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button type="button" className="btn-primary" style={{ justifyContent: 'center', padding: '11px' }} onClick={generatePDF}>🖨️ Imprimer BL</button>
                {doc.status === 'draft' && (
                  <button type="button" className="btn-amber" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => updateStatus('pending')} disabled={updating}>📤 Préparer livraison</button>
                )}
                {doc.status === 'pending' && (
                  <button type="button" className="btn-primary" style={{ justifyContent: 'center', padding: '11px', background: '#065f46' }} onClick={() => {
                    if (confirm('Confirmer la livraison ? Le stock sera décrémenté.')) updateStatus('approved')
                  }} disabled={updating}>✅ Confirmer livraison</button>
                )}
                {['draft', 'pending'].includes(doc.status) && (
                  <button type="button" className="btn-danger" style={{ padding: '10px', justifyContent: 'center' }} onClick={() => { if (confirm('Annuler ce BL ?')) updateStatus('rejected') }} disabled={updating}>❌ Annuler</button>
                )}
                {doc.status === 'approved' && (
                  <div style={{ padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, fontSize: '0.78rem', color: '#065f46', textAlign: 'center' }}>
                    ✅ Livraison confirmée — stock décrémenté
                  </div>
                )}
              </div>
            </div>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '16px 20px', fontSize: '0.7rem', color: '#999', lineHeight: 1.8 }}>
              <div>Créé le: {new Date(doc.created_at).toLocaleString('fr-FR')}</div>
              {doc.validated_at && <div>Livré le: {new Date(doc.validated_at).toLocaleString('fr-FR')}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
