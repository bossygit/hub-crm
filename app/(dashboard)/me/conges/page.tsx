'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import type { Employee } from '@/types'

const leaveTypes: Record<string, string> = {
  annuel: 'Conge annuel',
  maladie: 'Conge maladie',
  sans_solde: 'Sans solde',
  exceptionnel: 'Conge exceptionnel',
  maternite: 'Maternite/Paternite',
}

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray', icon: '✏️' },
  pending: { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Approuve', badge: 'badge-green', icon: '✅' },
  rejected: { label: 'Refuse', badge: 'badge-red', icon: '❌' },
}

const emptyForm = { leave_type: 'annuel', start_date: '', end_date: '', reason: '' }

// Même logique de jours ouvrés que la page RH /hr/leaves.
function workingDays(start: string, end: string): number {
  if (!start || !end) return 0
  let count = 0
  const d = new Date(start)
  const e = new Date(end)
  while (d <= e) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString('fr-FR')
}

export default function MyCongesPage() {
  const supabase = createClient()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [emp, setEmp] = useState<Employee | null>(null)
  const [balances, setBalances] = useState<any[]>([])
  const [leaves, setLeaves] = useState<any[]>([])
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }
    setUserId(user.id)

    const { data: empData, error: empErr } = await supabase
      .from('employees')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    if (empErr || !empData) {
      setEmp(null)
      setBalances([])
      setLeaves([])
      setLoading(false)
      return
    }
    setEmp(empData)

    const [balRes, leafRes] = await Promise.all([
      supabase
        .from('leave_balances')
        .select('*')
        .eq('employee_id', empData.id)
        .order('year', { ascending: false }),
      supabase
        .from('employee_documents')
        .select('*')
        .eq('employee_id', empData.id)
        .eq('type', 'conge')
        .order('created_at', { ascending: false }),
    ])
    if (balRes.error || leafRes.error) toast('error', 'Erreur de chargement de vos congés.')
    setBalances(balRes.data || [])
    setLeaves(leafRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const currentYear = new Date().getFullYear()
  const balCurrent = balances.find(b => b.year === currentYear)

  function yearOf(d: string): number {
    const y = new Date(d).getFullYear()
    return Number.isFinite(y) ? y : currentYear
  }

  const days = workingDays(form.start_date, form.end_date)

  function overlapsExisting(): boolean {
    if (!form.start_date || !form.end_date) return false
    return leaves.some(l =>
      (l.status === 'pending' || l.status === 'approved') &&
      l.start_date && l.end_date &&
      l.start_date <= form.end_date && l.end_date >= form.start_date
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!emp || !userId) return
    if (!form.start_date || !form.end_date || !form.reason.trim()) {
      setFormError('Remplissez la période et le motif de la demande.')
      return
    }
    if (days <= 0) {
      setFormError('La date de fin doit être postérieure ou égale à la date de début.')
      return
    }
    if (overlapsExisting()) {
      setFormError('Une demande en attente ou approuvee couvre deja cette periode.')
      return
    }
    const balYear = balances.find(b => b.year === yearOf(form.start_date))
    if (form.leave_type === 'annuel' && balYear && days > balYear.remaining_days) {
      setFormError(`Solde annuel ${yearOf(form.start_date)} insuffisant : ${balYear.remaining_days}j restants pour ${days}j demandes.`)
      return
    }

    setSaving(true)
    const title = `${leaveTypes[form.leave_type] || form.leave_type} — ${emp.full_name} (${days}j)`
    const payload = {
      employee_id: emp.id,
      type: 'conge',
      status: 'pending',
      title,
      issued_date: new Date().toISOString().split('T')[0],
      start_date: form.start_date,
      end_date: form.end_date,
      content: { leave_type: form.leave_type, reason: form.reason.trim(), days, source: 'self_service' },
      created_by: userId,
    }

    const { data: newLeave, error } = await supabase
      .from('employee_documents')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      setSaving(false)
      toast('error', `Erreur : ${error.message}`)
      return
    }

    toast('success', 'Demande soumise. Elle sera validee par la RH.')
    setForm(emptyForm)
    setSaving(false)

    // Notifie les managers (best-effort — même flux que la page RH).
    if (newLeave) {
      try {
        await fetch('/api/notifications/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'leave_pending',
            title: `Demande de conge — ${emp.full_name}`,
            message: `${leaveTypes[form.leave_type] || form.leave_type} du ${form.start_date} au ${form.end_date} (${days} jours)`,
            referenceId: newLeave.id,
            referenceType: 'leave',
            link: '/hr/leaves',
          }),
        })
      } catch { /* best-effort */ }
    }
    load()
  }

  const pendingCount = leaves.filter(l => l.status === 'pending').length

  return (
    <div className="invoice-page">
      <div className="page-header">
        <h2>🏖 Mes congés</h2>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div>
        ) : !emp ? (
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🔗</div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 6 }}>
              Aucune fiche employé liée à votre compte
            </div>
            <div style={{ color: '#666', fontSize: '0.9rem', maxWidth: 420, margin: '0 auto' }}>
              Pour soumettre vos demandes de congé et consulter vos soldes,
              contactez la RH afin de relier votre compte à votre fiche employé.
            </div>
          </div>
        ) : (
          <>
            {/* Bandeau d'accueil */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: 'var(--hub-green)', color: 'white', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>Bonjour {emp.full_name} 👋</div>
                <div style={{ opacity: 0.85, fontSize: '0.85rem' }}>{emp.position} · {emp.department}{emp.employee_number ? ` · ${emp.employee_number}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="badge" style={{ background: 'rgba(255,255,255,0.18)', color: 'white' }}>
                  ⏳ {pendingCount} en attente
                </span>
              </div>
            </div>

            {/* Soldes */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--hub-green)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                📊 Mes soldes de congés — {currentYear}
              </div>
              {balCurrent ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
                  <div style={{ background: 'white', borderRadius: 10, border: '1px solid #e8e4db', padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, color: '#065f46', fontSize: '1.4rem' }}>{balCurrent.remaining_days}j</div>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>Restant</div>
                  </div>
                  <div style={{ background: 'white', borderRadius: 10, border: '1px solid #e8e4db', padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, color: '#991b1b', fontSize: '1.4rem' }}>{balCurrent.used_days}j</div>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>Utilisés</div>
                  </div>
                  <div style={{ background: 'white', borderRadius: 10, border: '1px solid #e8e4db', padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, color: '#555', fontSize: '1.4rem' }}>{balCurrent.total_days}j</div>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>Total {currentYear}</div>
                  </div>
                </div>
              ) : (
                <div style={{ background: '#f8f5ee', borderRadius: 10, border: '1px solid #e8e4db', padding: '16px', fontSize: '0.85rem', color: '#666' }}>
                  Aucun solde enregistré pour {currentYear} — il est créé automatiquement lors de la première validation RH d'une demande.
                </div>
              )}
              {balances.length > 1 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {balances.map(b => (
                    <span key={b.id} className="badge badge-gray" style={{ fontSize: '0.72rem' }}>
                      {b.year} : {b.remaining_days}j restants
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
              {/* Formulaire de demande */}
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px' }}>
                <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--hub-green)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                  📝 Nouvelle demande de congé
                </div>
                <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: 14 }}>
                  Votre demande sera validée par la RH avant d'être comptabilisée sur votre solde.
                </div>

                <form onSubmit={handleSubmit}>
                  <div className="hub-form-group">
                    <label>Type de congé</label>
                    <select className="hub-select" value={form.leave_type} onChange={e => setForm(f => ({ ...f, leave_type: e.target.value }))}>
                      {Object.entries(leaveTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="hub-form-group">
                      <label>Date début *</label>
                      <input className="hub-input" type="date" required value={form.start_date}
                        onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                    </div>
                    <div className="hub-form-group">
                      <label>Date fin *</label>
                      <input className="hub-input" type="date" required value={form.end_date}
                        onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                    </div>
                  </div>

                  {days > 0 && (
                    <div style={{ padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', fontSize: '0.875rem', marginBottom: 12 }}>
                      📅 Durée : <strong>{days} jour(s) ouvré(s)</strong>
                    </div>
                  )}

                  <div className="hub-form-group">
                    <label>Motif *</label>
                    <textarea className="hub-input" rows={3} required value={form.reason}
                      onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                      placeholder="Raison de la demande..." style={{ resize: 'vertical' }} />
                  </div>

                  {formError && (
                    <div style={{ padding: '10px 14px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: '0.85rem', color: '#991b1b', marginBottom: 12 }}>
                      ⚠️ {formError}
                    </div>
                  )}

                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? 'Envoi en cours...' : 'Soumettre la demande'}
                  </button>
                </form>
              </div>

              {/* Historique des demandes */}
              <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
                <div style={{ padding: '16px 16px 0', fontWeight: 700, fontSize: '0.8rem', color: 'var(--hub-green)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  📋 Mes demandes ({leaves.length})
                </div>
                {leaves.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Aucune demande pour le moment</div>
                ) : (
                  <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                    {leaves.map(l => {
                      const cfg = statusConfig[l.status] || statusConfig.draft
                      const c = l.content || {}
                      const lDays = (c as any).days || workingDays(l.start_date, l.end_date)
                      return (
                        <div key={l.id} style={{ padding: '12px 16px', borderBottom: '1px solid #f0ece4', fontSize: '0.85rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 600 }}>🏖 {leaveTypes[(c as any).leave_type] || (c as any).leave_type || '—'}</span>
                            <span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span>
                          </div>
                          <div style={{ color: '#666', marginTop: 4 }}>
                            {fmtDate(l.start_date)} → {fmtDate(l.end_date)} · <strong>{lDays}j</strong>
                            {(c as any).reason && <div style={{ color: '#888', marginTop: 2, fontStyle: 'italic' }}>« {(c as any).reason} »</div>}
                          </div>
                          <div style={{ color: '#aaa', fontSize: '0.72rem', marginTop: 4 }}>
                            Soumis le {fmtDate(l.created_at)}
                            {l.status !== 'pending' && l.approved_at && ` · ${cfg.icon} ${cfg.label.toLowerCase()} le ${fmtDate(l.approved_at)}`}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
