'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/components/ui/Toast'
import { computeYieldPct, validateActualOutput, yieldBadgeClass, yieldLabel } from '@/lib/production/yield'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray', icon: '✏️' },
  pending: { label: 'Planifié', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Produit', badge: 'badge-green', icon: '✅' },
  cancelled: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

export default function ProductionOrderDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const [doc, setDoc] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [showYield, setShowYield] = useState(false)
  const [yieldActual, setYieldActual] = useState('')
  const [yieldNotes, setYieldNotes] = useState('')
  const [yieldError, setYieldError] = useState<string | null>(null)
  const [yieldSaving, setYieldSaving] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  async function load() {
    setLoading(true)
    const [{ data: d }, { data: it }] = await Promise.all([
      supabase.from('production_orders').select('*, product:products(name,unit), recipe:recipes(name), output_batch:product_batches(batch_number,expiry_date)').eq('id', id).single(),
      supabase.from('production_order_items').select('*, product:products(name,unit), batch:product_batches(batch_number,expiry_date)').eq('order_id', id).order('sort_order'),
    ])
    setDoc(d); setItems(it || []); setLoading(false)
  }
  useEffect(() => { load() }, [id])

  async function updateStatus(status: string) {
    setUpdating(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('production_orders').update({
      status,
      completed_by: userData.user?.id,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) toast('error', 'Erreur: ' + error.message)
    else {
      toast('success', status === 'approved' ? 'MP consommées, lot produit fini créé.' : 'Ordre annulé, stock restauré.')
      load()
    }
    setUpdating(false)
  }

  // Ouvre la modale de saisie du rendement (pré-remplie en mode édition).
  function openYield() {
    setYieldActual(doc?.actual_output_quantity == null ? '' : String(Number(doc.actual_output_quantity)))
    setYieldNotes(doc?.yield_notes || '')
    setYieldError(null)
    setShowYield(true)
  }

  async function saveYield() {
    const raw = yieldActual.trim() === '' ? null : parseFloat(yieldActual.replace(',', '.'))
    const err = validateActualOutput(raw, Number(doc.quantity))
    if (err) { setYieldError(err); return }
    setYieldSaving(true)
    const { error } = await supabase.from('production_orders').update({
      actual_output_quantity: raw,
      yield_notes: yieldNotes.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { setYieldError('Erreur: ' + error.message); setYieldSaving(false); return }
    toast('success', 'Rendement enregistré.')
    setShowYield(false)
    setYieldSaving(false)
    load()
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#999' }}>Chargement...</div>
  if (!doc) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Ordre introuvable</div>

  const cfg = statusConfig[doc.status] || statusConfig.draft
  const plannedQty = Number(doc.quantity)
  const actualQty = doc.actual_output_quantity == null ? null : Number(doc.actual_output_quantity)
  const pct = computeYieldPct(actualQty, plannedQty)
  const pfUnit = doc.product?.unit || ''

  return (
    <div className="invoice-page invoice-page--detail">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>🏭 {doc.order_number}</h2>
          <span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {['draft', 'pending'].includes(doc.status) && (
            <button type="button" className="btn-primary" onClick={() => updateStatus('approved')} disabled={updating}>✅ Produire</button>
          )}
          {doc.status === 'approved' && (
            <button type="button" className="btn-ghost" onClick={() => { if (confirm('Annuler cet ordre et restaurer le stock ?')) updateStatus('cancelled') }} disabled={updating}>Annuler</button>
          )}
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px 24px' }}>
              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', fontWeight: 700 }}>Produit fini</div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--hub-green)' }}>{doc.product?.name} · {doc.quantity} {doc.product?.unit}</div>
              <div style={{ fontSize: '0.85rem', color: '#666', marginTop: 4 }}>Recette : {doc.recipe?.name || '—'} · Lot PF : {doc.output_batch?.batch_number || doc.batch_number || '—'}</div>
            </div>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', fontWeight: 700, color: 'var(--hub-green)' }}>Matières consommées</div>
              <table className="hub-table">
                <thead><tr><th>Matière</th><th>Lot</th><th>Qté</th></tr></thead>
                <tbody>
                  {items.map((it: any) => (
                    <tr key={it.id}>
                      <td style={{ fontWeight: 600 }}>{it.name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#065f46' }}>{it.batch?.batch_number || '—'}</td>
                      <td>{it.quantity} {it.unit}</td>
                    </tr>
                  ))}
                  {items.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 32, color: '#999' }}>Aucune matière</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <Link href="/stock" className="btn-ghost" style={{ textDecoration: 'none', fontSize: '0.85rem' }}>Voir le stock</Link>

            {doc.status === 'approved' && (
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '16px 18px', marginTop: 12 }}>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', fontWeight: 700, marginBottom: 10 }}>📊 Rendement</div>
                <div style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ color: '#666' }}>Planifié</span><strong>{plannedQty} {pfUnit}</strong>
                </div>
                {actualQty == null ? (
                  <>
                    <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: 10 }}>Réel obtenu : non saisi</div>
                    <button type="button" className="btn-amber" style={{ width: '100%' }} onClick={openYield}>Saisir le rendement</button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ color: '#666' }}>Réel obtenu</span><strong>{actualQty} {pfUnit}</strong>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
                      <span className={`badge ${yieldBadgeClass(pct)}`}>{pct == null ? '—' : `${pct} %`}</span>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#333' }}>{yieldLabel(pct)}</span>
                    </div>
                    {doc.yield_notes && (
                      <div style={{ fontSize: '0.8rem', color: '#555', background: '#f8f5ee', borderRadius: 6, padding: 8, marginTop: 6, whiteSpace: 'pre-wrap' }}>{doc.yield_notes}</div>
                    )}
                    <button type="button" className="btn-ghost" style={{ width: '100%', marginTop: 10, fontSize: '0.8rem' }}
                      onClick={() => { if (confirm('Modifier le rendement déjà saisi ?')) openYield() }}>Modifier</button>
                  </>
                )}
              </div>
            )}

            {doc.notes && <div style={{ marginTop: 12, background: '#f8f5ee', borderRadius: 8, padding: 14, fontSize: '0.85rem' }}>{doc.notes}</div>}
          </div>
        </div>
      </div>

      {showYield && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowYield(false)}>
          <div className="modal-box" style={{ maxWidth: 480 }}>
            <div className="modal-title">📊 Saisir le rendement — {doc.order_number}</div>
            <div style={{ fontSize: '0.85rem', color: '#666', margin: '6px 0 14px' }}>
              Quantité planifiée : <strong>{plannedQty} {pfUnit}</strong>. Saisissez la quantité réellement obtenue sur le terrain.
            </div>
            <form onSubmit={e => { e.preventDefault(); saveYield() }}>
              <div className="hub-form-group">
                <label>Quantité réellement obtenue{pfUnit ? ` (${pfUnit})` : ''} *</label>
                <input className="hub-input" type="number" min={0.01} step="0.01" required value={yieldActual}
                  onChange={e => { setYieldActual(e.target.value); setYieldError(null) }}
                  placeholder={`Ex : ${plannedQty}`} autoFocus />
              </div>
              <div className="hub-form-group" style={{ marginTop: 10 }}>
                <label>Notes de production (pertes, incidents)</label>
                <textarea className="hub-input" rows={3} value={yieldNotes} onChange={e => setYieldNotes(e.target.value)}
                  placeholder="Ex : 0,8 kg de pertes au séchage, arrêt machine 10 min..." style={{ resize: 'vertical' }} />
              </div>
              {yieldError && <div style={{ color: '#dc2626', fontSize: '0.85rem', margin: '8px 0 0' }}>⚠ {yieldError}</div>}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 14 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowYield(false)} disabled={yieldSaving}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={yieldSaving}>{yieldSaving ? '...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
