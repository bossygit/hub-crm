'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatFCFA, orderStatusBadge, orderStatusLabel } from '@/lib/portal/catalog'

const STATUS_FILTERS: { key: string; label: string; icon: string }[] = [
  { key: 'all', label: 'Toutes', icon: '📥' },
  { key: 'nouvelle', label: 'Nouvelles', icon: '🆕' },
  { key: 'en_cours', label: 'En cours', icon: '⚙️' },
  { key: 'pret', label: 'Prêtes', icon: '📦' },
  { key: 'livree', label: 'Livrées', icon: '✅' },
  { key: 'convertie', label: 'Converties', icon: '🧾' },
  { key: 'annulee', label: 'Annulées', icon: '❌' },
]

function allowedNextStatuses(status: string): string[] {
  switch (status) {
    case 'nouvelle': return ['en_cours', 'convertie', 'annulee']
    case 'en_cours': return ['pret', 'convertie', 'annulee']
    case 'pret': return ['livree', 'annulee']
    default: return []
  }
}

function StatusBadge({ status }: { status: string }) {
  const c = orderStatusBadge(status)
  return (
    <span style={{ background: c.bg, color: c.fg, fontWeight: 700, fontSize: '0.72rem', padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>
      {orderStatusLabel(status)}
    </span>
  )
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function PortalOrdersPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('nouvelle')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({})
  const [statusDrafts, setStatusDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null))
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    try {
      let query = supabase
        .from('portal_orders')
        .select('*, portal_order_items(*)')
        .order('created_at', { ascending: false })
      if (filter !== 'all') query = query.eq('status', filter)
      const { data, error: err } = await query
      if (err) {
        setError('Impossible de charger les commandes. Vérifiez que la migration fix-portal-orders.sql a été appliquée.')
        setOrders([])
      } else {
        setOrders(data || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filter])

  async function saveOrder(order: any) {
    const next = statusDrafts[order.id]
    let notes = (notesDrafts[order.id] ?? order.internal_notes ?? '').trim()

    if (next === 'annulee') {
      if (!notes) {
        alert('Veuillez indiquer le motif d\'annulation dans la note interne.')
        return
      }
      if (!window.confirm(`Annuler la commande ${order.order_number} ? Cette action est définitive.`)) return
    }

    if (next === 'convertie' && !notes.includes('Facture N°')) {
      notes = (notes ? notes + '\n' : '') +
        'Convertie : créer la facture (module Facturation) puis inscrire « Facture N° … » dans cette note.'
    }

    const patch: Record<string, unknown> = { internal_notes: notes || null }
    if (next && next !== order.status) patch.status = next
    if (order.handled_by == null) {
      patch.handled_by = currentUserId
      patch.handled_at = new Date().toISOString()
    }
    if (!patch.status && notes === (order.internal_notes ?? '').trim()) return

    setSavingId(order.id)
    setError('')
    const { error: err } = await supabase.from('portal_orders').update(patch).eq('id', order.id)
    setSavingId(null)
    if (err) {
      setError(`Erreur lors de l'enregistrement : ${err.message}`)
      return
    }
    setStatusDrafts(prev => { const n = { ...prev }; delete n[order.id]; return n })
    setNotesDrafts(prev => { const n = { ...prev }; delete n[order.id]; return n })
    await load()
  }

  const q = search.trim().toLowerCase()
  const visible = orders.filter(o => {
    if (!q) return true
    return [o.order_number, o.customer_name, o.customer_phone, o.organization]
      .some(v => (v || '').toLowerCase().includes(q))
  })

  const counts: Record<string, number> = { all: orders.length }
  orders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1 })

  return (
    <div>
      <div className="page-header">
        <h2>🛒 Commandes Portail</h2>
        <a href="/portal" target="_blank" className="btn-ghost" style={{ textDecoration: 'none', fontSize: '0.875rem' }}>
          🌐 Voir le portail public →
        </a>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Recherche + filtres */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{ padding: '10px 16px', borderRadius: 10, border: '1.5px solid', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', transition: 'all 0.15s',
                  borderColor: filter === f.key ? 'var(--hub-green-mid)' : '#ddd',
                  background: filter === f.key ? 'var(--hub-green-mid)' : 'white',
                  color: filter === f.key ? 'white' : '#666' }}>
                {f.icon} {f.label}
                <span style={{ opacity: 0.75, marginLeft: 6 }}>{counts[f.key] || 0}</span>
              </button>
            ))}
          </div>
          <input className="hub-input" placeholder="🔍 Rechercher (n° commande, nom, téléphone…)"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: 300, maxWidth: '100%' }} />
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Chargement des commandes…</div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {visible.map(o => {
              const isOpen = !!expanded[o.id]
              const nextStatuses = allowedNextStatuses(o.status)
              const draftNotes = notesDrafts[o.id] ?? o.internal_notes ?? ''
              return (
                <div key={o.id} style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
                  {/* En-tête commande */}
                  <div style={{ padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', cursor: 'pointer' }}
                    onClick={() => setExpanded(prev => ({ ...prev, [o.id]: !prev[o.id] }))}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <StatusBadge status={o.status} />
                      <span style={{ fontWeight: 800, fontFamily: 'monospace', color: 'var(--hub-green-mid)' }}>{o.order_number}</span>
                      <span style={{ fontSize: '0.75rem', color: '#999' }}>
                        {formatDate(o.created_at)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.9rem' }}>{o.customer_name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#999' }}>📞 {o.customer_phone}</div>
                      </div>
                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#333' }}>{formatFCFA(o.total_amount)}</div>
                      <span style={{ color: '#999', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
                    </div>
                  </div>

                  {/* Détail */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid #f0ede4', padding: '20px 24px', background: '#fcfaf5' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 18 }}>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Client</div>
                          <div style={{ fontWeight: 700, color: '#222' }}>{o.customer_name}</div>
                          {o.organization && <div style={{ fontSize: '0.8rem', color: '#666' }}>🏢 {o.organization}</div>}
                          <div style={{ fontSize: '0.82rem', color: '#333' }}>📞 {o.customer_phone}</div>
                          {o.customer_email && <div style={{ fontSize: '0.82rem', color: '#333' }}>✉️ {o.customer_email}</div>}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Livraison & précisions</div>
                          {o.delivery_address
                            ? <div style={{ fontSize: '0.85rem' }}>📍 {o.delivery_address}</div>
                            : <div style={{ fontSize: '0.8rem', color: '#aaa' }}>À confirmer par téléphone</div>}
                          {o.notes && <div style={{ fontSize: '0.8rem', color: '#666', marginTop: 6 }}>💬 {o.notes}</div>}
                          {o.handled_at && (
                            <div style={{ fontSize: '0.72rem', color: '#999', marginTop: 6 }}>
                              ✅ Prise en charge le {formatDate(o.handled_at)}
                            </div>
                          )}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Articles ({o.portal_order_items?.length || 0})</div>
                          <div style={{ fontSize: '0.8rem' }}>
                            {o.portal_order_items?.length
                              ? o.portal_order_items.map((it: any) => (
                                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '2px 0' }}>
                                  <span style={{ flex: 1, color: '#444' }}>
                                    {it.quantity} × {it.name}{it.unit ? ` (${it.unit})` : ''}
                                  </span>
                                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatFCFA(it.subtotal)}</span>
                                </div>
                              ))
                              : <span style={{ color: '#999' }}>Aucun article enregistré.</span>}
                            <div style={{ borderTop: '1px dashed #ddd', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: 'var(--hub-green-mid)' }}>
                              <span>Total</span><span>{formatFCFA(o.total_amount)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Gestion */}
                      <div style={{ display: 'grid', gridTemplateColumns: nextStatuses.length ? '200px 1fr auto' : '1fr auto', gap: 12, alignItems: 'flex-start' }}>
                        {nextStatuses.length > 0 && (
                          <div className="hub-form-group" style={{ margin: 0 }}>
                            <label>Nouveau statut</label>
                            <select className="hub-select" value={statusDrafts[o.id] || ''}
                              onChange={e => setStatusDrafts(prev => ({ ...prev, [o.id]: e.target.value }))}>
                              <option value="">-- Choisir --</option>
                              {nextStatuses.map(s => <option key={s} value={s}>{orderStatusLabel(s)}</option>)}
                            </select>
                          </div>
                        )}
                        <div className="hub-form-group" style={{ margin: 0 }}>
                          <label>{nextStatuses.length ? 'Note interne / motif (requis pour annulation)' : 'Note interne'}</label>
                          <textarea className="hub-input" rows={2} value={draftNotes}
                            onChange={e => setNotesDrafts(prev => ({ ...prev, [o.id]: e.target.value }))}
                            placeholder={nextStatuses.length ? 'Motif, coordonnées du livreur, n° de facture…' : 'Historique du traitement…'}
                            style={{ resize: 'vertical' }} />
                        </div>
                        <div style={{ paddingTop: 22 }}>
                          <button className="btn-primary" style={{ padding: '10px 18px', fontSize: '0.82rem' }}
                            disabled={savingId === o.id}
                            onClick={() => saveOrder(o)}>
                            {savingId === o.id ? 'Enregistrement…' : '💾 Enregistrer'}
                          </button>
                        </div>
                      </div>
                      {nextStatuses.length > 0 && (
                        <div style={{ fontSize: '0.72rem', color: '#999', marginTop: 8 }}>
                          Statuts possibles : {nextStatuses.map(s => orderStatusLabel(s)).join(' → ')}.
                          {o.status !== 'convertie' && ' « Convertie » crée la facture côté interne (module Facturation).'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {!loading && visible.length === 0 && (
              <div style={{ textAlign: 'center', padding: 60, color: '#999', background: 'white', borderRadius: 12, border: '1px solid #e8e4db' }}>
                Aucune commande{filter !== 'all' ? ` avec le statut « ${orderStatusLabel(filter)} »` : ''}
                {q ? ' ne correspond à votre recherche' : ''}.
                <div style={{ fontSize: '0.8rem', marginTop: 8 }}>
                  Les commandes passées sur le portail public apparaissent ici.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
