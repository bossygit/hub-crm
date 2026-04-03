'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import type { Invoice, ClientFinancialSummary } from '@/types'

const statusConfig = {
  draft:     { label: 'Brouillon', badge: 'badge-gray',  icon: '✏️' },
  pending:   { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  paid:      { label: 'Payée',     badge: 'badge-green', icon: '✅' },
  cancelled: { label: 'Annulée',   badge: 'badge-red',   icon: '❌' },
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [summary, setSummary] = useState({ total: 0, paid: 0, pending: 0, draft: 0, revenue: 0, outstanding: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [duplicating, setDuplicating] = useState<string | null>(null)
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('invoices')
      .select('*, client:clients(id,name,email,phone)')
      .order('created_at', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    const { data } = await q
    const inv = data || []
    setInvoices(inv)
    setSummary({
      total: inv.length,
      paid: inv.filter(i => i.status === 'paid').length,
      pending: inv.filter(i => i.status === 'pending').length,
      draft: inv.filter(i => i.status === 'draft').length,
      revenue: inv.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total || 0), 0),
      outstanding: inv.filter(i => i.status === 'pending').reduce((s, i) => s + Number(i.total || 0), 0),
    })
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  async function duplicateInvoice(inv: any) {
    setDuplicating(inv.id)
    const { data: items } = await supabase.from('invoice_items').select('*').eq('invoice_id', inv.id)
    const { data: userData } = await supabase.auth.getUser()
    // Get new invoice number
    const { data: numData } = await supabase.rpc('generate_invoice_number')
    const { data: newInv } = await supabase.from('invoices').insert({
      invoice_number: numData,
      client_id: inv.client_id,
      date: new Date().toISOString().split('T')[0],
      status: 'draft',
      subtotal: 0, discount: inv.discount || 0,
      tax_rate: inv.tax_rate || 18,
      tax_amount: 0, total: 0,
      notes: inv.notes,
      payment_terms: inv.payment_terms,
      created_by: userData.user?.id,
    }).select().single()
    if (newInv && items) {
      await supabase.from('invoice_items').insert(
        items.map(({ id: _, invoice_id: __, subtotal: ___, ...item }) => ({ ...item, invoice_id: newInv.id }))
      )
    }
    setDuplicating(null)
    load()
  }

  const filtered = invoices.filter(inv => {
    const q = search.toLowerCase()
    return !q || inv.invoice_number?.toLowerCase().includes(q) || inv.client?.name?.toLowerCase().includes(q)
  })

  return (
    <div className="invoice-page invoice-page--list">
      <div className="page-header invoice-page__toolbar">
        <h2>🧾 Facturation</h2>
        <Link href="/invoices/new" className="btn-primary invoice-btn invoice-btn--new" style={{ textDecoration: 'none' }}>+ Nouvelle facture</Link>
      </div>

      <div className="invoice-page__body" style={{ padding: '24px 32px' }}>
        {/* KPIs */}
        <div className="invoice-list__kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14, marginBottom: 28 }}>
          <div className="stat-card green">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>💵</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{summary.revenue.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
            <div className="stat-label">FCFA — Encaissé</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⏳</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{summary.outstanding.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
            <div className="stat-label">FCFA — En attente</div>
          </div>
          <div className="stat-card blue">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✅</div>
            <div className="stat-value">{summary.paid}</div>
            <div className="stat-label">Factures payées</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⏳</div>
            <div className="stat-value">{summary.pending}</div>
            <div className="stat-label">En attente paiement</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✏️</div>
            <div className="stat-value">{summary.draft}</div>
            <div className="stat-label">Brouillons</div>
          </div>
        </div>

        {/* Filtres + Recherche */}
        <div className="invoice-list__filters" style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="invoice-list__search" style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <input className="hub-input invoice-field invoice-field--search" placeholder="🔍 Numéro, client..." value={search}
              onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 16 }} />
          </div>
          <div className="invoice-list__filter-bar" style={{ display: 'flex', gap: 0, background: '#f0ece4', borderRadius: 8, padding: 3 }}>
            {[
              { key: 'all', label: 'Toutes' },
              { key: 'draft', label: '✏️ Brouillon' },
              { key: 'pending', label: '⏳ En attente' },
              { key: 'paid', label: '✅ Payées' },
            ].map(f => (
              <button
                key={f.key}
                type="button"
                className={`invoice-btn invoice-btn--filter${statusFilter === f.key ? ' invoice-btn--filter-active' : ''}`}
                onClick={() => setStatusFilter(f.key)}
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
        <div className="invoice-list__table-wrap" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? (
            <div className="invoice-state invoice-state--loading" style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div>
          ) : (
            <table className="hub-table invoice-list__table">
              <thead>
                <tr><th>N° Facture</th><th>Client</th><th>Date</th><th>Échéance</th><th>Montant TTC</th><th>Statut</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const cfg = statusConfig[inv.status as keyof typeof statusConfig]
                  const isOverdue = inv.status === 'pending' && inv.due_date && new Date(inv.due_date) < new Date()
                  return (
                    <tr key={inv.id}>
                      <td>
                        <Link className="invoice-list__invoice-link" href={`/invoices/${inv.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--hub-green-mid)', textDecoration: 'none', fontSize: '0.9rem' }}>
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{inv.client?.name || <span style={{ color: '#999' }}>—</span>}</div>
                        {inv.client?.email && <div style={{ fontSize: '0.72rem', color: '#999' }}>{inv.client.email}</div>}
                      </td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{new Date(inv.date).toLocaleDateString('fr-FR')}</td>
                      <td style={{ color: isOverdue ? '#dc2626' : '#666', fontSize: '0.85rem', fontWeight: isOverdue ? 700 : 400 }}>
                        {inv.due_date ? new Date(inv.due_date).toLocaleDateString('fr-FR') : '—'}
                        {isOverdue && <span style={{ display: 'block', fontSize: '0.7rem' }}>⚠ En retard</span>}
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{Number(inv.total || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</div>
                        {inv.discount > 0 && <div style={{ fontSize: '0.72rem', color: '#999' }}>Remise: {Number(inv.discount).toLocaleString()} FCFA</div>}
                      </td>
                      <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                      <td>
                        <div className="invoice-list__row-actions" style={{ display: 'flex', gap: 6 }}>
                          <Link href={`/invoices/${inv.id}`} className="btn-ghost invoice-btn invoice-btn--view-row" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>Voir</Link>
                          <Link href={`/invoices/new?duplicate=${inv.id}`} className="btn-ghost invoice-btn invoice-btn--duplicate-row" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>📋 Dupliquer</Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="invoice-state invoice-state--empty" style={{ textAlign: 'center', padding: 48, color: '#999' }}>
                    {search ? `Aucun résultat pour "${search}"` : 'Aucune facture'}
                    {!search && <div style={{ marginTop: 12 }}><Link href="/invoices/new" className="btn-primary invoice-btn invoice-btn--new-first" style={{ textDecoration: 'none' }}>+ Créer la première facture</Link></div>}
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
