'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft:     { label: 'Brouillon',  badge: 'badge-gray',  icon: '✏️' },
  pending:   { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  approved:  { label: 'Accepté',    badge: 'badge-green', icon: '✅' },
  rejected:  { label: 'Refusé',     badge: 'badge-red',   icon: '❌' },
  converted: { label: 'Converti',   badge: 'badge-blue',  icon: '🔄' },
}

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<any[]>([])
  const [summary, setSummary] = useState({ total: 0, draft: 0, pending: 0, approved: 0, converted: 0, totalAmount: 0, pendingAmount: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('documents')
      .select('*, client:clients(id,name,email)')
      .eq('type', 'devis')
      .order('created_at', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    const { data } = await q
    const list = data || []
    setQuotes(list)
    setSummary({
      total: list.length,
      draft: list.filter(d => d.status === 'draft').length,
      pending: list.filter(d => d.status === 'pending').length,
      approved: list.filter(d => d.status === 'approved').length,
      converted: list.filter(d => d.status === 'converted').length,
      totalAmount: list.reduce((s, d) => s + Number(d.total_amount || 0), 0),
      pendingAmount: list.filter(d => d.status === 'pending').reduce((s, d) => s + Number(d.total_amount || 0), 0),
    })
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const filtered = quotes.filter(q => {
    const s = search.toLowerCase()
    return !s || q.document_number?.toLowerCase().includes(s) || q.client?.name?.toLowerCase().includes(s) || q.title?.toLowerCase().includes(s)
  })

  return (
    <div className="invoice-page invoice-page--list">
      <div className="page-header">
        <h2>📝 Devis</h2>
        <Link href="/quotes/new" className="btn-primary" style={{ textDecoration: 'none' }}>+ Nouveau devis</Link>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 14, marginBottom: 28 }}>
          <div className="stat-card green">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>📝</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{summary.totalAmount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
            <div className="stat-label">FCFA — Total devis</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⏳</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{summary.pendingAmount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
            <div className="stat-label">FCFA — En attente</div>
          </div>
          <div className="stat-card blue">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>🔄</div>
            <div className="stat-value">{summary.converted}</div>
            <div className="stat-label">Convertis en facture</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✅</div>
            <div className="stat-value">{summary.approved}</div>
            <div className="stat-label">Acceptés</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✏️</div>
            <div className="stat-value">{summary.draft}</div>
            <div className="stat-label">Brouillons</div>
          </div>
        </div>

        {/* Filtres */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <input className="hub-input" placeholder="🔍 Numéro, client, titre..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 0, background: '#f0ece4', borderRadius: 8, padding: 3 }}>
            {[
              { key: 'all', label: 'Tous' },
              { key: 'draft', label: '✏️ Brouillon' },
              { key: 'pending', label: '⏳ En attente' },
              { key: 'approved', label: '✅ Accepté' },
              { key: 'converted', label: '🔄 Converti' },
            ].map(f => (
              <button key={f.key} type="button" onClick={() => setStatusFilter(f.key)}
                style={{ padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
                  background: statusFilter === f.key ? 'white' : 'transparent',
                  color: statusFilter === f.key ? 'var(--hub-green)' : '#666',
                  boxShadow: statusFilter === f.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div>
          ) : (
            <table className="hub-table">
              <thead>
                <tr><th>N° Devis</th><th>Client</th><th>Titre</th><th>Date</th><th>Échéance</th><th>Montant TTC</th><th>Statut</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map(q => {
                  const cfg = statusConfig[q.status] || statusConfig.draft
                  return (
                    <tr key={q.id}>
                      <td>
                        <Link href={`/quotes/${q.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--hub-green-mid)', textDecoration: 'none', fontSize: '0.9rem' }}>
                          {q.document_number || `#${q.id.slice(-6)}`}
                        </Link>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{q.client?.name || '—'}</div>
                        {q.client?.email && <div style={{ fontSize: '0.72rem', color: '#999' }}>{q.client.email}</div>}
                      </td>
                      <td style={{ color: '#555', fontSize: '0.85rem' }}>{q.title || '—'}</td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{new Date(q.created_at).toLocaleDateString('fr-FR')}</td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{q.due_date ? new Date(q.due_date).toLocaleDateString('fr-FR') : '—'}</td>
                      <td style={{ fontWeight: 700, fontSize: '0.95rem' }}>{Number(q.total_amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
                      <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Link href={`/quotes/${q.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>Voir</Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 48, color: '#999' }}>
                    {search ? `Aucun résultat pour "${search}"` : 'Aucun devis'}
                    {!search && <div style={{ marginTop: 12 }}><Link href="/quotes/new" className="btn-primary" style={{ textDecoration: 'none' }}>+ Créer le premier devis</Link></div>}
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
