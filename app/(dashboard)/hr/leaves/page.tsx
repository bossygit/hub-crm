'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Employee } from '@/types'
import { useToast } from '@/components/ui/Toast'
import {
  LEAVE_TYPE_LIST,
  MONTH_NAMES,
  WEEKDAY_SHORT,
  balanceIsLow,
  buildMonthCalendar,
  findOverlappingLeave,
  leaveConsumesBalance,
  leaveTypeLabel,
  leaveTypeShort,
  leaveYearOf,
  overloadedDays,
  workingDays,
} from '@/lib/hr/leaves'
import { EMPLOYEE_ACTIVE_STATUSES } from '@/lib/hr/employees'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray', icon: '✏️' },
  pending: { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Approuve', badge: 'badge-green', icon: '✅' },
  rejected: { label: 'Refuse', badge: 'badge-red', icon: '❌' },
}

/** Seuil à partir duquel un jour est signalé « équipe réduite ». */
const DEFAULT_OVERLOAD_THRESHOLD = 2

type Tab = 'requests' | 'balances' | 'calendar'

export default function LeavesPage() {
  const [leaves, setLeaves] = useState<any[]>([])
  const [balances, setBalances] = useState<any[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [tab, setTab] = useState<Tab>('requests')
  const [editing, setEditing] = useState<any>(null)
  const emptyForm = { employee_id: '', leave_type: 'annuel', start_date: '', end_date: '', reason: '' }
  const [form, setForm] = useState(emptyForm)
  const supabase = createClient()
  const { toast } = useToast()

  const now = new Date()
  const currentYear = now.getFullYear()

  // Calendrier d'équipe
  const [calYear, setCalYear] = useState(currentYear)
  const [calMonth, setCalMonth] = useState(now.getMonth())
  const [overloadThreshold, setOverloadThreshold] = useState(DEFAULT_OVERLOAD_THRESHOLD)

  // Droit annuel / soldes
  const [showBalanceModal, setShowBalanceModal] = useState(false)
  const [balanceForm, setBalanceForm] = useState({ id: '', year: currentYear, total_days: 30 })
  const [savingBalance, setSavingBalance] = useState(false)
  const [initializing, setInitializing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [leavesRes, balRes, empRes] = await Promise.all([
      supabase.from('employee_documents').select('*, employee:employees(id,full_name,position,department)')
        .eq('type', 'conge').order('created_at', { ascending: false }),
      supabase.from('leave_balances').select('*, employee:employees(id,full_name,department)').order('year', { ascending: false }),
      supabase.from('employees').select('*').in('status', EMPLOYEE_ACTIVE_STATUSES).order('full_name'),
    ])
    if (leavesRes.error || balRes.error || empRes.error) toast('error', 'Erreur de chargement des congés.')
    setLeaves(leavesRes.data || []); setBalances(balRes.data || []); setEmployees(empRes.data || []); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openEdit(doc: any) {
    const c = doc.content || {}
    setEditing(doc)
    setForm({
      employee_id: doc.employee_id || '',
      leave_type: c.leave_type || 'annuel',
      start_date: doc.start_date || '',
      end_date: doc.end_date || '',
      reason: c.reason || '',
    })
    setShowModal(true)
  }

  // Chevauchement avec une autre demande en attente ou approuvée.
  const formOverlap = useMemo(
    () => findOverlappingLeave(leaves, form.start_date, form.end_date, { ignoreId: editing?.id }),
    [leaves, form.start_date, form.end_date, editing],
  )

  const formDays = workingDays(form.start_date, form.end_date)
  const formYear = leaveYearOf(form.start_date, currentYear)
  const formConsumes = leaveConsumesBalance(form.leave_type)
  const formBalance = balances.find(b => b.employee_id === form.employee_id && b.year === formYear)

  // Jours déjà décomptés par la demande en cours d'édition (pour ne pas la
  // compter deux fois lors de la vérification du solde).
  const editingConsumedDays = useMemo(() => {
    if (!editing || editing.status !== 'approved') return 0
    if (!leaveConsumesBalance((editing.content || {}).leave_type)) return 0
    const stored = Number((editing.content || {}).days)
    return Number.isFinite(stored) && stored > 0 ? stored : workingDays(editing.start_date, editing.end_date)
  }, [editing])

  const formBalanceAvailable = formBalance
    ? Number(formBalance.remaining_days || 0) + editingConsumedDays
    : null
  const formBalanceShort =
    formConsumes && formBalanceAvailable != null && formDays > formBalanceAvailable

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.employee_id || !form.start_date || !form.end_date) { toast('warning', 'Remplissez tous les champs obligatoires.'); return }
    if (formDays <= 0) { toast('warning', 'La date de fin doit être postérieure ou égale à la date de début.'); return }
    if (formOverlap) {
      toast('warning', `Chevauchement avec « ${formOverlap.title} » (${formOverlap.start_date} → ${formOverlap.end_date}).`)
      return
    }
    if (formBalanceShort) {
      toast('warning', `Solde ${formYear} insuffisant : ${formBalanceAvailable}j disponibles pour ${formDays}j demandés.`)
      return
    }

    setSaving(true)
    const emp = employees.find(em => em.id === form.employee_id)
    const days = formDays

    if (editing) {
      const payload = {
        employee_id: form.employee_id,
        title: `${leaveTypeLabel(form.leave_type)} — ${emp?.full_name || ''} (${days}j)`,
        start_date: form.start_date, end_date: form.end_date,
        content: { ...(editing.content || {}), leave_type: form.leave_type, reason: form.reason, days },
      }
      const { error } = await supabase.from('employee_documents').update(payload).eq('id', editing.id)
      if (error) toast('error', `Erreur : ${error.message}`)
      else toast('success', 'Demande mise à jour.')
    } else {
      const { data: userData } = await supabase.auth.getUser()
      const { data: newLeave, error } = await supabase.from('employee_documents').insert({
        employee_id: form.employee_id, type: 'conge', status: 'pending',
        title: `${leaveTypeLabel(form.leave_type)} — ${emp?.full_name || ''} (${days}j)`,
        issued_date: new Date().toISOString().split('T')[0],
        start_date: form.start_date, end_date: form.end_date,
        content: { leave_type: form.leave_type, reason: form.reason, days },
        created_by: userData.user?.id || null,
      }).select('id').single()

      if (error) toast('error', `Erreur : ${error.message}`)
      else {
        toast('success', 'Demande soumise.')
        if (newLeave) {
          try {
            await fetch('/api/notifications/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'leave_pending',
                title: `Demande de conge — ${emp?.full_name || ''}`,
                message: `${leaveTypeLabel(form.leave_type)} du ${form.start_date} au ${form.end_date} (${days} jours)`,
                referenceId: newLeave.id,
                referenceType: 'leave',
                link: '/hr/leaves',
              }),
            })
          } catch { /* best-effort */ }
        }
      }
    }

    setSaving(false); setShowModal(false); setEditing(null); load()
  }

  async function handleDelete(docId: string) {
    if (!confirm('Supprimer définitivement cette demande de congé ? Le solde sera automatiquement recalculé.')) return
    const { error } = await supabase.from('employee_documents').delete().eq('id', docId)
    if (error) toast('error', `Erreur : ${error.message}`)
    else { toast('success', 'Demande supprimée.'); load() }
  }

  async function updateStatus(docId: string, status: 'approved' | 'rejected') {
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('employee_documents').update({
      status, approved_by: userData.user?.id, approved_at: new Date().toISOString(),
    }).eq('id', docId)
    if (error) { toast('error', `Erreur : ${error.message}`); return }
    toast('success', status === 'approved' ? 'Demande approuvée.' : 'Demande refusée.')
    load()
  }

  function openBalanceModal(balance: any) {
    setBalanceForm({ id: balance.id, year: balance.year, total_days: balance.total_days })
    setShowBalanceModal(true)
  }

  async function saveBalance(e: React.FormEvent) {
    e.preventDefault()
    setSavingBalance(true)
    const { error } = await supabase.from('leave_balances')
      .update({ total_days: Math.max(0, Number(balanceForm.total_days) || 0) })
      .eq('id', balanceForm.id)
    setSavingBalance(false)
    if (error) { toast('error', `Erreur : ${error.message}`); return }
    toast('success', 'Droit annuel mis à jour.')
    setShowBalanceModal(false); load()
  }

  async function initializeBalances() {
    if (!confirm(`Créer le solde ${currentYear} (30 jours par défaut) pour tous les employés actifs qui n'en ont pas ?`)) return
    setInitializing(true)
    const { data, error } = await supabase.rpc('hr_ensure_leave_balances', { p_year: currentYear, p_total_days: 30 })
    setInitializing(false)
    if (error) { toast('error', `Erreur : ${error.message}`); return }
    toast('success', `${Number(data) || 0} solde(s) initialisé(s) pour ${currentYear}.`)
    load()
  }

  const pendingCount = leaves.filter(l => l.status === 'pending').length
  const approvedThisMonth = leaves.filter(l => {
    if (l.status !== 'approved') return false
    const d = new Date(l.approved_at || l.created_at)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length
  const lowBalances = balances.filter(b => b.year === currentYear && balanceIsLow(b.remaining_days))

  const filteredLeaves = leaves.filter(l => statusFilter === 'all' || l.status === statusFilter)

  // ── Calendrier ────────────────────────────────────────────────────
  const calendarLeaves = useMemo(() => leaves.map(l => ({
    id: l.id,
    employee_id: l.employee_id,
    employee_name: l.employee?.full_name || '—',
    department: l.employee?.department,
    leave_type: (l.content || {}).leave_type,
    status: l.status,
    start_date: l.start_date,
    end_date: l.end_date,
  })), [leaves])

  const calendarWeeks = useMemo(
    () => buildMonthCalendar(calYear, calMonth, calendarLeaves),
    [calYear, calMonth, calendarLeaves],
  )
  const calendarOverloads = useMemo(
    () => overloadedDays(calendarWeeks, overloadThreshold),
    [calendarWeeks, overloadThreshold],
  )
  const calendarOnLeave = useMemo(() => {
    const ids = new Set<string>()
    for (const day of calendarWeeks.flat()) {
      if (day.inMonth) for (const leave of day.leaves) ids.add(leave.employeeId)
    }
    return ids.size
  }, [calendarWeeks])

  function shiftMonth(delta: number) {
    const d = new Date(calYear, calMonth + delta, 1)
    setCalYear(d.getFullYear())
    setCalMonth(d.getMonth())
  }

  return (
    <div className="invoice-page">
      <div className="page-header">
        <h2>🏖 Gestion des conges</h2>
        <button className="btn-primary" onClick={() => { setEditing(null); setForm(emptyForm); setShowModal(true) }}>+ Nouvelle demande</button>
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
          {[
            { k: 'requests', l: `📋 Demandes (${leaves.length})` },
            { k: 'balances', l: `📊 Soldes conges` },
            { k: 'calendar', l: `📅 Calendrier equipe` },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k as Tab)} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
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
                      const days = c.days || workingDays(l.start_date, l.end_date)
                      const consumes = leaveConsumesBalance(c.leave_type)
                      return (
                        <tr key={l.id}>
                          <td><strong>{l.employee?.full_name || '—'}</strong><div style={{ fontSize: '0.72rem', color: '#999' }}>{l.employee?.department}</div></td>
                          <td>
                            <span className="badge badge-blue">{leaveTypeLabel(c.leave_type)}</span>
                            {!consumes && <div style={{ fontSize: '0.65rem', color: '#999', marginTop: 3 }}>hors solde</div>}
                          </td>
                          <td style={{ fontSize: '0.85rem', color: '#666' }}>{l.start_date ? new Date(l.start_date).toLocaleDateString('fr-FR') : '—'}</td>
                          <td style={{ fontSize: '0.85rem', color: '#666' }}>{l.end_date ? new Date(l.end_date).toLocaleDateString('fr-FR') : '—'}</td>
                          <td style={{ fontWeight: 700, textAlign: 'center' }}>{days}j</td>
                          <td style={{ color: '#555', fontSize: '0.85rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.reason || '—'}</td>
                          <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {l.status === 'pending' && (
                                <>
                                  <button className="btn-primary" style={{ padding: '5px 10px', fontSize: '0.72rem' }} onClick={() => { if (confirm('Approuver cette demande ?')) updateStatus(l.id, 'approved') }}>✅</button>
                                  <button className="btn-danger" style={{ padding: '5px 10px', fontSize: '0.72rem' }} onClick={() => { if (confirm('Refuser cette demande ?')) updateStatus(l.id, 'rejected') }}>❌</button>
                                  <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.72rem' }} onClick={() => openEdit(l)}>✏️</button>
                                  <button className="btn-danger" style={{ padding: '5px 10px', fontSize: '0.72rem' }} onClick={() => handleDelete(l.id)}>🗑️</button>
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
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
              <div style={{ fontSize: '0.8rem', color: '#888' }}>
                Seul le <strong>congé annuel</strong> débite le solde. Maladie, sans solde, maternité et exceptionnel sont suivis <strong>hors solde</strong>.
              </div>
              <button className="btn-ghost" onClick={initializeBalances} disabled={initializing}>
                {initializing ? '...' : `➕ Initialiser les soldes ${currentYear}`}
              </button>
            </div>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <table className="hub-table">
                <thead><tr><th>Employe</th><th>Departement</th><th>Annee</th><th>Droit</th><th>Utilises</th><th>Restant</th><th>Statut</th><th>Actions</th></tr></thead>
                <tbody>
                  {balances.filter(b => b.year === currentYear).map(b => {
                    const pct = b.total_days > 0 ? Math.round((b.remaining_days / b.total_days) * 100) : 0
                    const isLow = balanceIsLow(b.remaining_days)
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
                            <div className={`progress-fill ${isLow ? 'red' : 'green'}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                          </div>
                        </td>
                        <td>{isLow ? <span className="badge badge-red">⚠️ Faible</span> : <span className="badge badge-green">OK</span>}</td>
                        <td>
                          <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.72rem' }} onClick={() => openBalanceModal(b)} title="Ajuster le droit annuel">✏️</button>
                        </td>
                      </tr>
                    )
                  })}
                  {balances.filter(b => b.year === currentYear).length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun solde enregistre pour {currentYear} — utilisez « Initialiser les soldes ».</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'calendar' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="btn-ghost" onClick={() => shiftMonth(-1)} style={{ padding: '6px 12px' }}>‹</button>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--hub-green)', minWidth: 160, textAlign: 'center' }}>
                  {MONTH_NAMES[calMonth]} {calYear}
                </div>
                <button className="btn-ghost" onClick={() => shiftMonth(1)} style={{ padding: '6px 12px' }}>›</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#666' }}>
                  Alerte effectif réduit dès
                  <input className="hub-input" type="number" min={1} max={20} style={{ width: 64 }}
                    value={overloadThreshold} onChange={e => setOverloadThreshold(Math.max(1, Number(e.target.value) || 1))} />
                  salarié(s) en congé
                </div>
                <div style={{ display: 'flex', gap: 10, fontSize: '0.72rem' }}>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#d1fae5', borderLeft: '3px solid #059669', marginRight: 4 }} />Approuvé</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#fef3c7', borderLeft: '3px solid #d97706', marginRight: 4 }} />En attente</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#fef2f2', border: '1px solid #fecaca', marginRight: 4 }} />Surcharge</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14, fontSize: '0.8rem', color: '#666' }}>
              <span className="badge badge-blue">{calendarOnLeave} salarié(s) en congé ce mois</span>
              {calendarOverloads.length > 0 && (
                <span className="badge badge-red">⚠️ {calendarOverloads.length} jour(s) à effectif réduit : {calendarOverloads.map(d => d.day).join(', ')}</span>
              )}
            </div>

            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', background: '#f8f5ee', borderBottom: '1px solid #e8e4db' }}>
                {WEEKDAY_SHORT.map(w => (
                  <div key={w} style={{ padding: '10px 8px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', textAlign: 'center' }}>{w}</div>
                ))}
              </div>
              {calendarWeeks.map((week, wi) => (
                <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', borderBottom: wi < calendarWeeks.length - 1 ? '1px solid #f0ece4' : 'none' }}>
                  {week.map(day => {
                    const overloaded = day.inMonth && !day.weekend && day.leaves.length >= overloadThreshold
                    return (
                      <div key={day.date} style={{
                        minHeight: 96, padding: 6, borderRight: '1px solid #f0ece4',
                        background: !day.inMonth ? '#fcfbf8' : overloaded ? '#fef2f2' : day.weekend ? '#faf9f6' : 'white',
                        opacity: day.inMonth ? 1 : 0.45,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{
                            fontSize: '0.75rem', fontWeight: day.today ? 800 : 600,
                            color: day.today ? 'white' : '#666',
                            background: day.today ? 'var(--hub-green)' : 'transparent',
                            borderRadius: 10, padding: day.today ? '1px 7px' : '1px 0',
                          }}>{day.day}</span>
                          {day.inMonth && day.leaves.length > 0 && (
                            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: overloaded ? '#991b1b' : '#888' }}>{day.leaves.length}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {day.leaves.slice(0, 3).map(leave => (
                            <div key={leave.id} title={`${leave.employeeName} — ${leaveTypeLabel(leave.leaveType)}`}
                              style={{
                                fontSize: '0.62rem', lineHeight: 1.25, padding: '2px 5px', borderRadius: 4,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                background: leave.status === 'approved' ? '#d1fae5' : '#fef3c7',
                                color: leave.status === 'approved' ? '#065f46' : '#92400e',
                                borderLeft: `3px solid ${leave.status === 'approved' ? '#059669' : '#d97706'}`,
                              }}>
                              {leave.employeeName} · {leaveTypeShort(leave.leaveType)}
                            </div>
                          ))}
                          {day.leaves.length > 3 && (
                            <div style={{ fontSize: '0.62rem', color: '#888', paddingLeft: 5 }}>+{day.leaves.length - 3} autre(s)</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <div className="modal-title">{editing ? '✏️ Modifier la demande' : '🏖 Nouvelle demande de congé'}</div>
            <form onSubmit={handleSave}>
              <div className="hub-form-group"><label>Employe *</label>
                <select className="hub-select" required value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">-- Selectionner --</option>
                  {employees.map(em => <option key={em.id} value={em.id}>{em.full_name} — {em.position}</option>)}
                </select>
              </div>
              <div className="hub-form-group"><label>Type de conge</label>
                <select className="hub-select" value={form.leave_type} onChange={e => setForm(f => ({ ...f, leave_type: e.target.value }))}>
                  {LEAVE_TYPE_LIST.map(t => <option key={t.code} value={t.code}>{t.label}{t.consumesBalance ? '' : ' (hors solde)'}</option>)}
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
                  {!formConsumes && <span style={{ color: '#666' }}> — {leaveTypeLabel(form.leave_type)} ne debite pas le solde annuel</span>}
                  {formConsumes && formBalance && <span style={{ color: '#666' }}> — solde {formYear} : {formBalance.remaining_days}j restants</span>}
                </div>
              )}
              {formOverlap && (
                <div style={{ padding: '10px 14px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: '0.82rem', color: '#991b1b', marginBottom: 12 }}>
                  ⚠️ Chevauchement avec « {formOverlap.title} » ({formOverlap.start_date} → {formOverlap.end_date}, {statusConfig[formOverlap.status]?.label || formOverlap.status}).
                </div>
              )}
              {formBalanceShort && (
                <div style={{ padding: '10px 14px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: '0.82rem', color: '#991b1b', marginBottom: 12 }}>
                  ⚠️ Solde {formYear} insuffisant : {formBalanceAvailable}j disponibles pour {formDays}j demandes.
                </div>
              )}
              <div className="hub-form-group"><label>Motif</label>
                <textarea className="hub-input" rows={2} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Raison de la demande..." style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving || !!formOverlap || formBalanceShort}>{saving ? '...' : editing ? 'Mettre à jour' : 'Soumettre la demande'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBalanceModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowBalanceModal(false)}>
          <div className="modal-box" style={{ maxWidth: 420 }}>
            <div className="modal-title">📊 Droit annuel {balanceForm.year}</div>
            <form onSubmit={saveBalance}>
              <div style={{ fontSize: '0.82rem', color: '#666', marginBottom: 14 }}>
                Nombre de jours ouvrés acquis pour l'année (inclut les reports). Le restant est recalculé automatiquement.
              </div>
              <div className="hub-form-group">
                <label>Jours de droit annuel</label>
                <input className="hub-input" type="number" min={0} required value={balanceForm.total_days}
                  onChange={e => setBalanceForm(f => ({ ...f, total_days: Number(e.target.value) }))} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowBalanceModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={savingBalance}>{savingBalance ? '...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
