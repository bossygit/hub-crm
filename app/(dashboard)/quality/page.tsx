'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { QUALITY_LABELS } from '@/lib/quality/release'

type PendingLot = {
  id: string
  batch_number: string
  quantity: number
  expiry_date?: string | null
  production_date?: string | null
  supplier?: string | null
  created_at: string
  product?: { name?: string; unit?: string } | null
  source?: string
}

type QualityCheckRow = {
  id: string
  check_number: string
  batch_id: string
  result: 'released' | 'rejected'
  notes?: string | null
  source?: string | null
  created_at: string
  batch?: { id?: string; batch_number?: string; product?: { name?: string; unit?: string } | null } | null
}

const SOURCE_LABEL: Record<string, string> = {
  purchase: 'Réception achat',
  production: 'Production',
  manual: 'Manuel',
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('fr-FR')
}

function inferSource(referenceType?: string | null): 'purchase' | 'production' | 'manual' {
  if (referenceType === 'purchase') return 'purchase'
  if (referenceType === 'production') return 'production'
  return 'manual'
}

export default function QualityPage() {
  const [tab, setTab] = useState<'queue' | 'history'>('queue')
  const [pending, setPending] = useState<PendingLot[]>([])
  const [checks, setChecks] = useState<QualityCheckRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [active, setActive] = useState<PendingLot | null>(null)
  const supabase = createClient()
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: lots }, { data: history }] = await Promise.all([
      supabase
        .from('product_batches')
        .select('id, batch_number, quantity, expiry_date, production_date, supplier, created_at, product:products(name, unit)')
        .eq('quality_status', 'pending')
        .order('created_at', { ascending: false }),
      supabase
        .from('quality_checks')
        .select('id, check_number, batch_id, result, notes, source, created_at, batch:product_batches(id, batch_number, product:products(name, unit))')
        .order('created_at', { ascending: false })
        .limit(80),
    ])

    const pendingLots = (lots || []) as PendingLot[]
    if (pendingLots.length > 0) {
      const ids = pendingLots.map(l => l.id)
      const { data: movs } = await supabase
        .from('stock_movements')
        .select('batch_id, reference_type')
        .in('batch_id', ids)
        .eq('type', 'IN')
      const byBatch = new Map<string, string>()
      for (const m of movs || []) {
        if (m.batch_id && !byBatch.has(m.batch_id)) byBatch.set(m.batch_id, inferSource(m.reference_type))
      }
      setPending(pendingLots.map(l => ({ ...l, source: byBatch.get(l.id) || 'manual' })))
    } else {
      setPending([])
    }
    setChecks((history || []) as QualityCheckRow[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function decide(lot: PendingLot, result: 'released' | 'rejected') {
    setSavingId(lot.id)
    const { data: userData } = await supabase.auth.getUser()
    const { data: num } = await supabase.rpc('generate_quality_check_number')
    const { error } = await supabase.from('quality_checks').insert({
      check_number: num as string,
      batch_id: lot.id,
      result,
      source: lot.source || 'manual',
      notes: (notes[lot.id] || '').trim() || null,
      checked_by: userData.user?.id,
    })
    setSavingId(null)
    if (error) { toast('error', error.message); return }
    toast('success', result === 'released' ? 'Lot libéré.' : 'Lot mis au rebut.')
    setActive(null)
    setNotes(prev => ({ ...prev, [lot.id]: '' }))
    load()
  }

  function printCheck(lot: PendingLot, result: string, checkNumber?: string) {
    const product = lot.product?.name || '—'
    const cfg = QUALITY_LABELS[result] || QUALITY_LABELS.pending
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Contrôle ${checkNumber || lot.batch_number}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a}
@page{margin:15mm 18mm;size:A4}
.header{display:flex;justify-content:space-between;padding:24px 32px 20px;background:#1a3d2b;color:white}
.company-name{font-size:1.4rem;font-weight:800;font-family:Georgia,serif}
.company-sub{font-size:0.7rem;opacity:0.65;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px}
.body{padding:28px 32px}.meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px}
.box{background:#f8f5ee;padding:12px 14px;border-radius:8px}
.label{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:4px}
.footer{padding:12px 32px;background:#0f1f17;color:rgba(255,255,255,0.5);font-size:0.7rem;display:flex;justify-content:space-between}
.sig{border:1.5px dashed #ccc;border-radius:8px;height:64px;display:flex;align-items:center;justify-content:center;color:#ccc;margin-top:8px}
</style></head><body>
<div class="header"><div><div class="company-name">HUB Distribution</div><div class="company-sub">Contrôle qualité / libération de lot</div></div>
<div style="text-align:right;font-family:monospace">${checkNumber || ''}<div style="margin-top:6px">${lot.batch_number}</div></div></div>
<div class="body">
<div class="meta">
<div class="box"><div class="label">Produit</div><div>${product}</div></div>
<div class="box"><div class="label">Quantité</div><div>${lot.quantity} ${lot.product?.unit || ''}</div></div>
<div class="box"><div class="label">Décision</div><div>${cfg.label}</div></div>
<div class="box"><div class="label">Source</div><div>${SOURCE_LABEL[lot.source || 'manual']}</div></div>
<div class="box"><div class="label">Production</div><div>${formatDate(lot.production_date)}</div></div>
<div class="box"><div class="label">Péremption</div><div>${formatDate(lot.expiry_date)}</div></div>
</div>
${notes[lot.id] ? `<p style="margin:16px 0;font-size:0.9rem"><strong>Notes :</strong> ${notes[lot.id]}</p>` : ''}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px;padding-top:20px;border-top:1px solid #ddd">
<div style="text-align:center"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase">Contrôleur</div><div class="sig">Signature</div></div>
<div style="text-align:center"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase">Responsable qualité</div><div class="sig">Signature & cachet</div></div>
</div></div>
<div class="footer"><span>HUB Distribution — Brazzaville, Congo</span><span>Imprimé le ${new Date().toLocaleDateString('fr-FR')}</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 800) }
  }

  return (
    <div>
      <div className="page-header">
        <h2>🧪 Qualité / libération des lots</h2>
        <Link href="/stock/recall" className="btn-ghost" style={{ textDecoration: 'none' }}>Traçabilité →</Link>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: '#f0ece4', borderRadius: 8, padding: 4, width: 'fit-content' }}>
          {([['queue', `File d'attente (${pending.length})`], ['history', `Historique (${checks.length})`]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
              background: tab === key ? 'white' : 'transparent', color: tab === key ? 'var(--hub-green)' : '#666', boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 14, marginBottom: 28 }}>
          <div className="stat-card amber"><div className="stat-value">{pending.length}</div><div className="stat-label">En quarantaine</div></div>
          <div className="stat-card green"><div className="stat-value">{checks.filter(c => c.result === 'released').length}</div><div className="stat-label">Libérés</div></div>
          <div className="stat-card red"><div className="stat-value">{checks.filter(c => c.result === 'rejected').length}</div><div className="stat-label">Rebuts</div></div>
        </div>

        {tab === 'queue' && (
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
              <table className="hub-table">
                <thead><tr><th>N° lot</th><th>Produit</th><th>Qté</th><th>Source</th><th>Péremption</th><th></th></tr></thead>
                <tbody>
                  {pending.map(lot => (
                    <tr key={lot.id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{lot.batch_number}</td>
                      <td style={{ fontWeight: 600 }}>{lot.product?.name || '—'}</td>
                      <td>{lot.quantity} {lot.product?.unit || ''}</td>
                      <td>{SOURCE_LABEL[lot.source || 'manual']}</td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{formatDate(lot.expiry_date)}</td>
                      <td><button className="btn-primary" style={{ padding: '5px 12px', fontSize: '0.75rem' }} onClick={() => setActive(lot)}>Contrôler</button></td>
                    </tr>
                  ))}
                  {pending.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun lot en quarantaine — les réceptions et productions arriveront ici</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
              <table className="hub-table">
                <thead><tr><th>N° contrôle</th><th>Lot</th><th>Produit</th><th>Décision</th><th>Date</th><th>Notes</th></tr></thead>
                <tbody>
                  {checks.map(c => {
                    const cfg = QUALITY_LABELS[c.result]
                    const batch = Array.isArray(c.batch) ? c.batch[0] : c.batch
                    const product = Array.isArray(batch?.product) ? batch?.product[0] : batch?.product
                    return (
                      <tr key={c.id}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{c.check_number}</td>
                        <td><Link href={`/stock/recall?id=${c.batch_id}`} style={{ fontFamily: 'monospace' }}>{batch?.batch_number || '—'}</Link></td>
                        <td>{product?.name || '—'}</td>
                        <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                        <td style={{ color: '#666', fontSize: '0.85rem' }}>{formatDate(c.created_at)}</td>
                        <td style={{ color: '#555', fontSize: '0.85rem' }}>{c.notes || '—'}</td>
                      </tr>
                    )
                  })}
                  {checks.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun contrôle enregistré</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {active && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setActive(null)}>
          <div className="modal-box" style={{ maxWidth: 480 }}>
            <div className="modal-title">Contrôle {active.batch_number}</div>
            <p style={{ marginBottom: 12, color: '#555' }}>
              <strong>{active.product?.name}</strong> · {active.quantity} {active.product?.unit || ''} · {SOURCE_LABEL[active.source || 'manual']}
            </p>
            <div className="hub-form-group">
              <label>Notes (aspect, odeur, défauts…)</label>
              <textarea className="hub-input" rows={3} value={notes[active.id] || ''} onChange={e => setNotes(prev => ({ ...prev, [active.id]: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" className="btn-ghost" onClick={() => setActive(null)}>Annuler</button>
              <button type="button" className="btn-ghost" onClick={() => printCheck(active, 'pending')}>Imprimer</button>
              <button type="button" className="btn-primary" disabled={savingId === active.id} onClick={() => decide(active, 'released')}>
                {savingId === active.id ? '...' : 'Libérer'}
              </button>
              <button type="button" style={{ background: '#991b1b', color: 'white', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }}
                disabled={savingId === active.id} onClick={() => {
                  if (!confirm('Mettre ce lot au rebut ? Le stock sera sorti (quantité à 0).')) return
                  decide(active, 'rejected')
                }}>
                Rejeter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
