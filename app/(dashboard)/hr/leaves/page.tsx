'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Employee } from '@/types'
import { useToast } from '@/components/ui/Toast'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft:    { label: 'Brouillon',  badge: 'badge-gray',  icon: '✏️' },
  pending:  { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Approuve',   badge: 'badge-green', icon: '✅' },
  rejected: { label: 'Refuse',     badge: 'badge-red',   icon: '❌' },
}

const leaveTypes: Record<string, string> = {
  annuel: 'Conge annuel', maladie: 'Conge maladie', sans_solde: 'Sans solde', exceptionnel: 'Conge exceptionnel', maternite: 'Maternite/Paternite',
}

function workingDays(start: string, end: string): number {
  if (!start || !end) return 0
  let count = 0
  const d = new Date(start)
  const e = new Date(end)
  while (d <= e) { const dow = d.getDay(); if (dow !== 0 && dow !== 6) count++; d.setDate(d.getDate() + 1) }
  return count
}

export default function LeavesPage() {
  const [leaves, setLeaves] = useState<any[]>([])
  const [balances, setBalances] = useState<any[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [tab, setTab] = useState<'requests' | 'balances'>('requests')
  const [form, setForm] = useState({
    employee_id: '', leave_type: 'annuel', start_date: '', end_date: '', reason: '',
  })
  const supabase = createClient()
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: l }, { data: b }, { data: e }] = await Promise.all([
      supabase.from('employee_documents').select('*, employee:employees(id,full_name,position,department)')
        .eq('type', 'conge').order('created_at', { ascending: false }),
      supabase.from('leave_balances').select('*, employee:employees(id,full_name,department)').order('year', { ascending: false }),
      supabase.from('employees').select('*').eq('status', 'actif').order('full_name'),
    ])
    setLeaves(l || []); setBalances(b || []); setEmployees(e || []); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.employee_id || !form.start_date || !form.end_date) { toast('warning', 'Remplissez tous les champs obligatoires.'); return }
    setSaving(true)
    const emp = employees.find(em => em.id === form.employee_id)
    const days = workingDays(form.start_date, form.end_date)
    const { data: newLeave } = await supabase.from('employee_documents').insert({
      employee_id: form.employee_id, type: 'conge', status: 'pending',
      title: `${leaveTypes[form.leave_type] || form.leave_type} — ${emp?.full_name || ''} (${days}j)`,
      issued_date: new Date().toISOString().split('T')[0],
      start_date: form.start_date, end_date: form.end_date,
      content: { leave_type: form.leave_type, reason: form.reason, days },
    }).select('id').single()

    if (newLeave) {
      try {
        await fetch('/api/notifications/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'leave_pending',
            title: `Demande de conge — ${emp?.full_name || ''}`,
            message: `${leaveTypes[form.leave_type] || form.leave_type} du ${form.start_date} au ${form.end_date} (${days} jours)`,
            referenceId: newLeave.id,
            referenceType: 'leave',
            link: '/hr/leaves',
          }),
        })
      } catch { /* best-effort */ }
    }

    setSaving(false); setShowModal(false); load()
  }

  async function updateStatus(docId: string, status: 'approved' | 'rejected') {
    const { data: userData } = await supabase.auth.getUser()
    await supabase.from('employee_documents').update({
      status, approved_by: userData.user?.id, approved_at: new Date().toISOString(),
    }).eq('id', docId)
    load()
  }

  const pendingCount = leaves.filter(l => l.status === 'pending').length
  const approvedThisMonth = leaves.filter(l => {
    if (l.status !== 'approved') return false
    const d = new Date(l.approved_at || l.created_at)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length
  const currentYear = new Date().getFullYear()
  const lowBalances = balances.filter(b => b.year === currentYear && b.remaining_days <= 5)

  const filteredLeaves = leaves.filter(l => statusFilter === 'all' || l.status === statusFilter)

  const formDays = workingDays(form.start_date, form.end_date)

  return (
    <div className="invoice-page">
      <div className="page-header">
        <h2>🏖 Gestion des conges</h2>
        <button className="btn-primary" onClick={() => { setForm({ employee_id: '', leave_type: 'annuel', start_date: '', end_date: '', reason: '' }); setShowModal(true) }}>+ Nouvelle demande</button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 14, marginBottom: 24 }}>
          <div className="stat-card amber"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⏳</div><div className="stat-value">{pendingCount}</div><div className="stat-label">En attente</div></div>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✅</div><div className="stat-value">{approvedThisMonth}</div><div className="stat-label">Approuves ce mois</div></div>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>📊</div><div className="stat-value">{leaves.length}</div><div className="stat-label">Total demandes</div></div>
          {lowBalances.length > 0 && <div className="stat-card amber"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⚠️</div><div className="stat-value">{lowBalances.length}</div><div className="stat-label">Soldes faibles</div></div>}
        </div>

        {/* Onglets */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: '#f0ece4', borderRadius: 8, padding: 4, width: 'fit-content' }}>
          {[{ k: 'requests', l: `📋 Demandes (${leaves.length})` }, { k: 'balances', l: `📊 Soldes conges` }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k as any)} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
              background: tab === t.k ? 'white' : 'transparent', color: tab === t.k ? 'var(--hub-green)' : '#666', boxShadow: tab === t.k ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
              {t.l}
            </button>
          ))}
        </div>

        {tab === 'requests' && (
          <>
            <div style={{ display: 'flex', gap: 0, background: '#f0ece4', borderRadius: 8, padding: 3, marginBottom: 16, width: 'fit-content' }}>
              {[{ key: 'all', label: 'Tous' }, { key: 'pending', label: '⏳ En attente' }, { key: 'approved', label: '✅ Approuve' }, { key: 'rejected', label: '❌ Refuse' }].map(f => (
                <button key={f.key} type="button" onClick={() => setStatusFilter(f.key)}
                  style={{ padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
                    background: statusFilter === f.key ? 'white' : 'transparent', color: statusFilter === f.key ? 'var(--hub-green)' : '#666',
                    boxShadow: statusFilter === f.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
                  {f.label}
                </button>
              ))}
            </div>

            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
                <table className="hub-table">
                  <thead><tr><th>Employe</th><th>Type</th><th>Du</th><th>Au</th><th>Jours</th><th>Motif</th><th>Statut</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredLeaves.map(l => {
                      const cfg = statusConfig[l.status] || statusConfig.draft
                      const c = l.content || {}
                      const days = (c as any).days || workingDays(l.start_date, l.end_date)
                      return (
                        <tr key={l.id}>
                          <td><strong>{l.employee?.full_name || '—'}</strong><div style={{ fontSize: '0.72rem', color: '#999' }}>{l.employee?.department}</div></td>
                          <td><span className="badge badge-blue">{leaveTypes[(c as any).leave_type] || (c as any).leave_type || '—'}</span></td>
                          <td style={{ fontSize: '0.85rem', color: '#666' }}>{l.start_date ? new Date(l.start_date).toLocaleDateString('fr-FR') : '—'}</td>
                          <td style={{ fontSize: '0.85rem', color: '#666' }}>{l.end_date ? new Date(l.end_date).toLocaleDateString('fr-FR') : '—'}</td>
                          <td style={{ fontWeight: 700, textAlign: 'center' }}>{days}j</td>
                          <td style={{ color: '#555', fontSize: '0.85rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(c as any).reason || '—'}</td>
                          <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {l.status === 'pending' && (
                                <>
                                  <button className="btn-primary" style={{ padding: '5px 10px', fontSize: '0.72rem' }} onClick={() => { if (confirm('Approuver cette demande ?')) updateStatus(l.id, 'approved') }}>✅</button>
                                  <button className="btn-danger" style={{ padding: '5px 10px', fontSize: '0.72rem' }} onClick={() => { if (confirm('Refuser cette demande ?')) updateStatus(l.id, 'rejected') }}>❌</button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {filteredLeaves.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucune demande</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {tab === 'balances' && (
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <table className="hub-table">
              <thead><tr><th>Employe</th><th>Departement</th><th>Annee</th><th>Total</th><th>Utilises</th><th>Restant</th><th>Statut</th></tr></thead>
              <tbody>
                {balances.filter(b => b.year === currentYear).map(b => {
                  const pct = Math.round((b.remaining_days / b.total_days) * 100)
                  const isLow = b.remaining_days <= 5
                  return (
                    <tr key={b.id}>
                      <td><strong>{b.employee?.full_name || '—'}</strong></td>
                      <td><span className="badge badge-gray">{b.employee?.department || '—'}</span></td>
                      <td>{b.year}</td>
                      <td style={{ fontWeight: 600 }}>{b.total_days}j</td>
                      <td style={{ color: '#dc2626', fontWeight: 600 }}>{b.used_days}j</td>
                      <td>
                        <div style={{ fontWeight: 700, color: isLow ? '#dc2626' : '#065f46' }}>{b.remaining_days}j</div>
                        <div className="progress-bar" style={{ marginTop: 4, width: 80 }}>
                          <div className={`progress-fill ${isLow ? 'red' : 'green'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td>{isLow ? <span className="badge badge-red">⚠️ Faible</span> : <span className="badge badge-green">OK</span>}</td>
                    </tr>
                  )
                })}
                {balances.filter(b => b.year === currentYear).length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun solde enregistre pour {currentYear}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <div className="modal-title">🏖 Nouvelle demande de conge</div>
            <form onSubmit={handleSave}>
              <div className="hub-form-group"><label>Employe *</label>
                <select className="hub-select" required value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">-- Selectionner --</option>
                  {employees.map(em => <option key={em.id} value={em.id}>{em.full_name} — {em.position}</option>)}
                </select>
              </div>
              <div className="hub-form-group"><label>Type de conge</label>
                <select className="hub-select" value={form.leave_type} onChange={e => setForm(f => ({ ...f, leave_type: e.target.value }))}>
                  {Object.entries(leaveTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group"><label>Date debut *</label>
                  <input className="hub-input" type="date" required value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div className="hub-form-group"><label>Date fin *</label>
                  <input className="hub-input" type="date" required value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                </div>
              </div>
              {formDays > 0 && (
                <div style={{ padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', fontSize: '0.875rem', marginBottom: 12 }}>
                  📅 Duree: <strong>{formDays} jour(s) ouvre(s)</strong>
                </div>
              )}
              <div className="hub-form-group"><label>Motif</label>
                <textarea className="hub-input" rows={2} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Raison de la demande..." style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? '...' : 'Soumettre la demande'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
