'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadFile, uploadFilePath, getPublicFileUrl } from '@/lib/storage/uploadFile'

type RequestStatus = 'pending' | 'processing' | 'approved' | 'rejected'
type FinalStatus = 'approved' | 'rejected'

interface RequestRow {
  id: string
  requester_name: string
  organization: string
  email: string
  phone?: string | null
  document_type: string
  description?: string | null
  status: RequestStatus
  response_notes?: string | null
  document_url?: string | null
  response_file_name?: string | null
  handled_by?: string | null
  responded_at?: string | null
  email_sent_at?: string | null
  created_at: string
  updated_at?: string | null
}

const statusLabels: Record<RequestStatus, string> = { pending: 'En attente', processing: 'En cours', approved: 'Approuvé', rejected: 'Rejeté' }
const statusBadge: Record<RequestStatus, string> = { pending: 'badge-amber', processing: 'badge-blue', approved: 'badge-green', rejected: 'badge-red' }
const statusPriority: Record<RequestStatus, number> = { pending: 0, processing: 1, approved: 2, rejected: 3 }
const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 Mo

function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtShortDate(iso?: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** URL publique de téléchargement du fichier de réponse (bucket public → aucune session). */
function publicFileUrl(row: RequestRow): string {
  const raw = row.document_url || ''
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  if (!base) return ''
  return getPublicFileUrl('request-responses', raw)
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallback ci-dessous */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch {
    return false
  }
}

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) return 'Fichier trop volumineux (maximum 10 Mo).'
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (!ALLOWED_EXTENSIONS.includes(ext)) return 'Format non pris en charge (attendu : .pdf, .png, .jpg, .doc, .docx).'
  return null
}

export default function RequestsPage() {
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | RequestStatus>('all')
  const [search, setSearch] = useState('')

  const [selected, setSelected] = useState<RequestRow | null>(null)
  const [finalStatus, setFinalStatus] = useState<FinalStatus>('approved')
  const [responseNotes, setResponseNotes] = useState('')
  const [responseFile, setResponseFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [sendingId, setSendingId] = useState<string | null>(null)
  const [sendError, setSendError] = useState<{ id: string; message: string } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const supabase = createClient()

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await supabase
        .from('document_requests')
        .select('*')
        .order('created_at', { ascending: false })
      if (err) throw new Error(err.message)
      setRequests((data || []) as RequestRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement des demandes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // --- Filtres + recherche + tri (pending/processing d'abord, puis date) ---
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = requests.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false
      if (!q) return true
      return [r.requester_name, r.organization, r.email, r.phone || '', r.document_type]
        .some(v => v.toLowerCase().includes(q))
    })
    return [...filtered].sort(
      (a, b) =>
        statusPriority[a.status] - statusPriority[b.status] ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  }, [requests, filter, search])

  const counts = useMemo(() => ({
    all: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    processing: requests.filter(r => r.status === 'processing').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
  }), [requests])

  // --- Actions ---
  function openRespond(r: RequestRow) {
    setSelected(r)
    setResponseNotes(r.response_notes || '')
    setResponseFile(null)
    setFinalStatus('approved')
    setFormError('')
    setSendError(null)
  }

  async function markProcessing() {
    if (!selected) return
    setSaving(true)
    setFormError('')
    const { error: err } = await supabase
      .from('document_requests')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', selected.id)
    if (err) setFormError(err.message)
    else { setSelected(null); load() }
    setSaving(false)
  }

  async function submitResponse() {
    if (!selected) return
    setFormError('')
    const notes = responseNotes.trim()

    if (finalStatus === 'rejected' && !notes) {
      setFormError('Le motif du rejet est obligatoire pour rejeter la demande.')
      return
    }
    if (finalStatus === 'approved' && !responseFile) {
      setFormError('Joignez le fichier du document à remettre au demandeur.')
      return
    }
    if (responseFile) {
      const errMsg = validateFile(responseFile)
      if (errMsg) { setFormError(errMsg); return }
    }

    setSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const patch: Record<string, unknown> = {
        status: finalStatus,
        response_notes: notes || null,
        responded_at: new Date().toISOString(),
        handled_by: userData?.user?.id ?? null,
        updated_at: new Date().toISOString(),
      }

      if (responseFile) {
        const path = uploadFilePath('request-responses', responseFile.name)
        const up = await uploadFile('request-responses', path, responseFile)
        if (up.error || !up.storagePath) {
          setFormError(`Upload du fichier impossible : ${up.error || 'erreur inconnue'}.`)
          setSaving(false)
          return
        }
        patch.document_url = up.storagePath
        patch.response_file_name = responseFile.name
      }

      const { error: err } = await supabase.from('document_requests').update(patch).eq('id', selected.id)
      if (err) {
        setFormError(err.message)
      } else {
        setSelected(null)
        setResponseFile(null)
        setResponseNotes('')
        load()
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Erreur lors de la réponse à la demande.')
    } finally {
      setSaving(false)
    }
  }

  async function removeRequest(r: RequestRow) {
    if (!window.confirm(`Supprimer la demande de ${r.requester_name} (${r.document_type}) ?`)) return
    setError('')
    const { error: err } = await supabase.from('document_requests').delete().eq('id', r.id)
    if (err) setError(`Suppression impossible : ${err.message}`)
    else load()
  }

  async function sendFileToRequester(r: RequestRow): Promise<boolean> {
    setSendingId(r.id)
    setSendError(null)
    try {
      const res = await fetch('/api/requests/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: r.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        setSendError({ id: r.id, message: data?.error || 'Envoi de l\u2019email impossible.' })
        return false
      }
      const sentAt = typeof data?.email_sent_at === 'string' ? data.email_sent_at : new Date().toISOString()
      setRequests(prev => prev.map(x => (x.id === r.id ? { ...x, email_sent_at: sentAt } : x)))
      if (selected?.id === r.id) setSelected({ ...r, email_sent_at: sentAt })
      return true
    } catch (e) {
      setSendError({ id: r.id, message: e instanceof Error ? e.message : 'Erreur réseau lors de l\u2019envoi de l\u2019email.' })
      return false
    } finally {
      setSendingId(null)
    }
  }

  async function copyDownloadLink(r: RequestRow) {
    const url = publicFileUrl(r)
    if (!url) { setSendError({ id: r.id, message: 'URL publique indisponible (NEXT_PUBLIC_SUPABASE_URL manquant).' }); return }
    const ok = await copyText(url)
    if (ok) {
      setCopiedId(r.id)
      window.setTimeout(() => setCopiedId(null), 2000)
    } else {
      setSendError({ id: r.id, message: 'Impossible de copier le lien — sélectionnez-le manuellement.' })
    }
  }

  const rejectSelected = finalStatus === 'rejected'
  const fileSize = responseFile ? `${(responseFile.size / (1024 * 1024)).toFixed(1)} Mo` : ''
  const viewOnly = !!selected && (selected.status === 'rejected' || (selected.status === 'approved' && !!selected.document_url))

  return (
    <div>
      <div className="page-header">
        <h2>📬 Demandes Externes</h2>
        <a href="/portal" target="_blank" className="btn-ghost" style={{ textDecoration: 'none', fontSize: '0.875rem' }}>
          🌐 Voir le portail public →
        </a>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Filtres par statut */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {([
            { key: 'all', label: `Toutes (${counts.all})`, icon: '📬' },
            { key: 'pending', label: `En attente (${counts.pending})`, icon: '⏳' },
            { key: 'processing', label: `En cours (${counts.processing})`, icon: '⚙️' },
            { key: 'approved', label: `Approuvées (${counts.approved})`, icon: '✅' },
            { key: 'rejected', label: `Rejetées (${counts.rejected})`, icon: '❌' },
          ] as { key: 'all' | RequestStatus; label: string; icon: string }[]).map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{ padding: '9px 15px', borderRadius: 10, border: '1.5px solid', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem', transition: 'all 0.15s',
                borderColor: filter === f.key ? 'var(--hub-green-mid)' : '#ddd',
                background: filter === f.key ? 'var(--hub-green-mid)' : 'white',
                color: filter === f.key ? 'white' : '#666' }}>
              {f.icon} {f.label}
            </button>
          ))}
        </div>

        {/* Recherche */}
        <div style={{ marginBottom: 16 }}>
          <input
            className="hub-input"
            placeholder="🔍 Rechercher : nom, organisation, email, type de document…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 480 }}
          />
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⚠️ {error}</span>
            <button className="btn-ghost" style={{ padding: '2px 10px' }} onClick={() => setError('')}>✕</button>
          </div>
        )}

        {/* Liste */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Chargement...</div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {visible.map(r => {
              const hasFile = !!r.document_url
              const canDelete = r.status === 'pending' || r.status === 'processing'
              const url = hasFile ? publicFileUrl(r) : ''
              const hasEmail = !!(r.email || '').trim()
              return (
                <div key={r.id} style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px 24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                        <span className={`badge ${statusBadge[r.status]}`}>{statusLabels[r.status]}</span>
                        {hasFile && (
                          <span title="Fichier de réponse joint" style={{ color: '#059669', fontSize: '0.7rem', lineHeight: 1 }}>● Fichier joint</span>
                        )}
                        {r.status === 'pending' && (
                          <span style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 600 }}>⏳ Non traitée</span>
                        )}
                        <span style={{ fontSize: '0.75rem', color: '#999' }}>{fmtDate(r.created_at)}</span>
                        <span style={{ fontSize: '0.72rem', color: '#aaa', fontFamily: 'monospace' }}>#{r.id.slice(-8).toUpperCase()}</span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Demandeur</div>
                          <div style={{ fontWeight: 700, color: 'var(--hub-green)' }}>{r.requester_name}</div>
                          <div style={{ fontSize: '0.8rem', color: '#666' }}>{r.organization}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Contact</div>
                          <div style={{ fontSize: '0.85rem' }}>{r.email || '⚠️ email manquant'}</div>
                          {r.phone && <div style={{ fontSize: '0.8rem', color: '#666' }}>{r.phone}</div>}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Document demandé</div>
                          <div style={{ fontWeight: 600, color: 'var(--hub-green-mid)' }}>📋 {r.document_type}</div>
                          {r.response_file_name && <div style={{ fontSize: '0.78rem', color: '#888', fontFamily: 'monospace' }}>📎 {r.response_file_name}</div>}
                        </div>
                      </div>

                      {r.description && (
                        <div style={{ marginTop: 12, padding: '10px 14px', background: '#f8f5ee', borderRadius: 8, fontSize: '0.8rem', color: '#555' }}>
                          💬 {r.description}
                        </div>
                      )}
                      {r.response_notes && (
                        <div style={{ marginTop: 8, padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, fontSize: '0.8rem', color: '#065f46', border: '1px solid #a7f3d0' }}>
                          ✅ Réponse : {r.response_notes}
                        </div>
                      )}
                      {r.email_sent_at && (
                        <div style={{ marginTop: 8, padding: '10px 14px', background: '#eff6ff', borderRadius: 8, fontSize: '0.8rem', color: '#1e40af', border: '1px solid #bfdbfe' }}>
                          📧 Email envoyé au demandeur le {fmtShortDate(r.email_sent_at)} — {url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: '#1e40af', fontWeight: 600 }}>voir le lien envoyé</a> : null}
                        </div>
                      )}
                      {sendError?.id === r.id && (
                        <div className="alert alert-error" style={{ marginTop: 8, fontSize: '0.78rem' }}>{sendError.message}</div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                      {r.status === 'pending' && (
                        <button className="btn-primary" style={{ padding: '8px 14px', fontSize: '0.8rem' }} onClick={() => openRespond(r)}>
                          Traiter →
                        </button>
                      )}
                      {r.status === 'processing' && (
                        <button className="btn-amber" style={{ padding: '8px 14px', fontSize: '0.8rem' }} onClick={() => openRespond(r)}>
                          Finaliser
                        </button>
                      )}
                      {r.status === 'approved' && !hasFile && (
                        <button className="btn-ghost" style={{ padding: '8px 14px', fontSize: '0.8rem', borderColor: 'var(--hub-green-mid)', color: 'var(--hub-green-mid)' }}
                          onClick={() => openRespond(r)}>
                          📎 Joindre le fichier
                        </button>
                      )}
                      {r.status === 'approved' && hasFile && (
                        <>
                          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: '0.72rem' }} onClick={() => openRespond(r)}>
                            👁️ Voir le détail
                          </button>
                          {!r.email_sent_at && hasEmail && (
                            <button className="btn-primary" style={{ padding: '9px 16px', fontSize: '0.82rem' }}
                              disabled={sendingId === r.id} onClick={() => sendFileToRequester(r)}>
                              {sendingId === r.id ? 'Envoi en cours…' : '📧 Envoyer le fichier au demandeur'}
                            </button>
                          )}
                          {r.email_sent_at && (
                            <span className="badge badge-green">📧 Email envoyé le {fmtShortDate(r.email_sent_at)}</span>
                          )}
                          {!r.email_sent_at && !hasEmail && (
                            <div style={{ fontSize: '0.72rem', color: '#b45309', maxWidth: 220, textAlign: 'right' }}>
                              ⚠️ Email du demandeur manquant — impossible d'envoyer automatiquement.
                            </div>
                          )}
                          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: '0.72rem' }} onClick={() => copyDownloadLink(r)}>
                            {copiedId === r.id ? '✓ Lien copié' : '🔗 Copier le lien public'}
                          </button>
                        </>
                      )}
                      {r.status === 'rejected' && (
                        <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: '0.72rem' }} onClick={() => openRespond(r)}>
                          👁️ Voir le détail
                        </button>
                      )}
                      {canDelete && (
                        <button
                          style={{ padding: '6px 12px', fontSize: '0.72rem', background: 'none', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 8, cursor: 'pointer' }}
                          onClick={() => removeRequest(r)} title="Supprimer (demande non traitée)">
                          🗑️ Supprimer
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {visible.length === 0 && (
              <div style={{ textAlign: 'center', padding: 60, color: '#999', background: 'white', borderRadius: 12, border: '1px solid #e8e4db' }}>
                {requests.length === 0 ? 'Aucune demande pour le moment.' : 'Aucune demande ne correspond à votre recherche ou à ce filtre.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal : Répondre à la demande */}
      {selected && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !saving && setSelected(null)}>
          <div className="modal-box" style={{ maxWidth: 560 }}>
            <div className="modal-title">
              {viewOnly
                ? '👁️ Détail de la demande'
                : selected.status === 'approved' && !selected.document_url
                  ? '📎 Joindre le fichier de réponse'
                  : 'Répondre à la demande'}
            </div>

            <div style={{ background: '#f8f5ee', borderRadius: 8, padding: '14px 16px', marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 700, color: 'var(--hub-green)' }}>{selected.requester_name}</div>
                <span className={`badge ${statusBadge[selected.status]}`}>{statusLabels[selected.status]}</span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#666' }}>{selected.organization} · {selected.email}</div>
              <div style={{ fontWeight: 600, color: 'var(--hub-green-mid)', marginTop: 8 }}>📋 {selected.document_type}</div>
              {selected.description && <div style={{ fontSize: '0.8rem', color: '#555', marginTop: 6 }}>💬 {selected.description}</div>}
              {selected.document_url && selected.response_file_name && (
                <div style={{ fontSize: '0.78rem', color: '#059669', marginTop: 8 }}>
                  📎 Fichier joint : <span style={{ fontFamily: 'monospace' }}>{selected.response_file_name}</span>
                </div>
              )}
              {selected.responded_at && (
                <div style={{ fontSize: '0.78rem', color: '#888', marginTop: 4 }}>Répondue le {fmtDate(selected.responded_at)}</div>
              )}
            </div>

            {!viewOnly && (
              <>
                <div className="hub-form-group">
                  <label>Statut final de la demande</label>
                  <select
                    className="hub-select"
                    value={finalStatus}
                    onChange={e => { setFinalStatus(e.target.value as FinalStatus); setFormError('') }}
                    disabled={selected.status === 'approved' && !!selected.document_url}
                  >
                    <option value="approved">✅ Approuver — remettre le fichier au demandeur</option>
                    <option value="rejected">❌ Rejeter — motif obligatoire</option>
                  </select>
                </div>

                {finalStatus === 'approved' && (
                  <div className="hub-form-group">
                    <label>Fichier du document à remettre * (PDF, PNG, JPG, DOC, DOCX — 10 Mo max)</label>
                    <input
                      type="file"
                      className="hub-input"
                      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                      onChange={e => {
                        const f = e.target.files?.[0] || null
                        setResponseFile(f)
                        setFormError('')
                      }}
                      style={{ padding: '8px 10px' }}
                    />
                    {responseFile && (
                      <div style={{ fontSize: '0.78rem', color: '#059669', marginTop: 6 }}>
                        📎 {responseFile.name} ({fileSize}) — sera joint à la demande puis envoyé par email.
                      </div>
                    )}
                    {!responseFile && selected.document_url && (
                      <div style={{ fontSize: '0.78rem', color: '#888', marginTop: 6 }}>
                        Un fichier est déjà joint. Choisissez-en un nouveau uniquement pour le remplacer.
                      </div>
                    )}
                  </div>
                )}

                <div className="hub-form-group">
                  <label>{finalStatus === 'rejected' ? 'Motif du rejet * (transmis au demandeur)' : 'Message au demandeur (optionnel)'}</label>
                  <textarea
                    className="hub-input"
                    value={responseNotes}
                    onChange={e => setResponseNotes(e.target.value)}
                    rows={3}
                    style={{ resize: 'vertical' }}
                    placeholder={finalStatus === 'rejected'
                      ? 'Ex : document non disponible, pièces complémentaires requises…'
                      : 'Ex : attestation disponible, veuillez la télécharger ci-dessous…'}
                  />
                </div>

                {formError && <div className="alert alert-error" style={{ marginBottom: 14 }}>⚠️ {formError}</div>}
              </>
            )}

            {viewOnly && selected.status === 'approved' && (
              <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '14px 16px', border: '1px solid #bbf7d0', marginBottom: 4 }}>
                <div style={{ fontSize: '0.85rem', color: '#065f46', fontWeight: 600, marginBottom: 4 }}>
                  ✅ Demande approuvée — fichier joint et prêt à être renvoyé au demandeur.
                </div>
                {selected.email_sent_at ? (
                  <div style={{ fontSize: '0.8rem', color: '#065f46' }}>
                    📧 Email envoyé le {fmtDate(selected.email_sent_at)}.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {(selected.email || '').trim() ? (
                      <button className="btn-primary" style={{ padding: '8px 14px', fontSize: '0.8rem' }}
                        disabled={sendingId === selected.id} onClick={() => sendFileToRequester(selected)}>
                        {sendingId === selected.id ? 'Envoi en cours…' : '📧 Envoyer le fichier au demandeur'}
                      </button>
                    ) : null}
                    <button className="btn-ghost" style={{ padding: '8px 14px', fontSize: '0.8rem' }} onClick={() => copyDownloadLink(selected)}>
                      {copiedId === selected.id ? '✓ Lien copié' : '🔗 Copier le lien public'}
                    </button>
                  </div>
                )}
                {!selected.email_sent_at && !(selected.email || '').trim() && (
                  <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: 8 }}>
                    ⚠️ Email du demandeur manquant — l'envoi automatique est impossible. Utilisez le bouton « Copier le lien public » pour transmettre le fichier manuellement.
                  </div>
                )}
                {sendError?.id === selected.id && (
                  <div className="alert alert-error" style={{ marginTop: 10, fontSize: '0.78rem' }}>{sendError.message}</div>
                )}
              </div>
            )}

            {viewOnly && selected.status === 'rejected' && (
              <div style={{ background: '#fef2f2', borderRadius: 8, padding: '12px 14px', fontSize: '0.82rem', color: '#991b1b', border: '1px solid #fecaca', marginBottom: 4 }}>
                {selected.response_notes || 'Aucun motif de rejet enregistré.'}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 6 }}>
              <button className="btn-ghost" onClick={() => setSelected(null)} disabled={saving || sendingId === selected.id}>Fermer</button>

              {!viewOnly && selected.status === 'pending' && (
                <button className="btn-ghost" style={{ borderColor: '#3b82f6', color: '#3b82f6' }} disabled={saving} onClick={markProcessing}>
                  ⚙️ Mettre en cours
                </button>
              )}

              {!viewOnly && (
                rejectSelected ? (
                  <button
                    className="btn-danger"
                    disabled={saving}
                    onClick={submitResponse}
                    style={saving ? {} : { background: '#fee2e2', color: '#dc2626' }}
                  >
                    {saving ? 'Enregistrement…' : '❌ Rejeter la demande'}
                  </button>
                ) : (
                  <button className="btn-primary" disabled={saving} onClick={submitResponse}>
                    {saving ? 'Enregistrement…' : '✅ Approuver & joindre le fichier'}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
