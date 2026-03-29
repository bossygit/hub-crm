'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Client, ClientType } from '@/types'

const typeLabels: Record<ClientType, string> = {
  client: 'Client',
  fournisseur: 'Fournisseur',
  institution: 'Institution',
}

const typeBadge: Record<ClientType, string> = {
  client: 'badge-blue',
  fournisseur: 'badge-green',
  institution: 'badge-amber',
}

const emptyForm = { name: '', type: 'client' as ClientType, email: '', phone: '', address: '', notes: '' }

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
    setClients(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew() { setEditing(null); setForm(emptyForm); setShowModal(true) }
  function openEdit(c: Client) {
    setEditing(c)
    setForm({ name: c.name, type: c.type, email: c.email || '', phone: c.phone || '', address: c.address || '', notes: c.notes || '' })
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    if (editing) {
      await supabase.from('clients').update({ ...form, updated_at: new Date().toISOString() }).eq('id', editing.id)
    } else {
      await supabase.from('clients').insert(form)
    }
    setSaving(false); setShowModal(false); load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer ce contact ?')) return
    await supabase.from('clients').delete().eq('id', id)
    load()
  }

  const filtered = clients.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || c.type === filter
    return matchSearch && matchFilter
  })

  return (
    <div>
      <div className="page-header">
        <h2>👥 Clients & Partenaires</h2>
        <button className="btn-primary" onClick={openNew}>+ Nouveau contact</button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <input className="hub-input" style={{ maxWidth: 280 }} placeholder="🔍 Rechercher..."
            value={search} onChange={e => setSearch(e.target.value)} />
          {['all', 'client', 'fournisseur', 'institution'].map(t => (
            <button key={t} onClick={() => setFilter(t)}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1.5px solid', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                borderColor: filter === t ? 'var(--hub-green-mid)' : '#ddd',
                background: filter === t ? 'var(--hub-green-mid)' : 'white',
                color: filter === t ? 'white' : '#666' }}>
              {t === 'all' ? 'Tous' : typeLabels[t as ClientType]}
            </button>
          ))}
        </div>

        {/* Stats mini */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {(['client', 'fournisseur', 'institution'] as ClientType[]).map(t => (
            <div key={t} style={{ background: 'white', padding: '10px 16px', borderRadius: 8, border: '1px solid #e8e4db', fontSize: '0.8rem' }}>
              <strong>{clients.filter(c => c.type === t).length}</strong> {typeLabels[t]}s
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Chargement...</div>
          ) : (
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Type</th>
                  <th>Email</th>
                  <th>Téléphone</th>
                  <th>Adresse</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td><span className={`badge ${typeBadge[c.type]}`}>{typeLabels[c.type]}</span></td>
                    <td style={{ color: '#666' }}>{c.email || '—'}</td>
                    <td style={{ color: '#666' }}>{c.phone || '—'}</td>
                    <td style={{ color: '#666', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.address || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => openEdit(c)}>✏️ Éditer</button>
                        <button className="btn-danger" onClick={() => handleDelete(c.id)}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#999' }}>Aucun résultat</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box">
            <div className="modal-title">{editing ? '✏️ Modifier le contact' : '➕ Nouveau contact'}</div>
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Nom / Raison sociale *</label>
                  <input className="hub-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required placeholder="Ex: Coopérative du Pool" />
                </div>
                <div className="hub-form-group">
                  <label>Type *</label>
                  <select className="hub-select" value={form.type} onChange={e => setForm({...form, type: e.target.value as ClientType})}>
                    <option value="client">Client</option>
                    <option value="fournisseur">Fournisseur</option>
                    <option value="institution">Institution</option>
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Téléphone</label>
                  <input className="hub-input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="+242 06 ..." />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Email</label>
                  <input className="hub-input" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="contact@entreprise.cg" />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Adresse</label>
                  <input className="hub-input" value={form.address} onChange={e => setForm({...form, address: e.target.value})} placeholder="Brazzaville, Congo" />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Notes</label>
                  <textarea className="hub-input" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={3} placeholder="Informations complémentaires..." style={{ resize: 'vertical' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
