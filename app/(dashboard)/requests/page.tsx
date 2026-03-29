'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const statusFlow = ['pending', 'processing', 'approved', 'rejected'] as const
const statusLabels = { pending: 'En attente', processing: 'En cours', approved: 'Approuvé', rejected: 'Rejeté' }
const statusBadge = { pending: 'badge-amber', processing: 'badge-blue', approved: 'badge-green', rejected: 'badge-red' }

export default function RequestsPage() {
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<any>(null)
  const [responseNotes, setResponseNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  async function load() {
    setLoading(true)
    let q = supabase.from('document_requests').select('*').order('created_at', { ascending: false })
    if (filter !== 'all') q = q.eq('status', filter)
    const { data } = await q
    setRequests(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  async function updateStatus(id: string, status: string) {
    setSaving(true)
    await supabase.from('document_requests').update({
      status,
      response_notes: responseNotes || undefined,
      updated_at: new Date().toISOString()
    }).eq('id', id)
    setSaving(false)
    setSelected(null)
    setResponseNotes('')
    load()
  }

  const counts = {
    all: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    processing: requests.filter(r => r.status === 'processing').length,
    approved: requests.filter(r => r.status === 'approved').length,
  }

  return (
    <div>
      <div className="page-header">
        <h2>📬 Demandes Externes</h2>
        <a href="/portal" target="_blank" className="btn-ghost" style={{ textDecoration: 'none', fontSize: '0.875rem' }}>
          🌐 Voir le portail public →
        </a>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Stats */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { key: 'all', label: 'Toutes', icon: '📬' },
            { key: 'pending', label: 'En attente', icon: '⏳' },
            { key: 'processing', label: 'En cours', icon: '⚙️' },
            { key: 'approved', label: 'Approuvées', icon: '✅' },
            { key: 'rejected', label: 'Rejetées', icon: '❌' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{ padding: '10px 16px', borderRadius: 10, border: '1.5px solid', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', transition: 'all 0.15s',
                borderColor: filter === f.key ? 'var(--hub-green-mid)' : '#ddd',
                background: filter === f.key ? 'var(--hub-green-mid)' : 'white',
                color: filter === f.key ? 'white' : '#666' }}>
              {f.icon} {f.label}
            </button>
          ))}
        </div>

        {/* Requests grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Chargement...</div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {requests.map(r => (
              <div key={r.id} style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      <span className={`badge ${statusBadge[r.status as keyof typeof statusBadge]}`}>
                        {statusLabels[r.status as keyof typeof statusLabels]}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#999' }}>
                        {new Date(r.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#aaa', fontFamily: 'monospace' }}>#{r.id.slice(-8).toUpperCase()}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Demandeur</div>
                        <div style={{ fontWeight: 700, color: 'var(--hub-green)' }}>{r.requester_name}</div>
                        <div style={{ fontSize: '0.8rem', color: '#666' }}>{r.organization}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Contact</div>
                        <div style={{ fontSize: '0.875rem' }}>{r.email}</div>
                        {r.phone && <div style={{ fontSize: '0.8rem', color: '#666' }}>{r.phone}</div>}
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Document demandé</div>
                        <div style={{ fontWeight: 600, color: 'var(--hub-green-mid)' }}>📋 {r.document_type}</div>
                      </div>
                    </div>
                    {r.description && (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: '#f8f5ee', borderRadius: 8, fontSize: '0.8rem', color: '#555' }}>
                        💬 {r.description}
                      </div>
                    )}
                    {r.response_notes && (
                      <div style={{ marginTop: 8, padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, fontSize: '0.8rem', color: '#065f46', border: '1px solid #a7f3d0' }}>
                        ✅ Réponse: {r.response_notes}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginLeft: 20 }}>
                    {r.status === 'pending' && (
                      <>
                        <button className="btn-primary" style={{ padding: '8px 14px', fontSize: '0.8rem' }}
                          onClick={() => { setSelected(r); setResponseNotes('') }}>
                          Traiter →
                        </button>
                      </>
                    )}
                    {r.status === 'processing' && (
                      <button className="btn-amber" style={{ padding: '8px 14px', fontSize: '0.8rem' }}
                        onClick={() => { setSelected(r); setResponseNotes(r.response_notes || '') }}>
                        Finaliser
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {requests.length === 0 && (
              <div style={{ textAlign: 'center', padding: 60, color: '#999', background: 'white', borderRadius: 12, border: '1px solid #e8e4db' }}>
                Aucune demande{filter !== 'all' ? ` avec le statut "${statusLabels[filter as keyof typeof statusLabels]}"` : ''}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal traitement */}
      {selected && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setSelected(null)}>
          <div className="modal-box">
            <div className="modal-title">⚙️ Traiter la demande</div>
            <div style={{ background: '#f8f5ee', borderRadius: 8, padding: '14px 16px', marginBottom: 20 }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)' }}>{selected.requester_name}</div>
              <div style={{ fontSize: '0.8rem', color: '#666' }}>{selected.organization}</div>
              <div style={{ fontWeight: 600, color: 'var(--hub-green-mid)', marginTop: 8 }}>📋 {selected.document_type}</div>
              {selected.description && <div style={{ fontSize: '0.8rem', color: '#555', marginTop: 6 }}>{selected.description}</div>}
            </div>
            <div className="hub-form-group">
              <label>Notes de réponse</label>
              <textarea className="hub-input" value={responseNotes} onChange={e => setResponseNotes(e.target.value)}
                rows={3} style={{ resize: 'vertical' }} placeholder="Message pour le demandeur, référence du document fourni..." />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn-ghost" onClick={() => setSelected(null)}>Annuler</button>
              {selected.status === 'pending' && (
                <button className="btn-ghost" style={{ borderColor: '#3b82f6', color: '#3b82f6' }} disabled={saving}
                  onClick={() => updateStatus(selected.id, 'processing')}>
                  ⚙️ Mettre en cours
                </button>
              )}
              <button className="btn-danger" style={{ background: '#fee2e2', color: '#dc2626' }} disabled={saving}
                onClick={() => updateStatus(selected.id, 'rejected')}>
                ❌ Rejeter
              </button>
              <button className="btn-primary" disabled={saving} onClick={() => updateStatus(selected.id, 'approved')}>
                {saving ? '...' : '✅ Approuver & Clôturer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
