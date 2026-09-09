'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useToast } from '@/components/ui/Toast'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft:     { label: 'Brouillon',  badge: 'badge-gray',  icon: '✏️' },
  pending:   { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  approved:  { label: 'Accepté',    badge: 'badge-green', icon: '✅' },
  rejected:  { label: 'Refusé',     badge: 'badge-red',   icon: '❌' },
  converted: { label: 'Converti',   badge: 'badge-blue',  icon: '🔄' },
}

const FILTERS = [
  { key: 'all',       label: 'Tous' },
  { key: 'draft',     label: '✏️ Brouillon' },
  { key: 'pending',   label: '⏳ En attente' },
  { key: 'approved',  label: '✅ Accepté' },
  { key: 'rejected',  label: '❌ Refusé' },
  { key: 'converted', label: '🔄 Converti' },
  { key: 'expired',   label: '⚠️ Expirés' },
]

function isExpired(status: string, dueDate?: string | null): boolean {
  if (!dueDate || !['draft', 'pending'].includes(status)) return false
  const today = new Date().toISOString().slice(0, 10)
  return dueDate < today
}

const fmt = (n: number | string | null | undefined) =>
  Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const supabase = createClient()
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('documents')
      .select('*, client:clients(id,name,email)')
      .eq('type', 'devis')
      .order('created_at', { ascending: false })
    if (err) { setError('Impossible de charger les devis : ' + err.message); setQuotes([]) }
    else setQuotes(data || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const filtered = quotes.filter(q => {
    if (statusFilter === 'expired') return isExpired(q.status, q.due_date)
    if (statusFilter !== 'all' && q.status !== statusFilter) return false
    const s = search.toLowerCase()
    return !s
      || q.document_number?.toLowerCase().includes(s)
      || q.client?.name?.toLowerCase().includes(s)
      || q.title?.toLowerCase().includes(s)
      || q.rejection_reason?.toLowerCase().includes(s)
  })

  const summary = {
    total: quotes.length,
    draft: quotes.filter(d => d.status === 'draft').length,
    pending: quotes.filter(d => d.status === 'pending').length,
    approved: quotes.filter(d => d.status === 'approved').length,
    rejected: quotes.filter(d => d.status === 'rejected').length,
    converted: quotes.filter(d => d.status === 'converted').length,
    expired: quotes.filter(d => isExpired(d.status, d.due_date)).length,
    totalAmount: quotes.reduce((s, d) => s + Number(d.total_amount || 0), 0),
    pendingAmount: quotes.filter(d => d.status === 'pending').reduce((s, d) => s + Number(d.total_amount || 0), 0),
  }

  async function removeQuote(q: any) {
    if (q.status !== 'draft') return
    if (!confirm(`Supprimer définitivement le devis ${q.document_number || q.title} ?`)) return
    setDeletingId(q.id)
    const { error: err } = await supabase.from('documents').delete().eq('id', q.id).eq('status', 'draft')
    setDeletingId(null)
    if (err) toast('error', 'Suppression impossible : ' + err.message)
    else { toast('success', 'Devis supprimé.'); load() }
  }

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
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{fmt(summary.totalAmount)}</div>
            <div className="stat-label">FCFA — Total devis</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⏳</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{fmt(summary.pendingAmount)}</div>
            <div className="stat-label">FCFA — En attente</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✅</div>
            <div className="stat-value">{summary.approved}</div>
            <div className="stat-label">Acceptés</div>
          </div>
          <div className="stat-card blue">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>🔄</div>
            <div className="stat-value">{summary.converted}</div>
            <div className="stat-label">Convertis en facture</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✏️</div>
            <div className="stat-value">{summary.draft}</div>
            <div className="stat-label">Brouillons</div>
          </div>
          <div className="stat-card red">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>❌</div>
            <div className="stat-value">{summary.rejected}</div>
            <div className="stat-label">Refusés</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⚠️</div>
            <div className="stat-value">{summary.expired}</div>
            <div className="stat-label">Expirés</div>
          </div>
        </div>

        {/* Filtres */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <input className="hub-input" placeholder="🔍 Numéro, client, titre, motif..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 0, background: '#f0ece4', borderRadius: 8, padding: 3, flexWrap: 'wrap' }}>
            {FILTERS.map(f => (
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
          ) : error ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#991b1b' }}>⚠️ {error}</div>
          ) : (
            <table className="hub-table">
              <thead>
                <tr><th>N° Devis</th><th>Client</th><th>Titre</th><th>Date</th><th>Validité</th><th>Montant TTC</th><th>Statut</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map(q => {
                  const cfg = statusConfig[q.status] || statusConfig.draft
                  const expired = isExpired(q.status, q.due_date)
                  return (
                    <tr key={q.id} style={{ opacity: q.status === 'rejected' ? 0.72 : 1 }}>
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
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{new Date(q.content?.document_date || q.created_at).toLocaleDateString('fr-FR')}</td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {q.due_date ? (
                          <span style={{ color: expired ? '#dc2626' : '#666', fontWeight: expired ? 700 : 400 }}>
                            {new Date(q.due_date + 'T00:00:00').toLocaleDateString('fr-FR')}
                          </span>
                        ) : <span style={{ color: '#999' }}>—</span>}
                      </td>
                      <td style={{ fontWeight: 700, fontSize: '0.95rem' }}>{fmt(q.total_amount)} FCFA</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          <span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span>
                          {expired && <span className="badge badge-red">⚠️ Expiré</span>}
                          {q.status === 'rejected' && q.rejection_reason && (
                            <span style={{ fontSize: '0.68rem', color: '#991b1b', maxWidth: 180, lineHeight: 1.3 }} title={q.rejection_reason}>Motif: {q.rejection_reason.slice(0, 60)}{q.rejection_reason.length > 60 ? '…' : ''}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Link href={`/quotes/${q.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>Voir</Link>
                          {q.status === 'draft' && (
                            <>
                              <Link href={`/quotes/new?edit=${q.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>✏️ Modifier</Link>
                              <button type="button" className="btn-danger" style={{ padding: '5px 10px', fontSize: '0.75rem' }} disabled={deletingId === q.id} onClick={() => removeQuote(q)}>
                                {deletingId === q.id ? '…' : '🗑️'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 48, color: '#999' }}>
                    {search ? `Aucun résultat pour "${search}"` : statusFilter === 'expired' ? 'Aucun devis expiré' : 'Aucun devis'}
                    {!search && statusFilter === 'all' && <div style={{ marginTop: 12 }}><Link href="/quotes/new" className="btn-primary" style={{ textDecoration: 'none' }}>+ Créer le premier devis</Link></div>}
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
