'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft:    { label: 'Brouillon', badge: 'badge-gray',  icon: '✏️' },
  pending:  { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Validé (livré)', badge: 'badge-green', icon: '✅' },
  rejected: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

export default function DeliveryNotesPage() {
  const [notes, setNotes] = useState<any[]>([])
  const [summary, setSummary] = useState({ total: 0, draft: 0, pending: 0, approved: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('documents').select('*, client:clients(id,name,email), invoice:invoices(id,invoice_number)')
      .eq('type', 'bon_livraison').order('created_at', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    const { data } = await q
    const list = data || []
    setNotes(list)
    setSummary({
      total: list.length,
      draft: list.filter(d => d.status === 'draft').length,
      pending: list.filter(d => d.status === 'pending').length,
      approved: list.filter(d => d.status === 'approved').length,
    })
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const filtered = notes.filter(n => {
    const s = search.toLowerCase()
    return !s || n.document_number?.toLowerCase().includes(s) || n.client?.name?.toLowerCase().includes(s) || n.invoice?.invoice_number?.toLowerCase().includes(s)
  })

  return (
    <div className="invoice-page invoice-page--list">
      <div className="page-header">
        <h2>🚚 Bons de Livraison</h2>
        <Link href="/delivery-notes/new" className="btn-primary" style={{ textDecoration: 'none' }}>+ Nouveau BL</Link>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 14, marginBottom: 28 }}>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>🚚</div><div className="stat-value">{summary.total}</div><div className="stat-label">Total BL</div></div>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✅</div><div className="stat-value">{summary.approved}</div><div className="stat-label">Livrés</div></div>
          <div className="stat-card amber"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⏳</div><div className="stat-value">{summary.pending}</div><div className="stat-label">En cours</div></div>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✏️</div><div className="stat-value">{summary.draft}</div><div className="stat-label">Brouillons</div></div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, maxWidth: 320 }}>
            <input className="hub-input" placeholder="🔍 N° BL, client, facture..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 0, background: '#f0ece4', borderRadius: 8, padding: 3 }}>
            {[{ key: 'all', label: 'Tous' }, { key: 'draft', label: '✏️ Brouillon' }, { key: 'pending', label: '⏳ En cours' }, { key: 'approved', label: '✅ Livré' }].map(f => (
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
              <thead><tr><th>N° BL</th><th>Facture liée</th><th>Client</th><th>Date</th><th>Statut</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(n => {
                  const cfg = statusConfig[n.status] || statusConfig.draft
                  return (
                    <tr key={n.id}>
                      <td><Link href={`/delivery-notes/${n.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--hub-green-mid)', textDecoration: 'none' }}>{n.document_number || `#${n.id.slice(-6)}`}</Link></td>
                      <td>{n.invoice ? <Link href={`/invoices/${n.invoice.id}`} style={{ fontFamily: 'monospace', color: 'var(--hub-green-mid)', textDecoration: 'none', fontSize: '0.85rem' }}>{n.invoice.invoice_number}</Link> : '—'}</td>
                      <td><div style={{ fontWeight: 600 }}>{n.client?.name || '—'}</div></td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{new Date(n.created_at).toLocaleDateString('fr-FR')}</td>
                      <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                      <td><Link href={`/delivery-notes/${n.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>Voir</Link></td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 48, color: '#999' }}>{search ? `Aucun résultat` : 'Aucun bon de livraison'}</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
