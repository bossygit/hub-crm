'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray', icon: '✏️' },
  pending: { label: 'Commandé', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Réceptionné', badge: 'badge-green', icon: '✅' },
  cancelled: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<any[]>([])
  const [summary, setSummary] = useState({ total: 0, draft: 0, pending: 0, approved: 0, amount: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('purchases').select('*, supplier:clients(id,name)').order('created_at', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    const { data } = await q
    const list = data || []
    setPurchases(list)
    setSummary({
      total: list.length,
      draft: list.filter(d => d.status === 'draft').length,
      pending: list.filter(d => d.status === 'pending').length,
      approved: list.filter(d => d.status === 'approved').length,
      amount: list.filter(d => d.status === 'approved').reduce((s, d) => s + Number(d.subtotal || 0), 0),
    })
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const filtered = purchases.filter(p => {
    const s = search.toLowerCase()
    return !s || p.purchase_number?.toLowerCase().includes(s) || p.supplier?.name?.toLowerCase().includes(s)
  })

  return (
    <div className="invoice-page invoice-page--list">
      <div className="page-header">
        <h2>🛒 Achats & réception</h2>
        <Link href="/purchases/new" className="btn-primary" style={{ textDecoration: 'none' }}>+ Nouvelle réception</Link>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 14, marginBottom: 28 }}>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>🛒</div><div className="stat-value">{summary.total}</div><div className="stat-label">Total achats</div></div>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✅</div><div className="stat-value">{summary.approved}</div><div className="stat-label">Réceptionnés</div></div>
          <div className="stat-card amber"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⏳</div><div className="stat-value">{summary.pending}</div><div className="stat-label">Commandés</div></div>
          <div className="stat-card"><div className="stat-value" style={{ fontSize: '1.15rem' }}>{summary.amount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div><div className="stat-label">FCFA réceptionnés</div></div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, maxWidth: 320 }}>
            <input className="hub-input" placeholder="🔍 N° achat, fournisseur..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 0, background: '#f0ece4', borderRadius: 8, padding: 3 }}>
            {[{ key: 'all', label: 'Tous' }, { key: 'draft', label: '✏️ Brouillon' }, { key: 'pending', label: '⏳ Commandé' }, { key: 'approved', label: '✅ Réceptionné' }].map(f => (
              <button key={f.key} type="button" onClick={() => setStatusFilter(f.key)}
                style={{ padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
                  background: statusFilter === f.key ? 'white' : 'transparent', color: statusFilter === f.key ? 'var(--hub-green)' : '#666',
                  boxShadow: statusFilter === f.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
            <table className="hub-table">
              <thead><tr><th>N° achat</th><th>Fournisseur</th><th>Date</th><th>Montant HT</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {filtered.map(p => {
                  const cfg = statusConfig[p.status] || statusConfig.draft
                  return (
                    <tr key={p.id}>
                      <td><Link href={`/purchases/${p.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--hub-green-mid)', textDecoration: 'none' }}>{p.purchase_number}</Link></td>
                      <td style={{ fontWeight: 600 }}>{p.supplier?.name || '—'}</td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{p.date ? new Date(p.date).toLocaleDateString('fr-FR') : '—'}</td>
                      <td>{Number(p.subtotal || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
                      <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                      <td><Link href={`/purchases/${p.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>Voir</Link></td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 48, color: '#999' }}>{search ? 'Aucun résultat' : 'Aucun achat — réceptionnez des matières premières'}</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
