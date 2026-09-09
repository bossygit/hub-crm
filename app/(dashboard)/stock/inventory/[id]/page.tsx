'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { inventoryVariance, packsForProduct, toBaseQty, unitsForProduct, type ProductPack } from '@/lib/stock/units'
import { canRevealGaps, hasRevealedGaps, hasUncountedLines, isBlindSession, masksTheoretical } from '@/lib/stock/inventoryBlind'
import { useUserRole } from '@/lib/hooks/useUserRole'

type PackRow = ProductPack & { product_id: string }

export default function InventorySessionPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()
  const [session, setSession] = useState<any>(null)
  const [lines, setLines] = useState<any[]>([])
  const [packs, setPacks] = useState<PackRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const { loading: roleLoading, isManager } = useUserRole()

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: l }, { data: u }] = await Promise.all([
      supabase.from('inventory_sessions').select('*').eq('id', id).single(),
      supabase.from('inventory_lines').select('*').eq('session_id', id).order('sort_order'),
      supabase.from('product_units').select('product_id, unit, factor'),
    ])
    setSession(s)
    setLines(l || [])
    setPacks((u || []) as PackRow[])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const editable = session?.status === 'draft'
  const blind = isBlindSession(session)
  const masked = masksTheoretical(session)
  const summary = useMemo(() => {
    if (masked) {
      return { lines: lines.length, gaps: null, plus: null, minus: null }
    }
    const variances = lines.map(l => inventoryVariance(Number(l.theoretical), Number(l.counted)))
    return {
      lines: lines.length,
      gaps: variances.filter(v => v !== 0).length,
      plus: variances.filter(v => v > 0).reduce((s, v) => s + v, 0),
      minus: variances.filter(v => v < 0).reduce((s, v) => s + v, 0),
    }
  }, [lines, masked])

  function updateLine(idx: number, field: 'entry_quantity' | 'entry_unit', value: string | number) {
    setLines(prev => {
      const next = [...prev]
      const line = { ...next[idx], [field]: value }
      const productPacks = packsForProduct(line.product_id, packs)
      line.counted = toBaseQty(Number(line.entry_quantity) || 0, line.entry_unit || line.unit, line.unit, productPacks)
      next[idx] = line
      return next
    })
  }

  async function saveLines() {
    for (const line of lines) {
      const { error } = await supabase.from('inventory_lines').update({
        counted: line.counted,
        entry_quantity: line.entry_quantity,
        entry_unit: line.entry_unit,
      }).eq('id', line.id)
      if (error) throw new Error(error.message)
    }
  }

  async function validate() {
    if (!confirm('Valider cet inventaire ? Les écarts ajusteront le stock.')) return
    if (blind && hasUncountedLines(lines)) {
      toast('warning', 'Comptage à l’aveugle : chaque ligne doit être réellement comptée avant validation.')
      setErrorMsg('Lignes encore vides : saisissez le réel partout (0 si le produit est absent) avant de valider.')
      return
    }
    setSaving(true)
    setErrorMsg('')
    try {
      await saveLines()
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await supabase.from('inventory_sessions').update({
        status: 'approved',
        validated_by: userData.user?.id,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) throw new Error(error.message)
      toast('success', 'Inventaire validé, stock ajusté.')
      load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      toast('error', msg)
    } finally { setSaving(false) }
  }

  async function revealGaps() {
    if (!confirm('Afficher les écarts ? Les quantités théoriques et les écarts deviendront visibles pour l’équipe (comptage à l’aveugle levé).')) return
    setRevealing(true)
    setErrorMsg('')
    try {
      const { error } = await supabase.from('inventory_sessions').update({
        revealed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', id).eq('status', 'draft')
      if (error) throw new Error(error.message)
      toast('success', 'Écarts dévoilés.')
      load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      toast('error', msg)
    } finally { setRevealing(false) }
  }

  async function cancel() {
    if (!confirm('Annuler ce comptage ?')) return
    await supabase.from('inventory_sessions').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id)
    router.push('/stock/inventory')
  }

  function printSheet() {
    if (!session) return
    const blindSheet = masked
    const head = blindSheet
      ? '<tr><th>Produit</th><th>Lot</th><th>Réel (à renseigner)</th></tr>'
      : '<tr><th>Produit</th><th>Lot</th><th>Théorique</th><th>Réel</th><th>Écart</th></tr>'
    const body = lines.map(l => {
      if (blindSheet) {
        return `<tr><td>${l.name}</td><td>${l.batch_number || 'Hors lot'}</td><td></td></tr>`
      }
      const v = inventoryVariance(Number(l.theoretical), Number(l.counted))
      return `<tr><td>${l.name}</td><td>${l.batch_number || 'Hors lot'}</td><td>${l.theoretical} ${l.unit}</td><td>${l.counted} ${l.unit}</td><td>${v > 0 ? '+' : ''}${v}</td></tr>`
    }).join('')
    const note = blindSheet
      ? '<div style="margin:10px 2px 14px;font-weight:700;color:#92400e">🔒 Comptage à l’aveugle — quantités théoriques masquées</div>'
      : ''
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${session.session_number}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a}
@page{margin:15mm 18mm;size:A4}table{width:100%;border-collapse:collapse;font-size:0.85rem}
th{text-align:left;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:#888;border-bottom:2px solid #e8e4db;padding:8px 6px}
td{padding:8px 6px;border-bottom:1px solid #f0ece4}
.header{display:flex;justify-content:space-between;padding:24px 32px 20px;background:#1a3d2b;color:white}
.body{padding:28px 32px}.footer{padding:12px 32px;background:#0f1f17;color:rgba(255,255,255,0.5);font-size:0.7rem;display:flex;justify-content:space-between}
</style></head><body>
<div class="header"><div><div style="font-size:1.4rem;font-weight:800;font-family:Georgia,serif">HUB Distribution</div>
<div style="font-size:0.7rem;opacity:0.65;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px">Inventaire physique</div></div>
<div style="font-family:monospace">${session.session_number}</div></div>
<div class="body">${note}
<table><thead>${head}</thead><tbody>${body}
</tbody></table></div>
<div class="footer"><span>HUB Distribution — Brazzaville, Congo</span><span>Imprimé le ${new Date().toLocaleDateString('fr-FR')}</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 800) }
  }

  if (loading) return <div style={{ padding: 48, color: '#999' }}>Chargement...</div>
  if (!session) return <div style={{ padding: 48 }}>Séance introuvable. <Link href="/stock/inventory">Retour</Link></div>

  return (
    <div>
      <div className="page-header">
        <h2>📋 {session.session_number}</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/stock/inventory" className="btn-ghost" style={{ textDecoration: 'none' }}>← Liste</Link>
          <button className="btn-ghost" onClick={printSheet}>Imprimer</button>
          {editable && canRevealGaps(session) && !roleLoading && isManager() && (
            <button className="btn-ghost" disabled={revealing} onClick={revealGaps}>{revealing ? '...' : '🔓 Afficher les écarts'}</button>
          )}
          {editable && <button className="btn-ghost" onClick={cancel}>Annuler</button>}
          {editable && <button className="btn-primary" disabled={saving} onClick={validate}>{saving ? '...' : 'Valider l’inventaire'}</button>}
        </div>
      </div>
      <div style={{ padding: '24px 32px' }}>
        {blind && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, borderRadius: 10,
            padding: '10px 16px', fontSize: '0.9rem', fontWeight: 700,
            background: masked ? '#fff7ed' : hasRevealedGaps(session) ? '#ecfdf5' : '#fef2f2',
            border: masked ? '1px solid #fed7aa' : hasRevealedGaps(session) ? '1px solid #a7f3d0' : '1px solid #fecaca',
            color: masked ? '#92400e' : hasRevealedGaps(session) ? '#065f46' : '#991b1b',
          }}>
            {masked ? '🔒 Comptage à l’aveugle — valeurs théoriques masquées'
              : hasRevealedGaps(session) ? '🔓 Comptage à l’aveugle levé — théorique et écarts visibles'
              : '🔒 Comptage à l’aveugle clôturé sans révélation — écarts définitifs enregistrés au stock.'}
          </div>
        )}
        {errorMsg && (
          <p style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 18, fontSize: '0.85rem' }}>
            {errorMsg}
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14, marginBottom: 24 }}>
          <div className="stat-card"><div className="stat-value">{summary.lines}</div><div className="stat-label">Lignes</div></div>
          <div className="stat-card amber"><div className="stat-value">{masked ? '🔒' : summary.gaps}</div><div className="stat-label">Écarts</div></div>
          <div className="stat-card green"><div className="stat-value">{masked ? '🔒' : `+${summary.plus}`}</div><div className="stat-label">Surplus</div></div>
          <div className="stat-card red"><div className="stat-value">{masked ? '🔒' : summary.minus}</div><div className="stat-label">Manquants</div></div>
        </div>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          <table className="hub-table">
            <thead><tr><th>Produit</th><th>Lot</th>{!masked && <th>Théorique</th>}<th>Réel</th><th>Unité saisie</th>{!masked && <th>Écart (base)</th>}</tr></thead>
            <tbody>
              {lines.map((line, idx) => {
                const productPacks = packsForProduct(line.product_id, packs)
                const units = unitsForProduct(line.unit, productPacks)
                const v = masked ? 0 : inventoryVariance(Number(line.theoretical), Number(line.counted))
                return (
                  <tr key={line.id} style={masked ? undefined : { background: v !== 0 ? '#fffbeb' : undefined }}>
                    <td style={{ fontWeight: 600 }}>{line.name}</td>
                    <td style={{ fontFamily: 'monospace' }}>{line.batch_number || <span style={{ color: '#888' }}>Hors lot</span>}</td>
                    {!masked && <td>{line.theoretical} {line.unit}</td>}
                    <td>
                      {editable ? (
                        <input className="hub-input" type="number" min={0} step="0.01" style={{ width: 110 }}
                          placeholder={masked ? 'Réel' : undefined}
                          value={line.entry_quantity ?? (blind ? '' : line.counted)}
                          onChange={e => updateLine(idx, 'entry_quantity', parseFloat(e.target.value) || 0)} />
                      ) : `${line.counted} ${line.unit}`}
                    </td>
                    <td>
                      {editable ? (
                        <select className="hub-select" value={line.entry_unit || line.unit} onChange={e => updateLine(idx, 'entry_unit', e.target.value)}>
                          {units.map(u => <option key={u}>{u}</option>)}
                        </select>
                      ) : (line.entry_unit || line.unit)}
                    </td>
                    {!masked && (
                      <td style={{ fontWeight: 700, color: v > 0 ? '#065f46' : v < 0 ? '#991b1b' : '#666' }}>
                        {v > 0 ? '+' : ''}{v} {line.unit}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
