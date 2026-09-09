'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { generateGeneralDocumentPDF, type GeneralDocumentPDFData } from '@/lib/pdf/generateGeneralDocumentPDF'
import { uploadPDF, getSignedPDFUrl } from '@/lib/storage/uploadPDF'
import { useToast } from '@/components/ui/Toast'
import type { Client } from '@/types'

// ─────────────────────────────────────────────────────────────
// Module DOCUMENTS GÉNÉRAUX — registre + PDF réels + cycle de vie.
// Catégories stockées dans documents.doc_category (le CHECK historique de
// documents.type ne couvrant pas ces catégories) ; documents.type reçoit une
// valeur autorisée ('document_administratif' | 'autre').
// Référence DOC-YYYY-XXXX : RPC gen_document_ref_doc() (voir
// supabase/fix-documents-register.sql).
// ─────────────────────────────────────────────────────────────

interface CatDef {
  value: string
  label: string
  icon: string
  storeType: 'document_administratif' | 'autre'
}

const CATEGORIES: CatDef[] = [
  { value: 'lettre', label: 'Lettre', icon: '✉️', storeType: 'document_administratif' },
  { value: 'note_de_service', label: 'Note de service', icon: '📢', storeType: 'document_administratif' },
  { value: 'proces_verbal', label: 'Procès-verbal', icon: '📝', storeType: 'document_administratif' },
  { value: 'rapport', label: 'Rapport', icon: '📊', storeType: 'document_administratif' },
  { value: 'convention', label: 'Convention', icon: '🤝', storeType: 'document_administratif' },
  { value: 'document_administratif', label: 'Document administratif', icon: '🏛️', storeType: 'document_administratif' },
  { value: 'autre', label: 'Autre', icon: '📄', storeType: 'autre' },
]

// Catégories héritées de l'ancien registre (avant documents.doc_category) :
// le module continue de les afficher pour ne rien perdre.
const LEGACY_CATS: Record<string, { label: string; icon: string }> = {
  attestation: { label: 'Attestation', icon: '📋' },
  contrat: { label: 'Contrat', icon: '✍️' },
  document_rh: { label: 'Document RH', icon: '👥' },
  document_administratif: { label: 'Document administratif', icon: '🏛️' },
  autre: { label: 'Autre', icon: '📄' },
}

const statusBadge: Record<string, string> = {
  draft: 'badge-gray',
  generated: 'badge-blue',
  sent: 'badge-green',
  pending: 'badge-amber',
  approved: 'badge-green',
}

const statusLabels: Record<string, string> = {
  draft: 'Brouillon',
  generated: 'Généré',
  sent: 'Envoyé',
  pending: 'En attente',
  approved: 'Approuvé',
  converted: 'Converti',
  rejected: 'Refusé',
}

interface GeneralDocRow {
  id: string
  reference: string
  title: string
  type: string
  status: string
  doc_category?: string | null
  object?: string | null
  body?: string | null
  doc_date?: string | null
  entity_type?: string | null
  entity_id?: string | null
  client_id?: string | null
  content?: Record<string, unknown> | null
  file_url?: string | null
  signed_by?: string | null
  generated_at?: string | null
  archived_at?: string | null
  created_at: string
  client?: { id: string; name: string; type: string } | null
}

interface EmpLite {
  id: string
  full_name: string
  position: string | null
}

type EntityKind = 'none' | 'client' | 'employee'

interface FormState {
  title: string
  category: string
  object: string
  doc_date: string
  entity_type: EntityKind
  client_id: string
  employee_id: string
  body: string
  signed_by: string
}

const todayISO = () => new Date().toISOString().slice(0, 10)

const emptyForm = (): FormState => ({
  title: '',
  category: 'lettre',
  object: '',
  doc_date: todayISO(),
  entity_type: 'none',
  client_id: '',
  employee_id: '',
  body: '',
  signed_by: '',
})

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message?: unknown }).message ?? e)
  return String(e)
}

function isArchived(d: GeneralDocRow): boolean {
  return !!d.archived_at
}

function dateFR(d: string | Date): string {
  const date = new Date(d)
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function splitFileUrl(fileUrl: string): { bucket: string; path: string } {
  const idx = fileUrl.indexOf('/')
  if (idx === -1) return { bucket: 'general-documents', path: fileUrl }
  return { bucket: fileUrl.slice(0, idx), path: fileUrl.slice(idx + 1) }
}

function slugRef(reference: string): string {
  return (reference || 'DOC').replace(/[^A-Za-z0-9_-]/g, '_')
}

export default function DocumentsPage() {
  const supabase = createClient()
  const { toast } = useToast()

  const [rows, setRows] = useState<GeneralDocRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [employees, setEmployees] = useState<EmpLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showArchived, setShowArchived] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      // Registre = documents généraux : nouvelle catégorie OU famille
      // administrative héritée. Les devis / BL / factures des autres modules
      // (type devis, bon_livraison…) restent exclus.
      const [docsRes, clsRes, empRes] = await Promise.all([
        supabase
          .from('documents')
          .select('*, client:clients(id, name, type)')
          .or('doc_category.not.is.null,type.in.(document_administratif,document_rh,attestation,contrat,autre)')
          .order('created_at', { ascending: false }),
        supabase.from('clients').select('id, name, type, created_at').order('name'),
        supabase.from('employees').select('id, full_name, position').order('full_name'),
      ])
      if (docsRes.error) throw docsRes.error
      if (clsRes.error) throw clsRes.error
      if (empRes.error) throw empRes.error
      setRows((docsRes.data as GeneralDocRow[]) || [])
      setClients((clsRes.data as Client[]) || [])
      setEmployees((empRes.data as EmpLite[]) || [])
    } catch (e) {
      const msg = errMsg(e)
      const hint = /doc_category|column .* does not exist/.test(msg)
        ? ' — Exécutez d\u2019abord supabase/fix-documents-register.sql dans le SQL Editor Supabase.'
        : ''
      setError(msg + hint)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // ── Résolution des libellés ──
  const catDefFor = (d: GeneralDocRow): CatDef => {
    if (d.doc_category) {
      const found = CATEGORIES.find(c => c.value === d.doc_category)
      if (found) return found
    }
    const legacy = LEGACY_CATS[d.type] || LEGACY_CATS.autre
    return { value: d.type, label: legacy.label, icon: legacy.icon, storeType: 'document_administratif' }
  }

  const destNameFor = (d: GeneralDocRow): { name: string; kind: string } => {
    if (d.entity_type === 'client' && d.entity_id) {
      const c = clients.find(cl => cl.id === d.entity_id)
      if (c) return { name: c.name, kind: 'Client' }
    }
    if (d.entity_type === 'employee' && d.entity_id) {
      const emp = employees.find(e => e.id === d.entity_id)
      if (emp) return { name: emp.full_name, kind: 'Employé(e)' }
    }
    if (d.client?.name) return { name: d.client.name, kind: d.client.type === 'client' ? 'Client' : 'Partenaire' }
    return { name: '', kind: '' }
  }

  const rowObject = (d: GeneralDocRow): string => {
    const c = (d.content || {}) as Record<string, unknown>
    return (d.object as string) || (typeof c.object === 'string' ? c.object : '') || (typeof c.notes === 'string' ? c.notes : '') || ''
  }

  const rowBody = (d: GeneralDocRow): string => {
    const c = (d.content || {}) as Record<string, unknown>
    return (d.body as string) || (typeof c.notes === 'string' ? c.notes : '') || ''
  }

  const recipientFor = (d: GeneralDocRow): GeneralDocumentPDFData['recipient'] => {
    if (d.entity_type === 'employee' && d.entity_id) {
      const emp = employees.find(e => e.id === d.entity_id)
      if (emp) return { type: 'employee', name: emp.full_name }
    }
    const dest = destNameFor(d)
    if (!dest.name) return null
    // Tout le reste (client, fournisseur, institution, partenaire) est un
    // destinataire externe : libellé générique « Client / Partenaire ».
    return { type: 'client', name: dest.name }
  }

  const rowPDFData = (d: GeneralDocRow): GeneralDocumentPDFData => {
    const c = (d.content || {}) as Record<string, unknown>
    return {
      reference: d.reference || d.id.slice(0, 8).toUpperCase(),
      doc_date: d.doc_date || d.created_at,
      typeLabel: catDefFor(d).label,
      object: rowObject(d),
      recipient: recipientFor(d),
      body: rowBody(d),
      signed_by: (d.signed_by as string) || (typeof c.signed_by === 'string' ? c.signed_by : '') || '',
      generated_at: d.generated_at || d.created_at,
    }
  }

  // ── Filtres & statistiques ──
  const filtered = rows.filter(d => {
    const arch = isArchived(d)
    if (statusFilter === 'archived') {
      if (!arch) return false
    } else {
      if (arch && !showArchived) return false
      if (statusFilter !== 'all' && d.status !== statusFilter) return false
    }
    if (catFilter !== 'all' && catDefFor(d).value !== catFilter) return false
    const q = search.trim().toLowerCase()
    if (q) {
      const dest = destNameFor(d).name
      const hay = `${d.title} ${d.reference} ${rowObject(d)} ${catDefFor(d).label} ${dest}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const activeRows = rows.filter(d => !isArchived(d))
  const stats = {
    total: rows.length,
    active: activeRows.length,
    sent: activeRows.filter(d => d.status === 'sent').length,
    generated: activeRows.filter(d => d.status === 'generated').length,
    archived: rows.filter(d => isArchived(d)).length,
  }

  // ── Génération / archivage PDF ──
  async function uploadRowPDF(id: string, reference: string, data: GeneralDocumentPDFData): Promise<boolean> {
    const pdf = generateGeneralDocumentPDF(data)
    const blob = pdf.output('blob')
    const filePath = `${id}/${slugRef(reference)}.pdf`
    const { storagePath, error: upErr } = await uploadPDF('general-documents', filePath, blob)
    if (upErr) {
      toast('warning', `PDF non archivé dans le bucket (${upErr}) — téléchargeable depuis la liste.`)
      return false
    }
    const { error: urlErr } = await supabase
      .from('documents')
      .update({ file_url: `general-documents/${storagePath}` })
      .eq('id', id)
    if (urlErr) {
      toast('warning', `PDF archivé mais lien non mis à jour (${urlErr.message}).`)
      return false
    }
    return true
  }

  async function openStoredPDF(d: GeneralDocRow): Promise<boolean> {
    if (!d.file_url) return false
    const { bucket, path } = splitFileUrl(d.file_url)
    const url = await getSignedPDFUrl(bucket, path)
    if (url) {
      window.open(url, '_blank')
      return true
    }
    return false
  }

  // ── Actions ──
  async function insertDocAndPDF(fields: Record<string, unknown>, successMsg: string) {
    const { data: user } = await supabase.auth.getUser()
    const { data: ref, error: refErr } = await supabase.rpc('gen_document_ref_doc')
    if (refErr || !ref) throw new Error(refErr?.message || 'Référence du document indisponible.')
    const { data: inserted, error: insErr } = await supabase
      .from('documents')
      .insert({ ...fields, reference: ref as string, created_by: user.user?.id || null })
      .select('id, reference')
      .single()
    if (insErr || !inserted) throw new Error(insErr?.message || "Erreur lors de l'enregistrement du document.")
    const data: GeneralDocumentPDFData = {
      reference: (inserted.reference as string) || (ref as string),
      doc_date: (fields.doc_date as string) || todayISO(),
      typeLabel: (fields.typeLabel as string) || 'Document',
      object: (fields.object as string) || '',
      recipient: (fields.recipient as GeneralDocumentPDFData['recipient']) || null,
      body: (fields.body as string) || '',
      signed_by: (fields.signed_by as string) || '',
      generated_at: new Date().toISOString(),
    }
    const ok = await uploadRowPDF(inserted.id as string, (inserted.reference as string) || (ref as string), data)
    toast('success', ok ? successMsg : `${successMsg} (PDF téléchargeable mais non archivé).`)
    setShowModal(false)
    setForm(emptyForm())
    await load()
  }

  function resolveEntity() {
    if (form.entity_type === 'client') {
      const c = clients.find(cl => cl.id === form.client_id)
      return c ? { kind: 'client' as const, id: c.id, name: c.name } : null
    }
    if (form.entity_type === 'employee') {
      const e = employees.find(em => em.id === form.employee_id)
      return e ? { kind: 'employee' as const, id: e.id, name: e.full_name } : null
    }
    return null
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError('')
    if (form.entity_type === 'client' && !form.client_id) { setError('Sélectionnez un client destinataire.'); return }
    if (form.entity_type === 'employee' && !form.employee_id) { setError('Sélectionnez un employé destinataire.'); return }
    setSaving(true)
    try {
      const cat = CATEGORIES.find(c => c.value === form.category) || CATEGORIES[0]
      const entity = resolveEntity()
      await insertDocAndPDF(
        {
          title: form.title.trim(),
          type: cat.storeType,
          doc_category: cat.value,
          status: 'generated',
          typeLabel: cat.label,
          object: form.object.trim() || null,
          body: form.body,
          doc_date: form.doc_date || todayISO(),
          entity_type: entity ? entity.kind : 'none',
          entity_id: entity ? entity.id : null,
          signed_by: form.signed_by.trim() || null,
          generated_at: new Date().toISOString(),
          content: { object: form.object.trim() || null, signed_by: form.signed_by.trim() || null },
          client_id: null,
          employee_id: null,
        },
        `Document ${cat.label.toLowerCase()} créé avec PDF archivé.`
      )
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  async function regeneratePDF(d: GeneralDocRow) {
    setBusyId(d.id)
    setError('')
    try {
      const ok = await uploadRowPDF(d.id, d.reference, rowPDFData(d))
      toast('success', ok ? `PDF ${d.reference} régénéré et ré-archivé.` : 'PDF régénéré (archivage impossible).')
      if (ok) await load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  function downloadPDF(d: GeneralDocRow) {
    try {
      const pdf = generateGeneralDocumentPDF(rowPDFData(d))
      pdf.save(`${slugRef(d.reference || 'DOC')}_${catDefFor(d).label.replace(/\s+/g, '_')}.pdf`)
    } catch (e) {
      setError('Génération PDF impossible : ' + errMsg(e))
    }
  }

  async function apercuPDF(d: GeneralDocRow) {
    setBusyId(d.id)
    setError('')
    try {
      if (await openStoredPDF(d)) return
      // Pas de PDF archivé (ou objet supprimé) : on le (re)génère puis on l'ouvre.
      const ok = await uploadRowPDF(d.id, d.reference, rowPDFData(d))
      if (ok) {
        const url = await getSignedPDFUrl('general-documents', `${d.id}/${slugRef(d.reference)}.pdf`)
        if (url) window.open(url, '_blank')
        else toast('warning', 'PDF généré mais ouverture impossible — utilisez Télécharger.')
      } else {
        downloadPDF(d)
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  async function markSent(d: GeneralDocRow) {
    setBusyId(d.id)
    const { error: err } = await supabase
      .from('documents')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', d.id)
    setBusyId(null)
    if (err) toast('error', `Erreur : ${err.message}`)
    else { toast('success', `Document ${d.reference} marqué comme envoyé.`); load() }
  }

  async function toggleArchive(d: GeneralDocRow) {
    const archiving = !isArchived(d)
    setBusyId(d.id)
    const { error: err } = await supabase
      .from('documents')
      .update({ archived_at: archiving ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', d.id)
    setBusyId(null)
    if (err) toast('error', `Erreur : ${err.message}`)
    else { toast('success', archiving ? `Document ${d.reference} archivé.` : `Document ${d.reference} restauré.`); load() }
  }

  async function duplicateDoc(d: GeneralDocRow) {
    if (!confirm(`Dupliquer le document ${d.reference || d.title} ? Une nouvelle référence sera attribuée.`)) return
    setBusyId(d.id)
    setError('')
    try {
      const cat = catDefFor(d)
      const dest = destNameFor(d)
      await insertDocAndPDF(
        {
          title: d.title,
          type: cat.storeType,
          doc_category: d.doc_category || cat.value,
          status: 'generated',
          typeLabel: cat.label,
          object: rowObject(d),
          body: rowBody(d),
          doc_date: d.doc_date || todayISO(),
          entity_type: d.entity_type || (d.client_id ? 'client' : 'none'),
          entity_id: d.entity_id || d.client_id || null,
          signed_by: d.signed_by || '',
          generated_at: new Date().toISOString(),
          content: d.content || {},
          client_id: null,
          employee_id: null,
        },
        `Copie de ${d.reference} créée avec PDF archivé.`
      )
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  async function deleteDoc(d: GeneralDocRow) {
    if (!confirm(`Supprimer définitivement ${d.reference || d.title} ? Action irréversible.`)) return
    setBusyId(d.id)
    setError('')
    try {
      if (d.file_url) {
        const { bucket, path } = splitFileUrl(d.file_url)
        await supabase.storage.from(bucket).remove([path])
      }
      const { error: err } = await supabase.from('documents').delete().eq('id', d.id)
      if (err) throw new Error(err.message)
      toast('success', 'Document supprimé.')
      await load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  const catCounts = (value: string) => rows.filter(d => catDefFor(d).value === value).length

  return (
    <div>
      <div className="page-header">
        <h2>📄 Documents généraux</h2>
        <button className="btn-primary" onClick={() => { setError(''); setForm(emptyForm()); setShowModal(true) }}>
          + Nouveau document
        </button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {error && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: '#fee2e2', color: '#991b1b', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: '0.85rem' }}>
            <span>⚠️ {error}</span>
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontWeight: 700 }}>✕</button>
          </div>
        )}

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 14, marginBottom: 24 }}>
          <div className="stat-card green"><div className="stat-value">{stats.total}</div><div className="stat-label">Documents au registre</div></div>
          <div className="stat-card blue"><div className="stat-value">{stats.generated}</div><div className="stat-label">Générés</div></div>
          <div className="stat-card green"><div className="stat-value">{stats.sent}</div><div className="stat-label">Envoyés</div></div>
          <div className="stat-card amber"><div className="stat-value">{stats.archived}</div><div className="stat-label">Archivés</div></div>
        </div>

        {/* Filtres par catégorie (chips cliquables) */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => setCatFilter('all')}
            style={{ background: catFilter === 'all' ? '#1a3d2b' : 'white', color: catFilter === 'all' ? 'white' : '#1a3d2b', border: '1px solid #e8e4db', borderRadius: 8, padding: '7px 14px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
          >Toutes ({stats.total})</button>
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setCatFilter(catFilter === c.value ? 'all' : c.value)}
              style={{ background: catFilter === c.value ? '#1a3d2b' : 'white', color: catFilter === c.value ? 'white' : '#555', border: '1px solid #e8e4db', borderRadius: 8, padding: '7px 14px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
            >{c.icon} {c.label} <strong>({catCounts(c.value)})</strong></button>
          ))}
        </div>

        {/* Barre de recherche + statut */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="hub-input"
            style={{ maxWidth: 320, flex: 1 }}
            placeholder="Rechercher (référence, titre, objet, destinataire…)"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="hub-select" style={{ width: 170 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">Tous les statuts</option>
            <option value="draft">Brouillons</option>
            <option value="generated">Générés</option>
            <option value="sent">Envoyés</option>
            <option value="archived">Archivés</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#555', cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Afficher les documents archivés
          </label>
        </div>

        {/* Table */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement du registre…</div> : (
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Titre / Objet</th>
                  <th>Catégorie</th>
                  <th>Destinataire</th>
                  <th>Date</th>
                  <th>Statut</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => {
                  const cat = catDefFor(d)
                  const dest = destNameFor(d)
                  const arch = isArchived(d)
                  const busy = busyId === d.id
                  const isSent = d.status === 'sent' || d.status === 'converted' || d.status === 'approved'
                  const canDelete = !arch && (d.status === 'draft' || d.status === 'generated')
                  return (
                    <tr key={d.id} style={{ opacity: arch ? 0.72 : 1 }}>
                      <td>
                        <strong>{d.title}</strong>
                        <div style={{ fontSize: '0.72rem', color: '#999', fontFamily: 'monospace' }}>{d.reference || `#${d.id.slice(0, 8).toUpperCase()}`}</div>
                        {rowObject(d) && <div style={{ fontSize: '0.75rem', color: '#777', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rowObject(d)}</div>}
                      </td>
                      <td>
                        <span className="badge badge-gray">{cat.icon} {cat.label}</span>
                      </td>
                      <td style={{ color: '#555', fontSize: '0.85rem' }}>
                        {dest.name ? <>{dest.name}<div style={{ fontSize: '0.7rem', color: '#999' }}>{dest.kind}</div></> : <span style={{ color: '#bbb' }}>—</span>}
                      </td>
                      <td style={{ color: '#666', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{dateFR(d.doc_date || d.created_at)}</td>
                      <td>
                        {arch
                          ? <span className="badge badge-amber">🗃 Archivé</span>
                          : <span className={`badge ${statusBadge[d.status] || 'badge-gray'}`}>{statusLabels[d.status] || d.status}</span>}
                        {d.file_url && <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 2 }}>📎 PDF archivé</div>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button className="btn-ghost" title="Aperçu du PDF archivé" disabled={busy} style={{ padding: '5px 8px', fontSize: '0.75rem' }} onClick={() => apercuPDF(d)}>👁</button>
                          <button className="btn-ghost" title="Télécharger le PDF" disabled={busy} style={{ padding: '5px 8px', fontSize: '0.75rem' }} onClick={() => downloadPDF(d)}>📥</button>
                          {!arch && <button className="btn-ghost" title="Régénérer le PDF" disabled={busy} style={{ padding: '5px 8px', fontSize: '0.75rem' }} onClick={() => regeneratePDF(d)}>🔄</button>}
                          {!arch && <button className="btn-ghost" title="Dupliquer" disabled={busy} style={{ padding: '5px 8px', fontSize: '0.75rem' }} onClick={() => duplicateDoc(d)}>📑</button>}
                          {!arch && !isSent && <button className="btn-ghost" title="Marquer comme envoyé" disabled={busy} style={{ padding: '5px 8px', fontSize: '0.75rem', color: '#065f46' }} onClick={() => markSent(d)}>📤</button>}
                          {!arch && (
                            <button className="btn-ghost" title="Archiver" disabled={busy} style={{ padding: '5px 8px', fontSize: '0.75rem' }} onClick={() => toggleArchive(d)}>🗄</button>
                          )}
                          {arch && (
                            <button className="btn-ghost" title="Restaurer" disabled={busy} style={{ padding: '5px 8px', fontSize: '0.75rem' }} onClick={() => toggleArchive(d)}>♻️</button>
                          )}
                          {canDelete && (
                            <button className="btn-danger" title="Supprimer (brouillon ou généré uniquement)" disabled={busy} onClick={() => deleteDoc(d)}>🗑</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 48, color: '#999' }}>
                      {rows.length === 0 ? 'Aucun document au registre. Créez votre premier document général.' : 'Aucun document ne correspond aux filtres.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <p style={{ fontSize: '0.75rem', color: '#999', marginTop: 12 }}>
          Cycle de vie : généré → envoyé → archivé. La suppression n’est possible que pour un brouillon ou un document généré (jamais envoyé/archivé) ;
          les PDF sont archivés dans le bucket privé <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>general-documents</code>.
        </p>
      </div>

      {/* Modal création */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !saving && setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 640 }}>
            <div className="modal-title">📄 Nouveau document général</div>
            <form onSubmit={handleCreate}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div className="hub-form-group">
                  <label>Catégorie *</label>
                  <select className="hub-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Date du document *</label>
                  <input className="hub-input" type="date" value={form.doc_date} onChange={e => setForm(f => ({ ...f, doc_date: e.target.value }))} required />
                </div>
              </div>
              <div className="hub-form-group">
                <label>Titre *</label>
                <input className="hub-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="Ex: Lettre d’engagement — Programme Fournitures 2026" />
              </div>
              <div className="hub-form-group">
                <label>Objet</label>
                <input className="hub-input" value={form.object} onChange={e => setForm(f => ({ ...f, object: e.target.value }))} placeholder="Ex: Demande de partenariat pour la campagne agricole" />
              </div>

              <div className="hub-form-group">
                <label>Destinataire</label>
                <select className="hub-select" value={form.entity_type} onChange={e => setForm(f => ({ ...f, entity_type: e.target.value as EntityKind, client_id: '', employee_id: '' }))}>
                  <option value="none">-- Aucun (document interne) --</option>
                  <option value="client">Client / Partenaire</option>
                  <option value="employee">Employé(e)</option>
                </select>
              </div>
              {form.entity_type === 'client' && (
                <div className="hub-form-group">
                  <label>Client destinataire *</label>
                  <select className="hub-select" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                    <option value="">-- Sélectionner --</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              {form.entity_type === 'employee' && (
                <div className="hub-form-group">
                  <label>Employé(e) destinataire *</label>
                  <select className="hub-select" value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                    <option value="">-- Sélectionner --</option>
                    {employees.map(em => <option key={em.id} value={em.id}>{em.full_name}{em.position ? ` — ${em.position}` : ''}</option>)}
                  </select>
                </div>
              )}

              <div className="hub-form-group">
                <label>Corps du document *</label>
                <textarea className="hub-input" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={8} required placeholder={'Madame, Monsieur,\n\n...'} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div className="hub-form-group">
                <label>Signé par (optionnel)</label>
                <input className="hub-input" value={form.signed_by} onChange={e => setForm(f => ({ ...f, signed_by: e.target.value }))} placeholder="Ex: Jean Mavoungou — Directeur Général" />
              </div>

              <p style={{ fontSize: '0.75rem', color: '#999', margin: '4px 0 8px' }}>
                À l’enregistrement : référence <strong>DOC-AAAA-XXXX</strong> attribuée, statut « Généré », PDF généré puis archivé
                dans le bucket privé <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>general-documents</code>.
              </p>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" disabled={saving} onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Création & génération PDF…' : 'Créer & générer le PDF'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
