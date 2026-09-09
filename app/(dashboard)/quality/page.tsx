'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { QUALITY_LABELS, type QualityStatus } from '@/lib/quality/release'
import {
  CCP_SUGGESTIONS,
  COA_CONCLUSION_LABELS,
  SOURCE_TYPE_LABELS,
  computeCoaConclusion,
  isAutoOk,
  parseNumericValue,
  parseParameters,
  validateParameters,
  type CoaConclusion,
  type CoaParameter,
} from '@/lib/quality/coa'
import { generateCOAPDF, type COAPDFData } from '@/lib/pdf/generateCOAPDF'
import { getSignedPDFUrl, uploadPDF } from '@/lib/storage/uploadPDF'

type LotCore = {
  id: string
  batch_number: string
  quantity: number
  expiry_date?: string | null
  production_date?: string | null
  supplier?: string | null
  created_at: string
  product?: { name?: string; unit?: string } | null
}

type PendingLot = LotCore & { source?: string }

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

type BatchRow = LotCore & { quality_status?: QualityStatus }

type COARow = {
  id: string
  coa_number: string
  batch_id: string
  product_name?: string | null
  report_date: string
  laboratory?: string | null
  parameters?: unknown
  conclusion?: CoaConclusion | null
  notes?: string | null
  file_url?: string | null
  created_at: string
}

type CCPRow = {
  id: string
  check_number: string
  batch_id: string
  source_type: string
  ccp_name: string
  requirement: string
  measured_value?: string | null
  conform: boolean
  checked_by?: string | null
  notes?: string | null
  created_at: string
}

type ParamDraft = {
  key: number
  label: string
  value: string
  unit: string
  min: string
  max: string
  ok: boolean
  overridden: boolean
}

const SOURCE_LABEL: Record<string, string> = {
  purchase: 'Réception achat',
  production: 'Production',
  manual: 'Manuel',
}

const SOURCE_TYPE_OPTIONS = [
  ['reception', 'Réception'],
  ['production', 'Production'],
  ['stock', 'Stock'],
  ['autre', 'Autre'],
] as const

const STATUS_FILTERS: { key: 'all' | QualityStatus; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'pending', label: 'Quarantaine' },
  { key: 'released', label: 'Libérés' },
  { key: 'rejected', label: 'Rebuts' },
]

function pickOne<T>(v: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(v)) return v[0]
  return v ?? undefined
}

function errMsg(e: unknown): string {
  if (!e) return 'Erreur inconnue'
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

function parseMaybeNum(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  return parseNumericValue(t)
}

function freshParamRow(key: number): ParamDraft {
  return { key, label: '', value: '', unit: '', min: '', max: '', ok: true, overridden: false }
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('fr-FR')
}

function formatDay(value?: string | null) {
  if (!value) return '—'
  return new Date(`${value}T00:00:00`).toLocaleDateString('fr-FR')
}

function inferSource(referenceType?: string | null): 'purchase' | 'production' | 'manual' {
  if (referenceType === 'purchase') return 'purchase'
  if (referenceType === 'production') return 'production'
  return 'manual'
}

export default function QualityPage() {
  const [tab, setTab] = useState<'queue' | 'history' | 'audit'>('queue')
  const [pending, setPending] = useState<PendingLot[]>([])
  const [checks, setChecks] = useState<QualityCheckRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [active, setActive] = useState<PendingLot | null>(null)
  const supabase = createClient()
  const { toast } = useToast()

  // ── Audit : lots (tous statuts) + compteurs COA / CCP ──
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | QualityStatus>('all')
  const [coaCounts, setCoaCounts] = useState<Record<string, number>>({})
  const [ccpStats, setCcpStats] = useState<Record<string, { total: number; non: number }>>({})

  // ── Modal COA ──
  const [coaBatch, setCoaBatch] = useState<BatchRow | null>(null)
  const [coas, setCoas] = useState<COARow[]>([])
  const [coaLoading, setCoaLoading] = useState(false)
  const [coaError, setCoaError] = useState<string | null>(null)
  const [coaSaving, setCoaSaving] = useState(false)
  const [showNewCOA, setShowNewCOA] = useState(false)
  const [coaReportDate, setCoaReportDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [coaLaboratory, setCoaLaboratory] = useState('')
  const [coaNotes, setCoaNotes] = useState('')
  const [paramKeySeq, setParamKeySeq] = useState(1)
  const [draftRows, setDraftRows] = useState<ParamDraft[]>(() => [freshParamRow(0)])

  // ── Modal CCP ──
  const [ccpBatch, setCcpBatch] = useState<BatchRow | null>(null)
  const [ccps, setCcps] = useState<CCPRow[]>([])
  const [ccpLoading, setCcpLoading] = useState(false)
  const [ccpError, setCcpError] = useState<string | null>(null)
  const [ccpSaving, setCcpSaving] = useState(false)
  const [showNewCCP, setShowNewCCP] = useState(false)
  const [ccpForm, setCcpForm] = useState({
    source_type: 'reception',
    ccp_name: '',
    requirement: '',
    measured_value: '',
    conform: true,
    notes: '',
  })

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

  const loadAudit = useCallback(async () => {
    setAuditLoading(true)
    setAuditError(null)
    try {
      const { data: lots, error: lotsErr } = await supabase
        .from('product_batches')
        .select('id, batch_number, quantity, expiry_date, production_date, supplier, quality_status, created_at, product:products(name, unit)')
        .order('created_at', { ascending: false })
        .limit(300)
      if (lotsErr) throw lotsErr
      const rows = (lots || []) as BatchRow[]
      setBatches(rows)
      const ids = rows.map(b => b.id)
      const coaMap: Record<string, number> = {}
      const ccpMap: Record<string, { total: number; non: number }> = {}
      if (ids.length > 0) {
        const [{ data: coaRows }, { data: ccpRows }] = await Promise.all([
          supabase.from('quality_coa').select('batch_id').in('batch_id', ids),
          supabase.from('quality_ccp').select('batch_id, conform').in('batch_id', ids),
        ])
        for (const c of coaRows || []) {
          if (c.batch_id) coaMap[c.batch_id] = (coaMap[c.batch_id] || 0) + 1
        }
        for (const c of ccpRows || []) {
          if (!c.batch_id) continue
          const s = ccpMap[c.batch_id] || { total: 0, non: 0 }
          s.total += 1
          if (!c.conform) s.non += 1
          ccpMap[c.batch_id] = s
        }
      }
      setCoaCounts(coaMap)
      setCcpStats(ccpMap)
    } catch (e) {
      setAuditError(errMsg(e))
    } finally {
      setAuditLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'audit') loadAudit() }, [tab, loadAudit])

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
    if (tab === 'audit') loadAudit()
  }

  // ── COA : ouverture, formulaire, enregistrement ──
  function resetCoaForm() {
    setShowNewCOA(false)
    setCoaError(null)
    setCoaLaboratory('')
    setCoaNotes('')
    setCoaReportDate(new Date().toISOString().slice(0, 10))
    setDraftRows([freshParamRow(0)])
    setParamKeySeq(1)
  }

  async function openCOA(batch: BatchRow) {
    setCcpBatch(null)
    setCoaBatch(batch)
    resetCoaForm()
    setCoas([])
    setCoaLoading(true)
    try {
      const { data, error } = await supabase
        .from('quality_coa')
        .select('*')
        .eq('batch_id', batch.id)
        .order('report_date', { ascending: false })
      if (error) throw error
      setCoas((data || []) as COARow[])
    } catch (e) {
      setCoaError(errMsg(e))
    } finally {
      setCoaLoading(false)
    }
  }

  function draftToParams(rows: ParamDraft[]): CoaParameter[] {
    return rows.map(r => ({
      label: r.label.trim(),
      value: r.value.trim(),
      unit: r.unit.trim() || undefined,
      min: parseMaybeNum(r.min),
      max: parseMaybeNum(r.max),
      ok: r.ok,
    }))
  }

  function setParamField(key: number, field: 'label' | 'value' | 'unit' | 'min' | 'max', value: string) {
    setDraftRows(rows =>
      rows.map(r => {
        if (r.key !== key) return r
        const next: ParamDraft = { ...r, [field]: value, overridden: false }
        next.ok = isAutoOk(next.value, parseMaybeNum(next.min), parseMaybeNum(next.max))
        return next
      })
    )
  }

  function toggleParamOk(key: number) {
    setDraftRows(rows => rows.map(r => (r.key === key ? { ...r, ok: !r.ok, overridden: true } : r)))
  }

  function addParamRow() {
    setDraftRows(rows => [...rows, freshParamRow(paramKeySeq)])
    setParamKeySeq(s => s + 1)
  }

  function removeParamRow(key: number) {
    setDraftRows(rows => (rows.length > 1 ? rows.filter(r => r.key !== key) : rows))
  }

  function buildCOAPDFData(batch: BatchRow, coaNumber: string, reportDate: string, params: CoaParameter[], conclusion: CoaConclusion, notes?: string): COAPDFData {
    return {
      coa_number: coaNumber,
      product_name: pickOne(batch.product)?.name || '—',
      batch_number: batch.batch_number,
      expiry_date: batch.expiry_date,
      production_date: batch.production_date,
      supplier: batch.supplier,
      report_date: reportDate,
      laboratory: coaLaboratory.trim() || '—',
      parameters: params,
      conclusion,
      notes: notes || null,
    }
  }

  async function saveCOA() {
    if (!coaBatch) return
    const params = draftToParams(draftRows)
    const errs: string[] = []
    draftRows.forEach((r, i) => {
      const where = `Ligne ${i + 1} (${r.label.trim() || 'paramètre'})`
      if (r.min.trim() && parseNumericValue(r.min) === null) errs.push(`${where} : limite min « ${r.min} » non numérique.`)
      if (r.max.trim() && parseNumericValue(r.max) === null) errs.push(`${where} : limite max « ${r.max} » non numérique.`)
    })
    const vErrs = validateParameters(params)
    const allErrs = [...errs, ...vErrs]
    if (allErrs.length > 0) {
      setCoaError(allErrs.join(' '))
      return
    }
    setCoaSaving(true)
    setCoaError(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { data: num, error: numErr } = await supabase.rpc('generate_coa_number')
      if (numErr || !num) {
        setCoaError(numErr?.message || 'Numéro COA indisponible.')
        return
      }
      const conclusion = computeCoaConclusion(params)
      const { data: inserted, error: insErr } = await supabase
        .from('quality_coa')
        .insert({
          coa_number: num as string,
          batch_id: coaBatch.id,
          product_name: pickOne(coaBatch.product)?.name || null,
          report_date: coaReportDate,
          laboratory: coaLaboratory.trim() || null,
          parameters: params,
          conclusion,
          notes: coaNotes.trim() || null,
          created_by: userData.user?.id,
        })
        .select('id')
        .single()
      if (insErr || !inserted) {
        setCoaError(insErr?.message || "Erreur lors de l'enregistrement du COA.")
        return
      }

      const pdf = generateCOAPDF(buildCOAPDFData(coaBatch, num as string, coaReportDate, params, conclusion, coaNotes))
      const blob = pdf.output('blob')
      const filePath = `${coaBatch.id}/${num}.pdf`
      const { storagePath, error: upErr } = await uploadPDF('quality-coa', filePath, blob)
      if (upErr) {
        pdf.save(`${num}.pdf`)
        toast('warning', `COA enregistré mais PDF non archivé : ${upErr}`)
      } else {
        const { error: urlErr } = await supabase
          .from('quality_coa')
          .update({ file_url: `quality-coa/${storagePath}` })
          .eq('id', inserted.id)
        if (urlErr) {
          pdf.save(`${num}.pdf`)
          toast('warning', `COA enregistré mais lien PDF non mis à jour : ${urlErr.message}`)
        } else {
          pdf.save(`${num}.pdf`)
          toast('success', `Certificat ${num} généré et archivé.`)
        }
      }
      resetCoaForm()
      await openCOA(coaBatch)
      if (tab === 'audit') loadAudit()
    } catch (e) {
      setCoaError(errMsg(e))
    } finally {
      setCoaSaving(false)
    }
  }

  function regenerateCOAPDF(coa: COARow) {
    if (!coaBatch) return
    const params = parseParameters(coa.parameters)
    const conclusion = coa.conclusion === 'conforme' || coa.conclusion === 'non_conforme'
      ? coa.conclusion
      : computeCoaConclusion(params)
    const pdf = generateCOAPDF({
      coa_number: coa.coa_number,
      product_name: coa.product_name || pickOne(coaBatch.product)?.name || '—',
      batch_number: coaBatch.batch_number,
      expiry_date: coaBatch.expiry_date,
      production_date: coaBatch.production_date,
      supplier: coaBatch.supplier,
      report_date: coa.report_date,
      laboratory: coa.laboratory || '—',
      parameters: params,
      conclusion,
      notes: coa.notes,
    })
    pdf.save(`${coa.coa_number}.pdf`)
  }

  async function openStoredCOA(coa: COARow) {
    if (!coa.file_url) {
      toast('error', 'Aucun PDF archivé pour ce certificat.')
      return
    }
    const parts = coa.file_url.split('/')
    const bucket = parts[0]
    const path = parts.slice(1).join('/')
    const url = await getSignedPDFUrl(bucket, path)
    if (url) window.open(url, '_blank')
    else toast('error', 'Impossible de récupérer le PDF archivé.')
  }

  // ── CCP : ouverture, formulaire, enregistrement ──
  function resetCcpForm() {
    setShowNewCCP(false)
    setCcpError(null)
    setCcpForm({ source_type: 'reception', ccp_name: '', requirement: '', measured_value: '', conform: true, notes: '' })
  }

  async function openCCP(batch: BatchRow) {
    setCoaBatch(null)
    setCcpBatch(batch)
    resetCcpForm()
    setCcps([])
    setCcpLoading(true)
    try {
      const { data, error } = await supabase
        .from('quality_ccp')
        .select('*')
        .eq('batch_id', batch.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      setCcps((data || []) as CCPRow[])
    } catch (e) {
      setCcpError(errMsg(e))
    } finally {
      setCcpLoading(false)
    }
  }

  async function saveCCP() {
    if (!ccpBatch) return
    if (!ccpForm.ccp_name.trim()) {
      setCcpError('Le nom du point de contrôle est requis.')
      return
    }
    if (!ccpForm.requirement.trim()) {
      setCcpError('La spécification / exigence est requise.')
      return
    }
    setCcpSaving(true)
    setCcpError(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { data: num, error: numErr } = await supabase.rpc('generate_quality_ccp_number')
      if (numErr || !num) {
        setCcpError(numErr?.message || 'Numéro CCP indisponible.')
        return
      }
      const { error: insErr } = await supabase.from('quality_ccp').insert({
        check_number: num as string,
        batch_id: ccpBatch.id,
        source_type: ccpForm.source_type,
        ccp_name: ccpForm.ccp_name.trim(),
        requirement: ccpForm.requirement.trim(),
        measured_value: ccpForm.measured_value.trim() || null,
        conform: ccpForm.conform,
        checked_by: userData.user?.id,
        notes: ccpForm.notes.trim() || null,
      })
      if (insErr) {
        setCcpError(insErr.message)
        return
      }
      toast('success', ccpForm.conform ? 'Contrôle CCP conforme enregistré.' : 'Contrôle CCP non conforme enregistré.')
      resetCcpForm()
      await openCCP(ccpBatch)
      if (tab === 'audit') loadAudit()
    } catch (e) {
      setCcpError(errMsg(e))
    } finally {
      setCcpSaving(false)
    }
  }

  function printCheck(lot: PendingLot, result: string, checkNumber?: string) {
    const product = pickOne(lot.product)?.name || '—'
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
<div class="box"><div class="label">Quantité</div><div>${lot.quantity} ${pickOne(lot.product)?.unit || ''}</div></div>
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

  const filteredBatches = batches.filter(b => statusFilter === 'all' || b.quality_status === statusFilter)
  const totalCoa = filteredBatches.reduce((acc, b) => acc + (coaCounts[b.id] || 0), 0)
  const totalCcp = filteredBatches.reduce((acc, b) => acc + (ccpStats[b.id]?.total || 0), 0)
  const totalCcpNon = filteredBatches.reduce((acc, b) => acc + (ccpStats[b.id]?.non || 0), 0)
  const coaNonConform = coas.filter(c => c.conclusion === 'non_conforme').length
  const nonConformCCPs = ccps.filter(c => !c.conform)

  return (
    <div>
      <div className="page-header">
        <h2>🧪 Qualité / libération des lots</h2>
        <Link href="/stock/recall" className="btn-ghost" style={{ textDecoration: 'none' }}>Traçabilité →</Link>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: '#f0ece4', borderRadius: 8, padding: 4, width: 'fit-content', flexWrap: 'wrap' }}>
          {([['queue', `File d'attente (${pending.length})`], ['history', `Historique (${checks.length})`], ['audit', 'Audit — COA & CCP']] as const).map(([key, label]) => (
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
          {tab === 'audit' && (
            <>
              <div className="stat-card green"><div className="stat-value">{totalCoa}</div><div className="stat-label">COA émis</div></div>
              <div className="stat-card blue"><div className="stat-value">{totalCcp}</div><div className="stat-label">Contrôles CCP</div></div>
              <div className="stat-card red"><div className="stat-value">{totalCcpNon}</div><div className="stat-label">CCP non conformes</div></div>
            </>
          )}
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
                      <td style={{ fontWeight: 600 }}>{pickOne(lot.product)?.name || '—'}</td>
                      <td>{lot.quantity} {pickOne(lot.product)?.unit || ''}</td>
                      <td>{SOURCE_LABEL[lot.source || 'manual']}</td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{formatDate(lot.expiry_date)}</td>
                      <td>
                        <button className="btn-primary" style={{ padding: '5px 12px', fontSize: '0.75rem' }} onClick={() => setActive(lot)}>Contrôler</button>
                      </td>
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
                    const batch = pickOne(c.batch)
                    const product = pickOne(batch?.product)
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

        {tab === 'audit' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <p style={{ color: '#666', fontSize: '0.9rem', margin: 0 }}>
                Certificats d'analyse (COA) et points critiques HACCP (CCP) par lot — tous statuts qualité.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {STATUS_FILTERS.map(f => (
                  <button key={f.key} onClick={() => setStatusFilter(f.key)}
                    style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #e0dbd0', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                      background: statusFilter === f.key ? 'var(--hub-green)' : 'white', color: statusFilter === f.key ? 'white' : '#555' }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {auditError && <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '0.85rem' }}>⚠ {auditError}</div>}

            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              {auditLoading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
                <table className="hub-table">
                  <thead><tr><th>N° lot</th><th>Produit</th><th>Qté</th><th>Statut</th><th>COA</th><th>CCP</th><th></th></tr></thead>
                  <tbody>
                    {filteredBatches.map(b => {
                      const cfg = QUALITY_LABELS[b.quality_status || 'released']
                      const nCoa = coaCounts[b.id] || 0
                      const sCcp = ccpStats[b.id]
                      const blocked = b.quality_status === 'pending' && (sCcp?.non || 0) > 0
                      return (
                        <tr key={b.id} style={blocked ? { background: '#fff7ed' } : undefined}>
                          <td><Link href={`/stock/recall?id=${b.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, textDecoration: 'none' }}>{b.batch_number}</Link></td>
                          <td style={{ fontWeight: 600 }}>{pickOne(b.product)?.name || '—'}</td>
                          <td>{b.quantity} {pickOne(b.product)?.unit || ''}</td>
                          <td>
                            <span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span>
                            {blocked && <span className="badge badge-red" style={{ marginLeft: 6 }}>⚠ bloquer libération</span>}
                          </td>
                          <td style={{ fontSize: '0.85rem' }}>{nCoa > 0 ? `📄 ${nCoa} certif.` : '—'}</td>
                          <td style={{ fontSize: '0.85rem' }}>
                            {sCcp?.total ? `${sCcp.total} contr.` : '—'}
                            {sCcp?.non ? <span style={{ color: '#991b1b', fontWeight: 700 }}> ({sCcp.non} non conf.)</span> : null}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => openCOA(b)}>🧪 COA</button>
                              <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => openCCP(b)}>⚠️ CCP</button>
                              {b.quality_status === 'pending' && (
                                <button className="btn-primary" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => setActive(b as PendingLot)}>Contrôler</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {filteredBatches.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun lot trouvé</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Modal libération / rejet (existant) ── */}
      {active && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setActive(null)}>
          <div className="modal-box" style={{ maxWidth: 480 }}>
            <div className="modal-title">Contrôle {active.batch_number}</div>
            <p style={{ marginBottom: 12, color: '#555' }}>
              <strong>{pickOne(active.product)?.name}</strong> · {active.quantity} {pickOne(active.product)?.unit || ''} · {SOURCE_LABEL[active.source || 'manual']}
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

      {/* ── Modal COA ── */}
      {coaBatch && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setCoaBatch(null)}>
          <div className="modal-box" style={{ maxWidth: 780 }}>
            <div className="modal-title">🧪 COA — Certificat d'analyse · {coaBatch.batch_number}</div>
            <p style={{ marginBottom: 14, color: '#555' }}>
              <strong>{pickOne(coaBatch.product)?.name}</strong> · {coaBatch.quantity} {pickOne(coaBatch.product)?.unit || ''} ·{' '}
              <span className={`badge ${QUALITY_LABELS[coaBatch.quality_status || 'released'].badge}`}>
                {QUALITY_LABELS[coaBatch.quality_status || 'released'].label}
              </span>
            </p>

            {coaError && <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '0.85rem' }}>⚠ {coaError}</div>}

            {coaLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>Chargement des certificats...</div>
            ) : (
              <>
                {coas.length > 0 && (
                  <table className="hub-table" style={{ marginBottom: 16 }}>
                    <thead><tr><th>N° COA</th><th>Laboratoire</th><th>Date</th><th>Conclusion</th><th></th></tr></thead>
                    <tbody>
                      {coas.map(c => {
                        const cfg = COA_CONCLUSION_LABELS[c.conclusion || 'non_conforme']
                        return (
                          <tr key={c.id}>
                            <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{c.coa_number}</td>
                            <td>{c.laboratory || '—'}</td>
                            <td style={{ color: '#666', fontSize: '0.85rem' }}>{formatDay(c.report_date)}</td>
                            <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                            <td>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                {c.file_url && (
                                  <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => openStoredCOA(c)}>📄 Voir PDF</button>
                                )}
                                <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => regenerateCOAPDF(c)}>⬇️ PDF</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
                {coas.length === 0 && !showNewCOA && (
                  <p style={{ color: '#999', fontSize: '0.9rem', marginBottom: 16 }}>Aucun certificat d'analyse pour ce lot.</p>
                )}

                {!showNewCOA ? (
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                    <button type="button" className="btn-ghost" onClick={() => setCoaBatch(null)}>Fermer</button>
                    <button type="button" className="btn-primary" onClick={() => { setShowNewCOA(true); setCoaError(null) }}>+ Nouveau COA</button>
                  </div>
                ) : (
                  <>
                    <div style={{ borderTop: '1px solid #e8e4db', paddingTop: 18 }}>
                      <div style={{ fontWeight: 700, color: 'var(--hub-green)', marginBottom: 12 }}>Nouveau certificat d'analyse</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                        <div className="hub-form-group">
                          <label>Date du rapport</label>
                          <input type="date" className="hub-input" value={coaReportDate} onChange={e => setCoaReportDate(e.target.value)} />
                        </div>
                        <div className="hub-form-group">
                          <label>Laboratoire</label>
                          <input className="hub-input" placeholder="Ex. Labo QualiSud Brazzaville" value={coaLaboratory} onChange={e => setCoaLaboratory(e.target.value)} />
                        </div>
                      </div>

                      <div style={{ fontWeight: 700, marginBottom: 8 }}>Paramètres d'analyse</div>
                      {draftRows.map((r, idx) => (
                        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.9fr 0.6fr 0.7fr 0.7fr auto auto', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                          <input className="hub-input" style={{ fontSize: '0.8rem' }} placeholder="Paramètre (ex. Température)" value={r.label}
                            onChange={e => setParamField(r.key, 'label', e.target.value)} />
                          <input className="hub-input" style={{ fontSize: '0.8rem' }} placeholder="Valeur" value={r.value}
                            onChange={e => setParamField(r.key, 'value', e.target.value)} />
                          <input className="hub-input" style={{ fontSize: '0.8rem' }} placeholder="Unité" value={r.unit}
                            onChange={e => setParamField(r.key, 'unit', e.target.value)} />
                          <input className="hub-input" style={{ fontSize: '0.8rem' }} placeholder="Min" value={r.min}
                            onChange={e => setParamField(r.key, 'min', e.target.value)} />
                          <input className="hub-input" style={{ fontSize: '0.8rem' }} placeholder="Max" value={r.max}
                            onChange={e => setParamField(r.key, 'max', e.target.value)} />
                          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            title={r.overridden ? 'Conformité saisie manuellement' : 'Conformité calculée automatiquement selon min/max'}>
                            <input type="checkbox" checked={r.ok} onChange={() => toggleParamOk(r.key)} />
                            Conforme
                          </label>
                          <button type="button" onClick={() => removeParamRow(r.key)} disabled={draftRows.length <= 1}
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: draftRows.length <= 1 ? '#ccc' : '#991b1b', fontSize: '1rem' }}>✕</button>
                        </div>
                      ))}
                      <button type="button" className="btn-ghost" style={{ fontSize: '0.8rem', padding: '6px 12px' }} onClick={addParamRow}>+ Ajouter un paramètre</button>

                      <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: '#f8f5ee', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <span>Conclusion automatique : <strong>{computeCoaConclusion(draftToParams(draftRows)) === 'conforme' ? '✅ Conforme' : '❌ Non conforme'}</strong></span>
                        {computeCoaConclusion(draftToParams(draftRows)) === 'non_conforme' && (
                          <span style={{ color: '#991b1b', fontWeight: 600 }}>Le certificat bloquera la libération du lot</span>
                        )}
                      </div>

                      <div className="hub-form-group" style={{ marginTop: 14 }}>
                        <label>Notes</label>
                        <textarea className="hub-input" rows={2} placeholder="Remarques, méthode, observations…" value={coaNotes} onChange={e => setCoaNotes(e.target.value)} />
                      </div>

                      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                        <button type="button" className="btn-ghost" disabled={coaSaving} onClick={() => resetCoaForm()}>Annuler</button>
                        <button type="button" className="btn-primary" disabled={coaSaving} onClick={saveCOA}>
                          {coaSaving ? 'Génération...' : 'Générer & archiver le COA'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Modal CCP ── */}
      {ccpBatch && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setCcpBatch(null)}>
          <div className="modal-box" style={{ maxWidth: 720 }}>
            <div className="modal-title">⚠️ CCP — Points critiques HACCP · {ccpBatch.batch_number}</div>
            <p style={{ marginBottom: 12, color: '#555' }}>
              <strong>{pickOne(ccpBatch.product)?.name}</strong> · {ccpBatch.quantity} {pickOne(ccpBatch.product)?.unit || ''} ·{' '}
              <span className={`badge ${QUALITY_LABELS[ccpBatch.quality_status || 'released'].badge}`}>
                {QUALITY_LABELS[ccpBatch.quality_status || 'released'].label}
              </span>
            </p>

            {ccpBatch.quality_status === 'pending' && nonConformCCPs.length > 0 && (
              <div style={{ background: '#fff7ed', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '0.88rem', fontWeight: 600 }}>
                ⚠ Contrôle non conforme — bloquer la libération : ce lot ne doit pas être libéré tant que le point critique n'est pas maîtrisé.
              </div>
            )}

            {ccpError && <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '0.85rem' }}>⚠ {ccpError}</div>}

            {ccpLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>Chargement des contrôles...</div>
            ) : (
              <>
                {ccps.length > 0 && (
                  <table className="hub-table" style={{ marginBottom: 16 }}>
                    <thead><tr><th>N°</th><th>Source</th><th>Point critique</th><th>Exigence</th><th>Mesuré</th><th>Résultat</th><th>Date</th></tr></thead>
                    <tbody>
                      {ccps.map(c => (
                        <tr key={c.id} style={!c.conform ? { background: '#fef2f2' } : undefined}>
                          <td style={{ fontFamily: 'monospace', fontWeight: 700, color: !c.conform ? '#991b1b' : undefined }}>{c.check_number}</td>
                          <td style={{ fontSize: '0.85rem' }}>{SOURCE_TYPE_LABELS[c.source_type] || c.source_type}</td>
                          <td style={{ fontWeight: 600 }}>{c.ccp_name}</td>
                          <td style={{ fontSize: '0.85rem' }}>{c.requirement}</td>
                          <td style={{ fontSize: '0.85rem' }}>{c.measured_value || '—'}</td>
                          <td>
                            {c.conform
                              ? <span className="badge badge-green">✅ Conforme</span>
                              : <span className="badge badge-red">❌ Non conforme</span>}
                          </td>
                          <td style={{ color: '#666', fontSize: '0.8rem' }}>{formatDate(c.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {ccps.length === 0 && !showNewCCP && (
                  <p style={{ color: '#999', fontSize: '0.9rem', marginBottom: 16 }}>Aucun contrôle CCP enregistré pour ce lot.</p>
                )}

                {!showNewCCP ? (
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                    <button type="button" className="btn-ghost" onClick={() => setCcpBatch(null)}>Fermer</button>
                    <button type="button" className="btn-primary" onClick={() => { setShowNewCCP(true); setCcpError(null) }}>+ Ajouter un contrôle</button>
                  </div>
                ) : (
                  <div style={{ borderTop: '1px solid #e8e4db', paddingTop: 18 }}>
                    <div style={{ fontWeight: 700, color: 'var(--hub-green)', marginBottom: 12 }}>Nouveau contrôle CCP</div>
                    <datalist id="ccp-suggestions">
                      {CCP_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                    </datalist>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                      <div className="hub-form-group">
                        <label>Source du contrôle</label>
                        <select className="hub-select" value={ccpForm.source_type}
                          onChange={e => setCcpForm(f => ({ ...f, source_type: e.target.value }))}>
                          {SOURCE_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <div className="hub-form-group">
                        <label>Point critique (CCP)</label>
                        <input className="hub-input" list="ccp-suggestions" placeholder="Ex. Température de réception" value={ccpForm.ccp_name}
                          onChange={e => setCcpForm(f => ({ ...f, ccp_name: e.target.value }))} />
                      </div>
                      <div className="hub-form-group">
                        <label>Exigence / spécification</label>
                        <input className="hub-input" placeholder="Ex. ≤ 8 °C" value={ccpForm.requirement}
                          onChange={e => setCcpForm(f => ({ ...f, requirement: e.target.value }))} />
                      </div>
                      <div className="hub-form-group">
                        <label>Valeur mesurée</label>
                        <input className="hub-input" placeholder="Ex. 5,2" value={ccpForm.measured_value}
                          onChange={e => setCcpForm(f => ({ ...f, measured_value: e.target.value }))} />
                      </div>
                      <div className="hub-form-group">
                        <label>Conformité</label>
                        <div style={{ display: 'flex', gap: 16, paddingTop: 6 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input type="radio" name="ccp-conform" checked={ccpForm.conform}
                              onChange={() => setCcpForm(f => ({ ...f, conform: true }))} /> Conforme
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input type="radio" name="ccp-conform" checked={!ccpForm.conform}
                              onChange={() => setCcpForm(f => ({ ...f, conform: false }))} /> Non conforme
                          </label>
                        </div>
                      </div>
                      <div className="hub-form-group">
                        <label>Notes</label>
                        <input className="hub-input" placeholder="Observations…" value={ccpForm.notes}
                          onChange={e => setCcpForm(f => ({ ...f, notes: e.target.value }))} />
                      </div>
                    </div>
                    {!ccpForm.conform && (
                      <div style={{ background: '#fff7ed', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: '0.82rem' }}>
                        ⚠ Contrôle non conforme — bloquer la libération : un CCP non conforme empêche la libération du lot (si en quarantaine).
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
                      <button type="button" className="btn-ghost" disabled={ccpSaving} onClick={() => resetCcpForm()}>Annuler</button>
                      <button type="button" className="btn-primary" disabled={ccpSaving} onClick={saveCCP}>
                        {ccpSaving ? 'Enregistrement...' : 'Enregistrer le contrôle'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
