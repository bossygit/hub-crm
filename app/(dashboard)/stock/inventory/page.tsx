'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { buildInventorySnapshot } from '@/lib/stock/units'
import { isBlindSession } from '@/lib/stock/inventoryBlind'
import {
  defaultScheduledDate,
  isPlanned,
  plannedSummary,
  scheduleLabel,
  validateSchedule,
} from '@/lib/stock/inventorySchedule'
import { useRouter } from 'next/navigation'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  planned: { label: 'Planifié', badge: 'badge-blue', icon: '📅' },
  draft: { label: 'En cours', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Validé', badge: 'badge-green', icon: '✅' },
  cancelled: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

type Manager = { id: string; full_name: string | null; role: string }

export default function InventoryListPage() {
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState<string | null>(null)
  const [startingNew, setStartingNew] = useState(false)
  const [blind, setBlind] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const supabase = createClient()
  const { toast } = useToast()
  const router = useRouter()

  // Planification
  const [managers, setManagers] = useState<Manager[]>([])
  const [showPlan, setShowPlan] = useState(false)
  const [savingPlan, setSavingPlan] = useState(false)
  const [planError, setPlanError] = useState('')
  const [planForm, setPlanForm] = useState({
    scheduled_date: defaultScheduledDate(),
    assigned_to: '',
    schedule_notes: '',
    blind: false,
  })

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('inventory_sessions').select('*').order('created_at', { ascending: false })
    setSessions(data || [])
    setLoading(false)
  }, [])

  const loadManagers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['ceo', 'manager', 'admin'])
      .order('full_name')
    setManagers((data || []) as Manager[])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadManagers() }, [loadManagers])

  const summary = useMemo(() => plannedSummary(sessions), [sessions])
  const runningCount = sessions.filter(s => s.status === 'draft').length

  async function startCount(existingSessionId?: string) {
    const target = existingSessionId ? sessions.find(s => s.id === existingSessionId) : null
    const blindFlag = target ? !!target.blind : blind

    if (existingSessionId) setStarting(existingSessionId)
    else setStartingNew(true)
    setErrorMsg('')

    const [{ data: products }, { data: batches }, { data: userData }, { data: num }] = await Promise.all([
      supabase.from('products').select('id, name, quantity, unit').order('name'),
      supabase.from('product_batches').select('id, product_id, batch_number, quantity, quality_status'),
      supabase.auth.getUser(),
      existingSessionId ? Promise.resolve({ data: null }) : supabase.rpc('generate_inventory_number'),
    ])
    const snapshot = buildInventorySnapshot(products || [], batches || [])
    if (snapshot.length === 0) {
      toast('warning', 'Aucun stock à compter.')
      setStarting(null); setStartingNew(false)
      return
    }

    let sessionId = existingSessionId || null
    if (sessionId) {
      // Démarre une séance planifiée : statut draft + horodatage.
      const { error } = await supabase.from('inventory_sessions').update({
        status: 'draft',
        started_at: new Date().toISOString(),
        counted_by: blindFlag ? userData.user?.id : null,
      }).eq('id', sessionId)
      if (error) { setErrorMsg(error.message); toast('error', error.message); setStarting(null); return }
    } else {
      const { data: session, error } = await supabase.from('inventory_sessions').insert({
        session_number: num as string,
        status: 'draft',
        created_by: userData.user?.id,
        blind: blindFlag,
        started_at: new Date().toISOString(),
        counted_by: blindFlag ? userData.user?.id : null,
      }).select('id').single()
      if (error || !session) {
        const msg = error?.message || 'Erreur lors de la création de la séance'
        setErrorMsg(msg); toast('error', msg); setStarting(null); setStartingNew(false)
        return
      }
      sessionId = session.id
    }

    const { error: linesError } = await supabase.from('inventory_lines').insert(snapshot.map((line, idx) => ({
      session_id: sessionId,
      product_id: line.product_id,
      batch_id: line.batch_id,
      name: line.product_name,
      batch_number: line.batch_number,
      unit: line.unit,
      theoretical: line.theoretical,
      // Aveugle : chaque ligne démarre vide (rien n'est pré-rempli avec le théorique).
      counted: blindFlag ? 0 : line.theoretical,
      entry_quantity: blindFlag ? null : line.theoretical,
      entry_unit: line.unit,
      sort_order: idx,
    })))

    setStarting(null); setStartingNew(false)
    if (linesError) { setErrorMsg(linesError.message); toast('error', linesError.message); return }
    router.push(`/stock/inventory/${sessionId}`)
  }

  function openPlan() {
    setPlanForm({ scheduled_date: defaultScheduledDate(), assigned_to: '', schedule_notes: '', blind: false })
    setPlanError('')
    setShowPlan(true)
  }

  async function planInventory() {
    const check = validateSchedule(planForm.scheduled_date)
    if (!check.ok) { setPlanError(check.error || 'Date invalide.'); return }

    setSavingPlan(true)
    setPlanError('')
    const [{ data: userData }, { data: num }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('generate_inventory_number'),
    ])

    const { error } = await supabase.from('inventory_sessions').insert({
      session_number: num as string,
      status: 'planned',
      scheduled_date: planForm.scheduled_date,
      assigned_to: planForm.assigned_to || null,
      schedule_notes: planForm.schedule_notes || null,
      blind: planForm.blind,
      created_by: userData.user?.id,
    })

    setSavingPlan(false)
    if (error) { setPlanError(error.message); toast('error', `Erreur : ${error.message}`); return }
    toast('success', `Inventaire planifié pour le ${new Date(planForm.scheduled_date).toLocaleDateString('fr-FR')}.`)
    setShowPlan(false)
    load()
  }

  return (
    <div>
      <div className="page-header">
        <h2>📋 Inventaire physique</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/stock" className="btn-ghost" style={{ textDecoration: 'none' }}>← Stock</Link>
          <button className="btn-ghost" onClick={openPlan}>📅 Planifier</button>
          <button className="btn-primary" disabled={startingNew} onClick={() => startCount()}>{startingNew ? '...' : '+ Nouveau comptage'}</button>
        </div>
      </div>
      <div style={{ padding: '24px 32px' }}>
        <p style={{ color: '#666', marginBottom: 20, maxWidth: 720, fontSize: '0.9rem' }}>
          Comptez chaque lot (et le hors-lot). L’écart corrige le stock à la validation.
          Une séance <strong>planifiée</strong> figera le stock au moment de son démarrage.
        </p>

        {/* KPIs planification */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14, marginBottom: 22 }}>
          <div className="stat-card blue"><div className="stat-value">{summary.planned}</div><div className="stat-label">Planifiés</div></div>
          <div className="stat-card amber"><div className="stat-value">{runningCount}</div><div className="stat-label">En cours</div></div>
          <div className="stat-card green"><div className="stat-value">{sessions.filter(s => s.status === 'approved').length}</div><div className="stat-label">Validés</div></div>
          {summary.overdue > 0 && <div className="stat-card red"><div className="stat-value">{summary.overdue}</div><div className="stat-label">Planifiés en retard</div></div>}
        </div>

        {summary.next && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 10, padding: '8px 14px', fontSize: '0.82rem', fontWeight: 600, marginBottom: 16 }}>
            📅 Prochain inventaire : {summary.next.scheduled_date ? new Date(summary.next.scheduled_date).toLocaleDateString('fr-FR') : 'date à définir'} ({scheduleLabel(summary.next.scheduled_date)})
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.9rem', userSelect: 'none' }}
            title="Comptage à l'aveugle : les quantités théoriques restent masquées pendant le comptage. Chaque ligne démarre vide et les écarts ne sont visibles qu'après l'action « Afficher les écarts » (manager)."
          >
            <input type="checkbox" checked={blind} onChange={e => setBlind(e.target.checked)} />
            🎭 Comptage à l’aveugle
          </label>
          {blind && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff7ed', border: '1px solid #fed7aa', color: '#92400e', borderRadius: 10, padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700 }}>
              🔒 Comptage à l’aveugle — valeurs théoriques masquées
            </span>
          )}
        </div>
        {errorMsg && (
          <p style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: '0.85rem' }}>
            {errorMsg}
          </p>
        )}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
            <table className="hub-table">
              <thead><tr><th>N°</th><th>Date</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {sessions.map(s => {
                  const cfg = statusConfig[s.status] || statusConfig.draft
                  return (
                    <tr key={s.id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{s.session_number}{isBlindSession(s) ? ' 🔒' : ''}</td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>
                        {isPlanned(s) && s.scheduled_date
                          ? <>{new Date(s.scheduled_date).toLocaleDateString('fr-FR')} <span style={{ color: '#999' }}>· {scheduleLabel(s.scheduled_date)}</span></>
                          : new Date(s.created_at).toLocaleDateString('fr-FR')}
                        {isPlanned(s) && s.assigned_to && (
                          <div style={{ fontSize: '0.72rem', color: '#999' }}>
                            👤 {managers.find(m => m.id === s.assigned_to)?.full_name || 'responsable assigné'}
                          </div>
                        )}
                      </td>
                      <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {isPlanned(s) && (
                            <button className="btn-primary" disabled={starting !== null} style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => startCount(s.id)}>
                              {starting === s.id ? '…' : '▶ Démarrer'}
                            </button>
                          )}
                          <Link href={`/stock/inventory/${s.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>Voir</Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {sessions.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun inventaire — lancez un comptage ou planifiez une séance</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showPlan && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowPlan(false)}>
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <div className="modal-title">📅 Planifier un inventaire physique</div>
            <div style={{ fontSize: '0.82rem', color: '#666', marginBottom: 14 }}>
              La séance reste « planifiée » jusqu’à son démarrage : les lignes seront générées à partir du stock du moment.
            </div>
            <form onSubmit={e => { e.preventDefault(); planInventory() }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group">
                  <label>Date prévue *</label>
                  <input className="hub-input" type="date" required value={planForm.scheduled_date}
                    onChange={e => setPlanForm(f => ({ ...f, scheduled_date: e.target.value }))} />
                </div>
                <div className="hub-form-group">
                  <label>Responsable</label>
                  <select className="hub-select" value={planForm.assigned_to}
                    onChange={e => setPlanForm(f => ({ ...f, assigned_to: e.target.value }))}>
                    <option value="">— Non assigné —</option>
                    {managers.map(m => <option key={m.id} value={m.id}>{m.full_name || m.role}</option>)}
                  </select>
                </div>
              </div>
              <div className="hub-form-group">
                <label>Notes / périmètre</label>
                <textarea className="hub-input" rows={2} value={planForm.schedule_notes}
                  onChange={e => setPlanForm(f => ({ ...f, schedule_notes: e.target.value }))}
                  placeholder="Ex : entrepôt principal, produits secs" style={{ resize: 'vertical' }} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer', marginBottom: 14 }}>
                <input type="checkbox" checked={planForm.blind} onChange={e => setPlanForm(f => ({ ...f, blind: e.target.checked }))} />
                🎭 Comptage à l’aveugle
              </label>
              {planError && (
                <div style={{ padding: '10px 14px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: '0.82rem', color: '#991b1b', marginBottom: 12 }}>
                  ⚠️ {planError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowPlan(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={savingPlan}>{savingPlan ? '...' : 'Planifier'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
