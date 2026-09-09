'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { summarizeWarehouses, type WarehouseSummary } from '@/lib/stock/warehouses'

type WarehouseRow = {
  id: string
  name: string
  code: string
  location: string | null
  is_cold: boolean
  notes: string | null
  created_at?: string
}

type BatchRow = {
  id: string
  warehouse_id: string | null
  quantity: number
}

const emptyForm = { name: '', code: '', location: '', is_cold: false, notes: '' }

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([])
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<WarehouseRow | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: w }, { data: b }] = await Promise.all([
      supabase.from('warehouses').select('*').order('name'),
      supabase.from('product_batches').select('id, warehouse_id, quantity'),
    ])
    setWarehouses((w as WarehouseRow[]) || [])
    setBatches((b as BatchRow[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const defaultWh = warehouses.find(w => w.code.toUpperCase() === 'PRINCIPAL') || warehouses[0]
  const summary: WarehouseSummary[] = summarizeWarehouses(
    warehouses.map(w => ({ id: w.id, name: w.name, code: w.code, location: w.location, is_cold: w.is_cold, notes: w.notes })),
    batches.map(b => ({ id: b.id, product_id: '', batch_number: '', quantity: b.quantity, warehouse_id: b.warehouse_id })),
    defaultWh?.id,
  )

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  function openEdit(w: WarehouseRow) {
    setEditing(w)
    setForm({ name: w.name, code: w.code, location: w.location || '', is_cold: Boolean(w.is_cold), notes: w.notes || '' })
    setError('')
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const code = form.code.trim().toUpperCase()
    if (!code) {
      setError('Le code de l\u2019entrepôt est obligatoire.')
      setSaving(false)
      return
    }
    const duplicate = warehouses.some(w =>
      w.code.toUpperCase() === code && w.id !== editing?.id,
    )
    if (duplicate) {
      setError(`Un entrepôt porte déjà le code « ${code} ».`)
      setSaving(false)
      return
    }
    const payload = {
      name: form.name.trim(),
      code,
      location: form.location.trim() || null,
      is_cold: form.is_cold,
      notes: form.notes.trim() || null,
    }
    const { error: err } = editing
      ? await supabase.from('warehouses').update(payload).eq('id', editing.id)
      : await supabase.from('warehouses').insert(payload)
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowModal(false)
    load()
  }

  async function handleDelete(w: WarehouseRow, count: number) {
    if (count > 0) return // bouton désactivé — filet de sécurité
    if (!confirm(`Supprimer définitivement l\u2019entrepôt « ${w.name} » ?`)) return
    setError('')
    const { error: err } = await supabase.from('warehouses').delete().eq('id', w.id)
    if (err) { setError(err.message); return }
    setNotice(`Entrepôt « ${w.name} » supprimé.`)
    load()
  }

  return (
    <div>
      <div className="page-header">
        <h2>🏭 Entrepôts (multi-entrepôt)</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/stock" className="btn-ghost" style={{ textDecoration: 'none' }}>← Stock</Link>
          <button className="btn-primary" onClick={openNew}>+ Nouvel entrepôt</button>
        </div>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {(error || notice) && (
          <div style={{ marginBottom: 16 }}>
            {error && <div className="alert alert-error">⚠️ {error}</div>}
            {notice && <div className="alert alert-success">✅ {notice}</div>}
          </div>
        )}

        {!loading && summary.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {summary.map(s => (
              <div key={s.id} style={{ background: 'white', borderRadius: 10, border: '1px solid #e8e4db', padding: '12px 16px', minWidth: 180 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                  {s.is_cold ? '❄️ ' : '📦 '}{s.name}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#999', fontFamily: 'monospace', marginTop: 2 }}>{s.code}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 14, fontSize: '0.8rem' }}>
                  <span><strong>{s.batch_count}</strong> lot(s)</span>
                  <span><strong>{Number(s.stock_quantity).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</strong> u.</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Chargement...</div>
          ) : (
            <table className="hub-table">
              <thead>
                <tr><th>Entrepôt</th><th>Code</th><th>Emplacement</th><th>Lots rattachés</th><th>Stock (toutes unités)</th><th>Notes</th><th></th></tr>
              </thead>
              <tbody>
                {warehouses.map(w => {
                  const count = batches.filter(b => (b.warehouse_id || defaultWh?.id) === w.id).length
                  const stock = batches
                    .filter(b => (b.warehouse_id || defaultWh?.id) === w.id)
                    .reduce((sum, b) => sum + (Number(b.quantity) || 0), 0)
                  return (
                    <tr key={w.id}>
                      <td>
                        <strong>{w.is_cold ? '❄️ ' : '📦 '}{w.name}</strong>
                        {w.is_cold && <span className="badge badge-blue" style={{ marginLeft: 8 }}>Chambre froide</span>}
                        {w.code.toUpperCase() === 'PRINCIPAL' && <span className="badge badge-green" style={{ marginLeft: 8 }}>Défaut</span>}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#555' }}>{w.code}</td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{w.location || '—'}</td>
                      <td>
                        {count > 0
                          ? <span className="badge badge-amber">{count} lot(s)</span>
                          : <span className="badge badge-gray">Aucun</span>}
                      </td>
                      <td style={{ fontWeight: 600 }}>{stock > 0 ? `${stock.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}` : '—'}</td>
                      <td style={{ color: '#666', fontSize: '0.8rem', maxWidth: 220 }}>{w.notes || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} title="Modifier"
                            onClick={() => openEdit(w)}>✏️</button>
                          <button
                            className="btn-danger"
                            style={{ padding: '5px 10px', fontSize: '0.75rem', opacity: count > 0 ? 0.5 : 1, cursor: count > 0 ? 'not-allowed' : 'pointer' }}
                            title={count > 0 ? `Impossible : ${count} lot(s) sont stockés dans cet entrepôt. Transférez-les d'abord.` : 'Supprimer'}
                            disabled={count > 0}
                            onClick={() => handleDelete(w, count)}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {warehouses.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                    Aucun entrepôt — créez votre premier entrepôt (ex. « Entrepôt Principal », code PRINCIPAL).
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="alert alert-warning" style={{ marginTop: 16 }}>
          📌 Un entrepôt contenant des lots ne peut pas être supprimé : transférez d&apos;abord ses lots vers un autre entrepôt
          (bouton « ⇄ Transfert » de la page Stock). Les mouvements IN/OUT enregistrent l&apos;entrepôt concerné.
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box">
            <div className="modal-title">{editing ? `✏️ Modifier — ${editing.name}` : '➕ Nouvel entrepôt'}</div>
            <form onSubmit={handleSave}>
              {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>⚠️ {error}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Nom de l&apos;entrepôt *</label>
                  <input className="hub-input" required value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Entrepôt Principal, Chambre froide…" />
                </div>
                <div className="hub-form-group">
                  <label>Code * (unique)</label>
                  <input className="hub-input" required value={form.code}
                    onChange={e => setForm({ ...form, code: e.target.value })}
                    placeholder="PRINCIPAL, COLD-1…" style={{ textTransform: 'uppercase' }} />
                </div>
                <div className="hub-form-group">
                  <label>Emplacement</label>
                  <input className="hub-input" value={form.location}
                    onChange={e => setForm({ ...form, location: e.target.value })}
                    placeholder="Zone industrielle, Brazzaville…" />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', cursor: 'pointer', fontSize: '0.875rem' }}>
                <input type="checkbox" checked={form.is_cold}
                  onChange={e => setForm({ ...form, is_cold: e.target.checked })} />
                ❄️ Chambre froide (stockage réfrigéré / température dirigée)
              </label>
              <div className="hub-form-group">
                <label>Notes</label>
                <textarea className="hub-input" rows={2} value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Observations…" />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? '...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
