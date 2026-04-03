'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft:     { label: 'Brouillon',  badge: 'badge-gray',  icon: '✏️' },
  pending:   { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  approved:  { label: 'Accepté',    badge: 'badge-green', icon: '✅' },
  rejected:  { label: 'Refusé',     badge: 'badge-red',   icon: '❌' },
  converted: { label: 'Converti',   badge: 'badge-blue',  icon: '🔄' },
}

export default function QuoteDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const [doc, setDoc] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [converting, setConverting] = useState(false)
  const supabase = createClient()

  async function load() {
    setLoading(true)
    const [{ data: d }, { data: it }] = await Promise.all([
      supabase.from('documents').select('*, client:clients(*)').eq('id', id).single(),
      supabase.from('document_items').select('*, product:products(name,unit)').eq('document_id', id).order('sort_order'),
    ])
    setDoc(d); setItems(it || []); setLoading(false)
  }
  useEffect(() => { load() }, [id])

  async function updateStatus(status: string) {
    setUpdating(true)
    const { data: userData } = await supabase.auth.getUser()
    await supabase.from('documents').update({
      status, updated_at: new Date().toISOString(),
      ...(status === 'approved' ? { validated_by: userData.user?.id, validated_at: new Date().toISOString() } : {}),
    }).eq('id', id)

    if (status === 'pending' && doc) {
      try {
        await fetch('/api/notifications/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'quote_pending',
            title: `Devis ${doc.document_number} en attente`,
            message: `Devis ${doc.title || doc.document_number} — ${Number(doc.total_amount || 0).toLocaleString('fr-FR')} FCFA`,
            referenceId: id,
            referenceType: 'quote',
            link: `/quotes/${id}`,
          }),
        })
      } catch { /* best-effort */ }
    }

    load(); setUpdating(false)
  }

  async function convertToInvoice() {
    if (!doc || converting) return
    if (!confirm('Convertir ce devis en facture ? Le devis sera marqué comme converti.')) return
    setConverting(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { data: numData } = await supabase.rpc('generate_invoice_number')
      const { data: inv, error } = await supabase.from('invoices').insert({
        invoice_number: numData,
        client_id: doc.client_id || null,
        date: new Date().toISOString().split('T')[0],
        due_date: doc.due_date || null,
        status: 'draft',
        subtotal: Number(doc.total_amount || 0) - Number(doc.tax_amount || 0) + Number(doc.discount || 0),
        discount: doc.discount || 0, tax_rate: doc.tax_rate || 18, tax_amount: doc.tax_amount || 0,
        total: doc.total_amount || 0,
        notes: doc.content?.notes || '', payment_terms: doc.payment_terms || '30 jours',
        created_by: userData.user?.id,
      }).select('id').single()
      if (error || !inv) throw new Error(error?.message || 'Erreur')
      if (items.length > 0) {
        await supabase.from('invoice_items').insert(
          items.map((it, idx) => ({ invoice_id: inv.id, product_id: it.product_id, name: it.name, description: it.description || '', quantity: it.quantity, unit: it.unit || 'kg', unit_price: it.unit_price, tax_rate: doc.tax_rate || 18, sort_order: idx }))
        )
      }
      await supabase.from('documents').update({ status: 'converted', invoice_id: inv.id }).eq('id', id)
      router.push(`/invoices/${inv.id}`)
    } catch (err: unknown) {
      alert('Erreur: ' + (err instanceof Error ? err.message : String(err)))
    } finally { setConverting(false) }
  }

  function generatePDF() {
    if (!doc) return
    const cfg = statusConfig[doc.status] || statusConfig.draft
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Devis ${doc.document_number}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:white;padding:0}@page{margin:15mm 18mm;size:A4}
.header{display:flex;justify-content:space-between;align-items:flex-start;padding:24px 32px 20px;background:#1a3d2b;color:white}
.logo-area{display:flex;align-items:center;gap:14px}.company-name{font-size:1.4rem;font-weight:800;font-family:Georgia,serif}
.company-sub{font-size:0.7rem;opacity:0.65;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px}
.badge-type{background:#d4a017;color:white;padding:5px 14px;border-radius:4px;font-weight:700;font-size:0.85rem}
.body{padding:28px 32px}
.meta-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px}
.meta-box{background:#f8f5ee;padding:14px 16px;border-radius:8px}
.meta-label{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:4px}
.meta-value{font-size:0.9rem;font-weight:600;color:#1a3d2b}
.client-section{margin-bottom:24px;padding:16px 20px;border-left:4px solid #2d6a4f;background:#f8f5ee;border-radius:0 8px 8px 0}
table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:0.875rem}
thead tr{background:#1a3d2b;color:white}th{padding:10px 14px;text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.07em;font-weight:700}
th:last-child{text-align:right}td{padding:10px 14px;border-bottom:1px solid #f0ece4}td:last-child{text-align:right;font-weight:600}
.total-final{background:#1a3d2b;color:white;padding:12px 16px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-top:8px}
.total-final .amount{font-family:Georgia,serif;font-size:1.4rem;font-weight:800}
.signature-section{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px;padding-top:20px;border-top:1px solid #ddd}
.sig-box{text-align:center}.sig-area{border:1.5px dashed #ccc;border-radius:8px;height:60px;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:0.8rem}
.footer{padding:12px 32px;background:#0f1f17;color:rgba(255,255,255,0.5);font-size:0.7rem;display:flex;justify-content:space-between}
.validity{padding:10px 16px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;font-size:0.82rem;color:#92400e;margin-bottom:20px}
</style></head><body>
<div class="header"><div class="logo-area"><div><div class="company-name">HUB Distribution</div><div class="company-sub">Transformation & Distribution Agricole</div></div></div>
<div style="text-align:right"><div class="badge-type">📝 DEVIS</div><div style="font-family:monospace;font-size:1.1rem;font-weight:700;margin-top:6px">${doc.document_number || ''}</div></div></div>
<div class="body">
<div class="meta-grid">
<div class="meta-box"><div class="meta-label">Date</div><div class="meta-value">${new Date(doc.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
<div class="meta-box"><div class="meta-label">Validité</div><div class="meta-value">${doc.due_date ? new Date(doc.due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</div></div>
<div class="meta-box"><div class="meta-label">Conditions</div><div class="meta-value">${doc.payment_terms || '30 jours'}</div></div>
</div>
${doc.client ? `<div class="client-section"><div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:4px">Client</div><div style="font-size:1.05rem;font-weight:700;color:#1a3d2b">${doc.client.name}</div>${doc.client.email ? `<div style="font-size:0.8rem;color:#555">📧 ${doc.client.email}</div>` : ''}${doc.client.phone ? `<div style="font-size:0.8rem;color:#555">📱 ${doc.client.phone}</div>` : ''}</div>` : ''}
<div class="validity">⏳ Ce devis est valable jusqu'au ${doc.due_date ? new Date(doc.due_date).toLocaleDateString('fr-FR') : '—'}. Passé ce délai, les prix peuvent être révisés.</div>
<table><thead><tr><th style="width:40%">Désignation</th><th style="width:12%">Qté</th><th style="width:12%">Unité</th><th style="width:18%">Prix unitaire</th><th style="width:18%">Total HT</th></tr></thead><tbody>
${items.map((it: any) => `<tr><td><div style="font-weight:600;color:#1a3d2b">${it.name}</div>${it.description ? `<div style="font-size:0.75rem;color:#888">${it.description}</div>` : ''}</td><td>${it.quantity}</td><td>${it.unit || '—'}</td><td>${Number(it.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td><td>${Number(it.subtotal || it.quantity * it.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td></tr>`).join('')}
</tbody></table>
<div style="display:flex;justify-content:flex-end;margin-bottom:28px"><div style="width:300px">
<div style="display:flex;justify-content:space-between;padding:7px 0;font-size:0.875rem;border-bottom:1px solid #f0ece4"><span style="color:#666">Sous-total HT</span><span>${Number((doc.total_amount || 0) - (doc.tax_amount || 0) + (doc.discount || 0)).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span></div>
${Number(doc.discount) > 0 ? `<div style="display:flex;justify-content:space-between;padding:7px 0;font-size:0.875rem;border-bottom:1px solid #f0ece4"><span style="color:#666">Remise</span><span style="color:#dc2626">- ${Number(doc.discount).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span></div>` : ''}
<div style="display:flex;justify-content:space-between;padding:7px 0;font-size:0.875rem;border-bottom:1px solid #f0ece4"><span style="color:#666">TVA (${doc.tax_rate || 18}%)</span><span>${Number(doc.tax_amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span></div>
<div class="total-final"><div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;opacity:0.8">Total TTC</div><div class="amount">${Number(doc.total_amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</div></div>
</div></div>
<div class="signature-section"><div class="sig-box"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Émetteur — HUB Distribution</div><div class="sig-area">Signature & Cachet</div></div>
<div class="sig-box"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Client — ${doc.client?.name || 'Client'}</div><div class="sig-area">Bon pour accord</div></div></div>
</div>
<div class="footer"><span>HUB Distribution — RCCM: BZV-XXXX-XX — NIF: XXXXXXXXXX — Brazzaville, Congo</span><span>Généré le ${new Date().toLocaleDateString('fr-FR')}</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 800) }
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#999' }}>Chargement...</div>
  if (!doc) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Devis introuvable</div>

  const cfg = statusConfig[doc.status] || statusConfig.draft

  return (
    <div className="invoice-page invoice-page--detail">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>📝 {doc.document_number || 'Devis'}</h2>
          <span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn-ghost" onClick={generatePDF}>🖨️ Imprimer / PDF</button>
          {doc.status === 'approved' && !doc.invoice_id && (
            <button type="button" className="btn-primary" onClick={convertToInvoice} disabled={converting}>
              {converting ? '⏳ Conversion...' : '🔄 Convertir en Facture'}
            </button>
          )}
          {doc.invoice_id && (
            <Link href={`/invoices/${doc.invoice_id}`} className="btn-ghost" style={{ textDecoration: 'none' }}>🧾 Voir la facture</Link>
          )}
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
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
                  <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{new Date(doc.created_at).toLocaleDateString('fr-FR')}</div>
                </div>
              </div>
              <div style={{ padding: '20px 24px' }}>
                {doc.title && <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--hub-green)', marginBottom: 12 }}>{doc.title}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
                  {[['Date', new Date(doc.created_at).toLocaleDateString('fr-FR')], ['Validité', doc.due_date ? new Date(doc.due_date).toLocaleDateString('fr-FR') : '—'], ['Conditions', doc.payment_terms || '30 jours']].map(([l, v]) => (
                    <div key={l} style={{ background: '#f8f5ee', padding: '12px 14px', borderRadius: 8 }}>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', fontWeight: 700, marginBottom: 3 }}>{l}</div>
                      <div style={{ fontWeight: 600, color: 'var(--hub-green)' }}>{v}</div>
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
              <table className="hub-table">
                <thead><tr><th>Désignation</th><th>Qté</th><th>Unité</th><th>Prix unit.</th><th>Total HT</th></tr></thead>
                <tbody>
                  {items.map((it: any) => (
                    <tr key={it.id}>
                      <td><div style={{ fontWeight: 600 }}>{it.name}</div>{it.description && <div style={{ fontSize: '0.75rem', color: '#999' }}>{it.description}</div>}</td>
                      <td style={{ fontWeight: 700 }}>{it.quantity}</td>
                      <td style={{ color: '#666' }}>{it.unit || '—'}</td>
                      <td>{Number(it.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
                      <td style={{ fontWeight: 700 }}>{Number(it.subtotal || it.quantity * it.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '16px 20px', background: '#f8f5ee', display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ width: 300 }}>
                  {[['Sous-total HT', `${Number((doc.total_amount || 0) - (doc.tax_amount || 0) + (doc.discount || 0)).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`],
                    ...(Number(doc.discount) > 0 ? [['Remise', `- ${Number(doc.discount).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`]] : []),
                    [`TVA (${doc.tax_rate || 18}%)`, `${Number(doc.tax_amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`],
                  ].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.875rem', borderBottom: '1px solid #e8e4db' }}>
                      <span style={{ color: '#666' }}>{l}</span><span>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, padding: '12px 16px', background: 'var(--hub-green)', color: 'white', borderRadius: 8 }}>
                    <span style={{ fontWeight: 700 }}>Total TTC</span>
                    <span style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', fontWeight: 800 }}>{Number(doc.total_amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span>
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
                <button type="button" className="btn-primary" style={{ justifyContent: 'center', padding: '11px' }} onClick={generatePDF}>🖨️ Imprimer / PDF</button>
                {doc.status === 'draft' && (
                  <button type="button" className="btn-amber" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => updateStatus('pending')} disabled={updating}>📤 Soumettre</button>
                )}
                {doc.status === 'pending' && (
                  <>
                    <button type="button" className="btn-primary" style={{ justifyContent: 'center', padding: '11px', background: '#065f46' }} onClick={() => updateStatus('approved')} disabled={updating}>✅ Accepter</button>
                    <button type="button" className="btn-ghost" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => updateStatus('rejected')} disabled={updating}>❌ Refuser</button>
                  </>
                )}
                {doc.status === 'approved' && !doc.invoice_id && (
                  <button type="button" className="btn-primary" style={{ justifyContent: 'center', padding: '11px' }} onClick={convertToInvoice} disabled={converting}>
                    {converting ? '⏳...' : '🔄 Convertir en Facture'}
                  </button>
                )}
                {doc.invoice_id && (
                  <Link href={`/invoices/${doc.invoice_id}`} className="btn-ghost" style={{ textDecoration: 'none', textAlign: 'center', padding: '11px' }}>🧾 Voir la facture liée</Link>
                )}
              </div>
            </div>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '16px 20px', fontSize: '0.7rem', color: '#999', lineHeight: 1.8 }}>
              <div>Créé le: {new Date(doc.created_at).toLocaleString('fr-FR')}</div>
              {doc.validated_at && <div>Validé le: {new Date(doc.validated_at).toLocaleString('fr-FR')}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
