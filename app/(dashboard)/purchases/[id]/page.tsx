'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/components/ui/Toast'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray', icon: '✏️' },
  pending: { label: 'Commandé', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Réceptionné', badge: 'badge-green', icon: '✅' },
  cancelled: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

export default function PurchaseDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const [doc, setDoc] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  async function load() {
    setLoading(true)
    const [{ data: d }, { data: it }] = await Promise.all([
      supabase.from('purchases').select('*, supplier:clients(*)').eq('id', id).single(),
      supabase.from('purchase_items').select('*, product:products(name,unit), batch:product_batches(batch_number,expiry_date)').eq('purchase_id', id).order('sort_order'),
    ])
    setDoc(d); setItems(it || []); setLoading(false)
  }
  useEffect(() => { load() }, [id])

  async function updateStatus(status: string) {
    setUpdating(true)
    const { data: userData } = await supabase.auth.getUser()
    const extra: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (status === 'approved' || status === 'cancelled') extra.received_by = userData.user?.id
    const { error } = await supabase.from('purchases').update({ status, ...extra }).eq('id', id)
    if (error) toast('error', 'Erreur: ' + error.message)
    else {
      toast('success', status === 'approved' ? 'Stock et lots mis à jour.' : 'Réception annulée, stock restauré.')
      load()
    }
    setUpdating(false)
  }

  function generatePDF() {
    if (!doc) return
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Réception ${doc.purchase_number}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a}
@page{margin:15mm 18mm;size:A4}
.header{display:flex;justify-content:space-between;padding:24px 32px 20px;background:#1a3d2b;color:white}
.company-name{font-size:1.4rem;font-weight:800;font-family:Georgia,serif}
.body{padding:28px 32px}table{width:100%;border-collapse:collapse;font-size:0.875rem}
th{padding:10px 14px;text-align:left;background:#1a3d2b;color:white;font-size:0.72rem;text-transform:uppercase}
td{padding:10px 14px;border-bottom:1px solid #f0ece4}
.footer{padding:12px 32px;background:#0f1f17;color:rgba(255,255,255,0.5);font-size:0.7rem;display:flex;justify-content:space-between}
</style></head><body>
<div class="header"><div><div class="company-name">HUB Distribution</div><div style="font-size:0.7rem;opacity:0.65;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px">Bon de réception</div></div>
<div style="font-family:monospace;font-size:1.1rem">${doc.purchase_number}</div></div>
<div class="body">
<p style="margin-bottom:16px"><strong>Fournisseur :</strong> ${doc.supplier?.name || '—'}<br>
<strong>Date :</strong> ${doc.date ? new Date(doc.date).toLocaleDateString('fr-FR') : '—'}</p>
<table><thead><tr><th>Désignation</th><th>Lot</th><th>Qté</th><th>Prix</th></tr></thead><tbody>
${items.map((it: any) => `<tr><td>${it.name}</td><td>${it.batch?.batch_number || it.batch_number || '—'}</td><td>${it.quantity} ${it.unit || ''}</td><td>${Number(it.unit_price).toLocaleString('fr-FR')} FCFA</td></tr>`).join('')}
</tbody></table>
<p style="margin-top:16px;font-weight:700">Total ${Number(doc.subtotal || 0).toLocaleString('fr-FR')} FCFA</p>
</div>
<div class="footer"><span>HUB Distribution — Brazzaville, Congo</span><span>Imprimé le ${new Date().toLocaleDateString('fr-FR')}</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 800) }
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#999' }}>Chargement...</div>
  if (!doc) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Achat introuvable</div>

  const cfg = statusConfig[doc.status] || statusConfig.draft

  return (
    <div className="invoice-page invoice-page--detail">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>🛒 {doc.purchase_number}</h2>
          <span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn-ghost" onClick={generatePDF}>🖨️ Imprimer</button>
          {['draft', 'pending'].includes(doc.status) && (
            <button type="button" className="btn-primary" onClick={() => updateStatus('approved')} disabled={updating}>✅ Réceptionner</button>
          )}
          {doc.status === 'approved' && (
            <button type="button" className="btn-ghost" onClick={() => { if (confirm('Annuler cette réception et retirer le stock ?')) updateStatus('cancelled') }} disabled={updating}>Annuler la réception</button>
          )}
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div style={{ background: 'var(--hub-green)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', color: 'white' }}>
                <div>
                  <div style={{ fontFamily: 'Georgia, serif', fontWeight: 800, fontSize: '1.1rem' }}>HUB Distribution</div>
                  <div style={{ fontSize: '0.7rem', opacity: 0.65, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Bon de réception</div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '1.2rem', fontWeight: 700 }}>{doc.purchase_number}</div>
              </div>
              <div style={{ padding: '20px 24px' }}>
                {doc.supplier && (
                  <div style={{ padding: '14px 18px', borderLeft: '4px solid var(--hub-green-mid)', background: '#f8f5ee', borderRadius: '0 8px 8px 0' }}>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', fontWeight: 700, marginBottom: 4 }}>Fournisseur</div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--hub-green)' }}>{doc.supplier.name}</div>
                    {doc.supplier.address && <div style={{ fontSize: '0.8rem', color: '#666' }}>{doc.supplier.address}</div>}
                  </div>
                )}
              </div>
            </div>

            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.875rem' }}>📦 Lignes</div>
              <table className="hub-table">
                <thead><tr><th>Désignation</th><th>Lot</th><th>Qté</th><th>Prix unit.</th><th>Total</th></tr></thead>
                <tbody>
                  {items.map((it: any) => (
                    <tr key={it.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{it.name}</div>
                        {it.product?.name && it.product.name !== it.name && <div style={{ fontSize: '0.75rem', color: '#999' }}>{it.product.name}</div>}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#065f46' }}>{it.batch?.batch_number || it.batch_number || '—'}</td>
                      <td style={{ fontWeight: 700 }}>{it.quantity} {it.unit}</td>
                      <td>{Number(it.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
                      <td style={{ fontWeight: 700 }}>{Number(it.subtotal || it.quantity * it.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px' }}>
              <div style={{ fontSize: '0.8rem', color: '#666' }}>Total HT</div>
              <div style={{ fontWeight: 800, fontSize: '1.4rem', color: 'var(--hub-green)' }}>{Number(doc.subtotal || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</div>
              <div style={{ marginTop: 12, fontSize: '0.8rem', color: '#666' }}>Date {doc.date ? new Date(doc.date).toLocaleDateString('fr-FR') : '—'}</div>
              {doc.received_at && <div style={{ fontSize: '0.8rem', color: '#666' }}>Réception {new Date(doc.received_at).toLocaleDateString('fr-FR')}</div>}
              {doc.status === 'approved' && (
                <Link href="/stock" className="btn-ghost" style={{ display: 'inline-block', marginTop: 16, textDecoration: 'none', fontSize: '0.8rem' }}>Voir le stock</Link>
              )}
            </div>
            {doc.notes && <div style={{ marginTop: 12, background: '#f8f5ee', borderRadius: 8, padding: 14, fontSize: '0.85rem', color: '#555' }}>{doc.notes}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
