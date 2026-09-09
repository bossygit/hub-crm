'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { buildInventorySnapshot } from '@/lib/stock/units'
import { isBlindSession } from '@/lib/stock/inventoryBlind'
import { useRouter } from 'next/navigation'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft: { label: 'En cours', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Validé', badge: 'badge-green', icon: '✅' },
  cancelled: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

export default function InventoryListPage() {
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [blind, setBlind] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const supabase = createClient()
  const { toast } = useToast()
  const router = useRouter()

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('inventory_sessions').select('*').order('created_at', { ascending: false })
    setSessions(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function startCount() {
    setStarting(true)
    setErrorMsg('')
    const [{ data: products }, { data: batches }, { data: userData }, { data: num }] = await Promise.all([
      supabase.from('products').select('id, name, quantity, unit').order('name'),
      supabase.from('product_batches').select('id, product_id, batch_number, quantity, quality_status'),
      supabase.auth.getUser(),
      supabase.rpc('generate_inventory_number'),
    ])
    const snapshot = buildInventorySnapshot(products || [], batches || [])
    if (snapshot.length === 0) {
      toast('warning', 'Aucun stock à compter.')
      setStarting(false)
      return
    }
    const { data: session, error } = await supabase.from('inventory_sessions').insert({
      session_number: num as string,
      status: 'draft',
      created_by: userData.user?.id,
      blind,
      started_at: new Date().toISOString(),
      counted_by: blind ? userData.user?.id : null,
    }).select('id').single()
    if (error || !session) {
      const msg = error?.message || 'Erreur lors de la création de la séance'
      setErrorMsg(msg)
      toast('error', msg)
      setStarting(false)
      return
    }
    const { error: linesError } = await supabase.from('inventory_lines').insert(snapshot.map((line, idx) => ({
      session_id: session.id,
      product_id: line.product_id,
      batch_id: line.batch_id,
      name: line.product_name,
      batch_number: line.batch_number,
      unit: line.unit,
      theoretical: line.theoretical,
      // Aveugle : chaque ligne démarre vide (rien n'est pré-rempli avec le théorique).
      counted: blind ? 0 : line.theoretical,
      entry_quantity: blind ? null : line.theoretical,
      entry_unit: line.unit,
      sort_order: idx,
    })))
    setStarting(false)
    if (linesError) { setErrorMsg(linesError.message); toast('error', linesError.message); return }
    router.push(`/stock/inventory/${session.id}`)
  }

  return (
    <div>
      <div className="page-header">
        <h2>📋 Inventaire physique</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/stock" className="btn-ghost" style={{ textDecoration: 'none' }}>← Stock</Link>
          <button className="btn-primary" disabled={starting} onClick={startCount}>{starting ? '...' : '+ Nouveau comptage'}</button>
        </div>
      </div>
      <div style={{ padding: '24px 32px' }}>
        <p style={{ color: '#666', marginBottom: 20, maxWidth: 720, fontSize: '0.9rem' }}>
          Comptez chaque lot (et le hors-lot). L’écart corrige le stock à la validation.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.9rem', userSelect: 'none' }}
            title="Comptage à l'aveugle : les quantités théoriques restent masquées pendant le comptage. Chaque ligne démarre vide et les écarts ne sont visibles qu'après l'action « Afficher les écarts » (manager)."
          >
            <input type="checkbox" checked={blind} onChange={e => setBlind(e.target.checked)} />
            🎭 Comptage à l’aveugle
          </label>
          {blind && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff7ed', border: '1px solid #fed7aa', color: '#92400e', borderRadius: 10, padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700 }}>
              🔒 Comptage à l’aveugle — valeurs théoriques masquées
            </span>
          )}
        </div>
        {errorMsg && (
          <p style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: '0.85rem' }}>
            {errorMsg}
          </p>
        )}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
            <table className="hub-table">
              <thead><tr><th>N°</th><th>Date</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {sessions.map(s => {
                  const cfg = statusConfig[s.status] || statusConfig.draft
                  return (
                    <tr key={s.id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{s.session_number}{isBlindSession(s) ? ' 🔒' : ''}</td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{new Date(s.created_at).toLocaleDateString('fr-FR')}</td>
                      <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                      <td><Link href={`/stock/inventory/${s.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>Voir</Link></td>
                    </tr>
                  )
                })}
                {sessions.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun inventaire — lancez un comptage</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
