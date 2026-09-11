'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import type { Employee } from '@/types'
import {
  ATTENDANCE_STATUS_LIST,
  formatHours,
  isWeekendKey,
  monthRange,
  monthlyStats,
  overtimeHours,
  summarizeAttendance,
  todayKey,
  workedHours,
} from '@/lib/hr/attendance'
import { MONTH_NAMES } from '@/lib/hr/leaves'

type Draft = { status: string; check_in: string; check_out: string; notes: string }

const emptyDraft: Draft = { status: '', check_in: '', check_out: '', notes: '' }

function fmtDate(d: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  if (!match) return d
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

export default function AttendancePage() {
  const supabase = createClient()
  const { toast } = useToast()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [tab, setTab] = useState<'day' | 'history'>('day')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [schemaError, setSchemaError] = useState<string | null>(null)

  // Feuille du jour
  const [day, setDay] = useState(todayKey())
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [existing, setExisting] = useState<Record<string, boolean>>({})

  // Historique du mois
  const [month, setMonth] = useState(() => todayKey().slice(0, 7))
  const [monthRows, setMonthRows] = useState<any[]>([])
  const [monthLoading, setMonthLoading] = useState(false)

  const loadEmployees = useCallback(async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .neq('status', 'sorti')
      .order('full_name')
    if (error) toast('error', 'Erreur de chargement des employés.')
    setEmployees(data || [])
  }, [])

  const loadDay = useCallback(async (date: string) => {
    setLoading(true)
    const { data, error } = await supabase.from('attendance').select('*').eq('date', date)
    if (error) {
      setSchemaError(error.message)
      setDrafts({})
      setExisting({})
      setLoading(false)
      return
    }
    setSchemaError(null)
    const nextDrafts: Record<string, Draft> = {}
    const nextExisting: Record<string, boolean> = {}
    for (const row of data || []) {
      nextExisting[row.employee_id] = true
      nextDrafts[row.employee_id] = {
        status: row.status || '',
        check_in: (row.check_in || '').slice(0, 5),
        check_out: (row.check_out || '').slice(0, 5),
        notes: row.notes || '',
      }
    }
    setDrafts(nextDrafts)
    setExisting(nextExisting)
    setLoading(false)
  }, [])

  useEffect(() => { loadEmployees() }, [loadEmployees])
  useEffect(() => { loadDay(day) }, [day, loadDay])

  const loadMonth = useCallback(async (value: string) => {
    const [y, m] = value.split('-').map(Number)
    if (!y || !m) return
    setMonthLoading(true)
    const { start, end } = monthRange(y, m - 1)
    const { data, error } = await supabase
      .from('attendance')
      .select('*')
      .gte('date', start)
      .lte('date', end)
    if (error) {
      setSchemaError(error.message)
      setMonthRows([])
    } else {
      setSchemaError(null)
      setMonthRows(data || [])
    }
    setMonthLoading(false)
  }, [])

  useEffect(() => {
    if (tab === 'history') loadMonth(month)
  }, [tab, month, loadMonth])

  function updateDraft(employeeId: string, patch: Partial<Draft>) {
    setDrafts(prev => ({ ...prev, [employeeId]: { ...emptyDraft, ...prev[employeeId], ...patch } }))
  }

  function markAllPresent() {
    const next: Record<string, Draft> = { ...drafts }
    for (const emp of employees) next[emp.id] = { ...emptyDraft, ...next[emp.id], status: 'present' }
    setDrafts(next)
  }

  function clearSheet() {
    const next: Record<string, Draft> = {}
    for (const id of Object.keys(drafts)) next[id] = { ...emptyDraft, ...drafts[id], status: '' }
    setDrafts(next)
  }

  async function saveDay() {
    setSaving(true)
    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id || null
    const toUpsert: any[] = []
    const toDelete: string[] = []

    for (const emp of employees) {
      const draft = drafts[emp.id]
      if (!draft || !draft.status) {
        if (existing[emp.id]) toDelete.push(emp.id)
        continue
      }
      const hours = workedHours(draft.check_in, draft.check_out)
      toUpsert.push({
        employee_id: emp.id,
        date: day,
        status: draft.status,
        check_in: draft.check_in || null,
        check_out: draft.check_out || null,
        hours_worked: hours,
        overtime_hours: overtimeHours(hours),
        notes: draft.notes || null,
        created_by: userId,
        updated_at: new Date().toISOString(),
      })
    }

    if (toUpsert.length) {
      const { error } = await supabase.from('attendance').upsert(toUpsert, { onConflict: 'employee_id,date' })
      if (error) { toast('error', `Erreur d'enregistrement : ${error.message}`); setSaving(false); return }
    }
    for (const employeeId of toDelete) {
      const { error } = await supabase.from('attendance').delete().eq('employee_id', employeeId).eq('date', day)
      if (error) { toast('error', `Erreur de suppression : ${error.message}`); setSaving(false); return }
    }

    setSaving(false)
    toast('success', `Feuille de présence enregistrée (${toUpsert.length} pointage${toUpsert.length > 1 ? 's' : ''}).`)
    loadDay(day)
    if (tab === 'history') loadMonth(month)
  }

  const daySummary = useMemo(
    () =>
      summarizeAttendance(
        employees
          .map(emp => ({ emp, draft: drafts[emp.id] }))
          .filter(({ draft }) => draft && draft.status)
          .map(({ emp, draft }) => ({
            employee_id: emp.id,
            date: day,
            status: draft.status,
            check_in: draft.check_in,
            check_out: draft.check_out,
          })),
      ),
    [employees, drafts, day],
  )

  const pointedCount = employees.filter(emp => drafts[emp.id]?.status).length
  const monthSummary = useMemo(() => summarizeAttendance(monthRows), [monthRows])
  const monthStats = useMemo(
    () => monthlyStats(monthRows, employees.map(e => e.id)),
    [monthRows, employees],
  )
  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>()
    for (const emp of employees) map.set(emp.id, emp)
    return map
  }, [employees])
  const monthValue = month
  const monthLabel = (() => {
    const [y, m] = monthValue.split('-').map(Number)
    return `${MONTH_NAMES[(m || 1) - 1]} ${y}`
  })()

  return (
    <div className="invoice-page">
      <div className="page-header">
        <h2>🕒 Présences &amp; pointage</h2>
        {tab === 'day' ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn-ghost" onClick={markAllPresent}>✅ Tout présent</button>
            <button className="btn-ghost" onClick={clearSheet}>Vider</button>
            <button className="btn-primary" onClick={saveDay} disabled={saving}>
              {saving ? 'Enregistrement...' : '💾 Enregistrer'}
            </button>
          </div>
        ) : null}
      </div>

      <div style={{ padding: '24px 32px' }}>
        {schemaError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: '0.85rem' }}>
            ⚠️ Module indisponible : la migration <code>20260909170001_audit_28_hr_attendance_leave_balances.sql</code> n'a pas encore été appliquée.
            <div style={{ color: '#7f1d1d', marginTop: 4, fontSize: '0.78rem' }}>{schemaError}</div>
          </div>
        )}

        {/* Onglets */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: '#f0ece4', borderRadius: 8, padding: 4, width: 'fit-content' }}>
          {[{ k: 'day', l: '📋 Feuille du jour' }, { k: 'history', l: '📊 Historique mensuel' }].map(t => (
            <button key={t.k} type="button" onClick={() => setTab(t.k as any)}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
                background: tab === t.k ? 'white' : 'transparent', color: tab === t.k ? 'var(--hub-green)' : '#666',
                boxShadow: tab === t.k ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
              {t.l}
            </button>
          ))}
        </div>

        {tab === 'day' && (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
              <div className="hub-form-group" style={{ marginBottom: 0 }}>
                <label>Journée</label>
                <input className="hub-input" type="date" value={day} onChange={e => setDay(e.target.value)} style={{ maxWidth: 200 }} />
              </div>
              <div style={{ fontSize: '0.85rem', color: '#666', alignSelf: 'flex-end', paddingBottom: 10 }}>
                {fmtDate(day)}
                {isWeekendKey(day) && <span className="badge badge-gray" style={{ marginLeft: 8 }}>Week-end</span>}
              </div>
            </div>

            {/* KPIs du jour */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14, marginBottom: 20 }}>
              <div className="stat-card green"><div className="stat-value">{daySummary.present}</div><div className="stat-label">Présents</div></div>
              <div className="stat-card amber"><div className="stat-value">{daySummary.late}</div><div className="stat-label">Retards</div></div>
              <div className="stat-card red"><div className="stat-value">{daySummary.absent}</div><div className="stat-label">Absents</div></div>
              <div className="stat-card blue"><div className="stat-value">{daySummary.leave}</div><div className="stat-label">En congé</div></div>
              <div className="stat-card green"><div className="stat-value">{formatHours(daySummary.hours)}</div><div className="stat-label">Heures</div></div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: '0.8rem', color: '#888' }}>
                {pointedCount}/{employees.length} employé(s) pointé(s)
              </div>
              <div style={{ fontSize: '0.75rem', color: '#aaa' }}>
                Heures calculées automatiquement depuis l'arrivée et le départ (service de nuit géré).
              </div>
            </div>

            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
                <table className="hub-table">
                  <thead>
                    <tr>
                      <th>Employé</th><th>Département</th><th>Statut</th>
                      <th>Arrivée</th><th>Départ</th><th>Heures</th><th>H. sup</th><th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(emp => {
                      const draft = drafts[emp.id] || emptyDraft
                      const hours = workedHours(draft.check_in, draft.check_out)
                      const overtime = overtimeHours(hours)
                      const disabled = !draft.status
                      return (
                        <tr key={emp.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{emp.full_name}</div>
                            <div style={{ fontSize: '0.72rem', color: '#999' }}>{emp.position}</div>
                          </td>
                          <td><span className="badge badge-gray">{emp.department}</span></td>
                          <td>
                            <select className="hub-select" style={{ minWidth: 130 }}
                              value={draft.status}
                              onChange={e => updateDraft(emp.id, { status: e.target.value })}>
                              <option value="">— Non pointé —</option>
                              {ATTENDANCE_STATUS_LIST.map(s => <option key={s.code} value={s.code}>{s.icon} {s.short}</option>)}
                            </select>
                          </td>
                          <td>
                            <input className="hub-input" type="time" style={{ maxWidth: 110 }} disabled={disabled}
                              value={draft.check_in} onChange={e => updateDraft(emp.id, { check_in: e.target.value })} />
                          </td>
                          <td>
                            <input className="hub-input" type="time" style={{ maxWidth: 110 }} disabled={disabled}
                              value={draft.check_out} onChange={e => updateDraft(emp.id, { check_out: e.target.value })} />
                          </td>
                          <td style={{ fontWeight: 600, color: hours ? '#065f46' : '#aaa' }}>{formatHours(hours)}</td>
                          <td style={{ color: overtime > 0 ? '#92400e' : '#aaa', fontWeight: overtime > 0 ? 700 : 400 }}>
                            {overtime > 0 ? `+${formatHours(overtime)}` : '—'}
                          </td>
                          <td>
                            <input className="hub-input" placeholder="Note..." style={{ minWidth: 140 }} disabled={disabled}
                              value={draft.notes} onChange={e => updateDraft(emp.id, { notes: e.target.value })} />
                          </td>
                        </tr>
                      )
                    })}
                    {employees.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun employé actif</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {pointedCount > 0 && (
              <div style={{ marginTop: 10, fontSize: '0.78rem', color: '#888' }}>
                Statut retenu pour {pointedCount} employé(s) — pensez à <strong>Enregistrer</strong>. Les lignes « Non pointé » sans pointage existant sont ignorées.
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
              <div className="hub-form-group" style={{ marginBottom: 0 }}>
                <label>Mois</label>
                <input className="hub-input" type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ maxWidth: 200 }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14, marginBottom: 20 }}>
              <div className="stat-card green"><div className="stat-value">{monthSummary.present + monthSummary.late}</div><div className="stat-label">Jours travaillés</div></div>
              <div className="stat-card amber"><div className="stat-value">{monthSummary.late}</div><div className="stat-label">Retards</div></div>
              <div className="stat-card red"><div className="stat-value">{monthSummary.absent}</div><div className="stat-label">Absences</div></div>
              <div className="stat-card blue"><div className="stat-value">{monthSummary.leave}</div><div className="stat-label">Congés</div></div>
              <div className="stat-card green"><div className="stat-value">{formatHours(monthSummary.hours)}</div><div className="stat-label">Heures — {monthLabel}</div></div>
            </div>

            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              {monthLoading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
                <table className="hub-table">
                  <thead>
                    <tr>
                      <th>Employé</th><th>Jours pointés</th><th>Jours travaillés</th>
                      <th>Présents</th><th>Retards</th><th>Absences</th><th>Congés</th><th>Fériés</th>
                      <th>Heures</th><th>H. sup</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthStats.map(stat => {
                      const emp = employeeById.get(stat.employeeId)
                      return (
                        <tr key={stat.employeeId}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{emp?.full_name || '—'}</div>
                            <div style={{ fontSize: '0.72rem', color: '#999' }}>{emp?.department || ''}</div>
                          </td>
                          <td style={{ fontWeight: 600 }}>{stat.present + stat.late + stat.absent + stat.leave + stat.holiday}</td>
                          <td style={{ fontWeight: 700, color: '#065f46' }}>{stat.days}</td>
                          <td>{stat.present}</td>
                          <td style={{ color: stat.late ? '#92400e' : '#aaa' }}>{stat.late}</td>
                          <td style={{ color: stat.absent ? '#991b1b' : '#aaa' }}>{stat.absent}</td>
                          <td style={{ color: stat.leave ? '#1e40af' : '#aaa' }}>{stat.leave}</td>
                          <td style={{ color: '#666' }}>{stat.holiday}</td>
                          <td style={{ fontWeight: 600 }}>{formatHours(stat.hours)}</td>
                          <td style={{ color: stat.overtime > 0 ? '#92400e' : '#aaa' }}>{stat.overtime > 0 ? `+${formatHours(stat.overtime)}` : '—'}</td>
                        </tr>
                      )
                    })}
                    {monthStats.length === 0 && (
                      <tr><td colSpan={10} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun pointage pour {monthLabel}</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
