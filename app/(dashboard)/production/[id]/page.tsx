'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/components/ui/Toast'

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

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#999' }}>Chargement...</div>
  if (!doc) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Ordre introuvable</div>

  const cfg = statusConfig[doc.status] || statusConfig.draft

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
            {doc.notes && <div style={{ marginTop: 12, background: '#f8f5ee', borderRadius: 8, padding: 14, fontSize: '0.85rem' }}>{doc.notes}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
