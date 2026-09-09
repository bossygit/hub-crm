'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft:    { label: 'Brouillon', badge: 'badge-gray',  icon: '✏️' },
  pending:  { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Livré', badge: 'badge-green', icon: '✅' },
  rejected: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

const STATUS_KEYS = ['all', 'draft', 'pending', 'approved', 'rejected'] as const
type StatusKey = typeof STATUS_KEYS[number]
const URL_STATUS_KEYS: readonly string[] = ['draft', 'pending', 'approved', 'rejected']

export default function DeliveryNotesPage() {
  const searchParams = useSearchParams()
  const urlStatus = searchParams.get('status')

  const [notes, setNotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusKey>(
    URL_STATUS_KEYS.includes(urlStatus || '') ? (urlStatus as StatusKey) : 'all'
  )
  const [clientFilter, setClientFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const supabase = createClient()

  // Synchronise avec un lien profond du type /delivery-notes?status=pending (tableau de bord).
  useEffect(() => {
    if (URL_STATUS_KEYS.includes(urlStatus || '')) {
      setStatusFilter(urlStatus as StatusKey)
    } else if (urlStatus) {
      setStatusFilter('all')
    }
  }, [urlStatus])

  async function load() {
    setLoading(true); setLoadError(null)
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*, client:clients(id,name), invoice:invoices(id,invoice_number)')
        .eq('type', 'bon_livraison')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      setNotes(data || [])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const summary = useMemo(() => ({
    total: notes.length,
    draft: notes.filter(d => d.status === 'draft').length,
    pending: notes.filter(d => d.status === 'pending').length,
    approved: notes.filter(d => d.status === 'approved').length,
    rejected: notes.filter(d => d.status === 'rejected').length,
  }), [notes])

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of notes) if (n.client_id && n.client?.name) map.set(n.client_id, n.client.name)
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [notes])

  const hasFilters = statusFilter !== 'all' || clientFilter !== '' || fromDate !== '' || toDate !== '' || search.trim() !== ''
  const resetFilters = () => { setStatusFilter('all'); setClientFilter(''); setFromDate(''); setToDate(''); setSearch('') }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return notes.filter(n => {
      if (statusFilter !== 'all' && n.status !== statusFilter) return false
      if (clientFilter && n.client_id !== clientFilter) return false
      const day = (n.created_at || '').slice(0, 10)
      if (fromDate && day < fromDate) return false
      if (toDate && day > toDate) return false
      if (!q) return true
      return [n.document_number, n.title, n.client?.name, n.invoice?.invoice_number]
        .some(v => (v || '').toLowerCase().includes(q))
    })
  }, [notes, statusFilter, clientFilter, fromDate, toDate, search])

  return (
    <div className="invoice-page invoice-page--list">
      <div className="page-header">
        <h2>🚚 Bons de Livraison</h2>
        <Link href="/delivery-notes/new" className="btn-primary" style={{ textDecoration: 'none' }}>+ Nouveau BL</Link>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 14, marginBottom: 28 }}>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>🚚</div><div className="stat-value">{summary.total}</div><div className="stat-label">Total BL</div></div>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✅</div><div className="stat-value">{summary.approved}</div><div className="stat-label">Livrés</div></div>
          <div className="stat-card amber"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⏳</div><div className="stat-value">{summary.pending}</div><div className="stat-label">En attente</div></div>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✏️</div><div className="stat-value">{summary.draft}</div><div className="stat-label">Brouillons</div></div>
          <div className="stat-card red"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>❌</div><div className="stat-value">{summary.rejected}</div><div className="stat-label">Annulés</div></div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, maxWidth: 300 }}>
            <input className="hub-input" placeholder="🔍 N° BL, client, facture..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="hub-select" style={{ maxWidth: 220 }} value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
            <option value="">👥 Tous les clients</option>
            {clientOptions.map(([cid, name]) => <option key={cid} value={cid}>{name}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#666' }}>
            <span>Du</span>
            <input className="hub-input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ padding: '7px 10px' }} />
            <span>au</span>
            <input className="hub-input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ padding: '7px 10px' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 0, background: '#f0ece4', borderRadius: 8, padding: 3, flexWrap: 'wrap' }}>
            {STATUS_KEYS.map(k => (
              <button key={k} type="button" onClick={() => setStatusFilter(k)}
                style={{ padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
                  background: statusFilter === k ? 'white' : 'transparent', color: statusFilter === k ? 'var(--hub-green)' : '#666',
                  boxShadow: statusFilter === k ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
                {k === 'all' ? 'Tous' : `${statusConfig[k].icon} ${statusConfig[k].label}`}
                <span style={{ opacity: 0.6, marginLeft: 5, fontSize: '0.72rem' }}>{k === 'all' ? summary.total : summary[k as Exclude<StatusKey, 'all'>]}</span>
              </button>
            ))}
          </div>
          {hasFilters && (
            <button type="button" onClick={resetFilters} className="btn-ghost" style={{ padding: '7px 12px', fontSize: '0.78rem', color: '#991b1b' }}>
              ✕ Effacer les filtres
            </button>
          )}
        </div>

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : loadError ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#991b1b' }}>
              <div>Erreur de chargement : {loadError}</div>
              <button type="button" className="btn-primary" style={{ marginTop: 14 }} onClick={load}>↻ Réessayer</button>
            </div>
          ) : (
            <table className="hub-table">
              <thead><tr><th>N° BL</th><th>Facture liée</th><th>Client</th><th>Date</th><th>Statut</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(n => {
                  const cfg = statusConfig[n.status] || statusConfig.draft
                  const draftRejected = n.status === 'draft' && !!n.rejection_reason
                  const wasDeliveredThenCancelled = n.status === 'rejected' && !!n.validated_at
                  return (
                    <tr key={n.id}>
                      <td>
                        <Link href={`/delivery-notes/${n.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--hub-green-mid)', textDecoration: 'none' }}>{n.document_number || `#${n.id.slice(-6)}`}</Link>
                        {n.invoice_id && !n.invoice && <div style={{ fontSize: '0.68rem', color: '#999' }}>📎 facture supprimée</div>}
                      </td>
                      <td>{n.invoice ? <Link href={`/invoices/${n.invoice.id}`} style={{ fontFamily: 'monospace', color: 'var(--hub-green-mid)', textDecoration: 'none', fontSize: '0.85rem' }}>{n.invoice.invoice_number}</Link> : <span style={{ fontSize: '0.78rem', color: '#999' }}>— autonome</span>}</td>
                      <td><div style={{ fontWeight: 600 }}>{n.client?.name || '—'}</div></td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{new Date(n.created_at).toLocaleDateString('fr-FR')}</td>
                      <td>
                        <span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span>
                        {n.status === 'rejected' && wasDeliveredThenCancelled && <span className="badge badge-red" style={{ marginLeft: 6 }}>↩️ livré</span>}
                        {draftRejected && <span className="badge badge-red" style={{ marginLeft: 6 }} title={n.rejection_reason || undefined}>⚠️ rejeté</span>}
                      </td>
                      <td><Link href={`/delivery-notes/${n.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>Voir</Link></td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 48, color: '#999' }}>
                    {notes.length === 0 ? 'Aucun bon de livraison. Créez-en un avec « + Nouveau BL ».' : 'Aucun résultat pour ces filtres.'}
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
