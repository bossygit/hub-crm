'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { getSignedFileUrl, uploadFile, uploadFilePath } from '@/lib/storage/uploadFile'
import type { Job, Candidate } from '@/types'

type JobType = 'cdi' | 'cdd' | 'stage' | 'freelance'
type CandidateStatus = 'nouveau' | 'en_cours' | 'entretien' | 'accepte' | 'refuse'
type JobForm = { title: string; department: string; description: string; requirements: string; location: string; type: JobType; deadline: string }
type CandidateRow = Candidate & { job?: Pick<Job, 'title'> | null }

const statusColors: Record<CandidateStatus, string> = {
  nouveau: 'badge-gray', en_cours: 'badge-blue', entretien: 'badge-amber',
  accepte: 'badge-green', refuse: 'badge-red'
}
const statusLabels: Record<CandidateStatus, string> = {
  nouveau: 'Nouveau', en_cours: 'En cours', entretien: 'Entretien',
  accepte: 'Accepté ✓', refuse: 'Refusé'
}
const typeLabels: Record<JobType, string> = { cdi: 'CDI', cdd: 'CDD', stage: 'Stage', freelance: 'Freelance' }
const emptyJob: JobForm = { title: '', department: '', description: '', requirements: '', location: 'Brazzaville', type: 'cdi', deadline: '' }
const emptyCandidateForm: { job_id: string; name: string; email: string; phone: string; notes: string; status: CandidateStatus } = {
  job_id: '', name: '', email: '', phone: '', notes: '', status: 'nouveau'
}

// ── Validation CV (PDF / DOC / DOCX, max 5 Mo) ──────────────────────
const CV_ALLOWED_EXTS = ['pdf', 'doc', 'docx']
const CV_MAX_SIZE = 5 * 1024 * 1024

function validateCvFile(file: File): string | null {
  const ext = file.name.toLowerCase().split('.').pop() || ''
  if (!CV_ALLOWED_EXTS.includes(ext)) {
    return 'Format non autorisé — veuillez joindre un PDF, DOC ou DOCX.'
  }
  if (file.size > CV_MAX_SIZE) {
    return 'Fichier trop volumineux — taille maximale : 5 Mo.'
  }
  return null
}

export default function RecruitmentPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | CandidateStatus>('all')
  const [tab, setTab] = useState<'jobs' | 'candidates'>('jobs')
  const [cvLoadingId, setCvLoadingId] = useState<string | null>(null)
  const supabase = createClient()
  const { toast } = useToast()

  // ── Modal offre ─────────────────────────────────────────────────────
  const [showJobModal, setShowJobModal] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [jobForm, setJobForm] = useState<JobForm>(emptyJob)
  const [savingJob, setSavingJob] = useState(false)
  const [jobError, setJobError] = useState<string | null>(null)

  // ── Modal candidat ──────────────────────────────────────────────────
  const [showCandidateModal, setShowCandidateModal] = useState(false)
  const [editingCandidate, setEditingCandidate] = useState<CandidateRow | null>(null)
  const [candidateForm, setCandidateForm] = useState(emptyCandidateForm)
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [cvError, setCvError] = useState<string | null>(null)
  const [savingCandidate, setSavingCandidate] = useState(false)

  async function loadJobs() {
    const { data, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false })
    if (error) { toast('error', 'Erreur de chargement des offres.'); return }
    setJobs((data || []) as Job[])
  }

  async function loadCandidates(jobId?: string) {
    let q = supabase.from('candidates').select('*, job:jobs(title)').order('created_at', { ascending: false })
    if (jobId) q = q.eq('job_id', jobId)
    const { data, error } = await q
    if (error) { toast('error', 'Erreur de chargement des candidats.'); return }
    setCandidates((data || []) as CandidateRow[])
  }

  useEffect(() => { loadJobs(); loadCandidates() }, [])

  // ── Offres : CRUD ──────────────────────────────────────────────────
  function openNewJob() {
    setEditingJob(null); setJobForm(emptyJob); setJobError(null); setShowJobModal(true)
  }
  function openEditJob(j: Job) {
    setEditingJob(j)
    setJobForm({ title: j.title, department: j.department, description: j.description, requirements: j.requirements || '', location: j.location, type: j.type, deadline: j.deadline || '' })
    setJobError(null)
    setShowJobModal(true)
  }

  async function saveJob(e: React.FormEvent) {
    e.preventDefault(); setSavingJob(true); setJobError(null)
    if (editingJob) {
      const { error } = await supabase.from('jobs').update(jobForm).eq('id', editingJob.id)
      if (error) { setJobError(`Erreur : ${error.message}`); setSavingJob(false); return }
      toast('success', 'Offre mise à jour.')
    } else {
      const { error } = await supabase.from('jobs').insert({ ...jobForm, status: 'open' })
      if (error) { setJobError(`Erreur : ${error.message}`); setSavingJob(false); return }
      toast('success', 'Offre publiée.')
    }
    setSavingJob(false); setShowJobModal(false); loadJobs()
  }

  async function toggleJobStatus(j: Job) {
    const newStatus = j.status === 'open' ? 'closed' : 'open'
    const { error } = await supabase.from('jobs').update({ status: newStatus }).eq('id', j.id)
    if (error) { toast('error', `Erreur : ${error.message}`); return }
    toast('success', newStatus === 'open' ? 'Offre réouverte.' : 'Offre fermée.')
    loadJobs()
  }

  // ── Candidats : modal (création / édition) + CV ────────────────────
  function openNewCandidate() {
    const fallbackJob = selectedJob?.id || jobs.find(j => j.status === 'open')?.id || ''
    setEditingCandidate(null)
    setCandidateForm({ ...emptyCandidateForm, job_id: fallbackJob })
    setCvFile(null); setCvError(null)
    setShowCandidateModal(true)
  }
  function openEditCandidate(c: CandidateRow) {
    setEditingCandidate(c)
    setCandidateForm({ job_id: c.job_id || '', name: c.name, email: c.email, phone: c.phone || '', notes: c.notes || '', status: c.status })
    setCvFile(null); setCvError(null)
    setShowCandidateModal(true)
  }

  async function saveCandidate(e: React.FormEvent) {
    e.preventDefault()
    setSavingCandidate(true); setCvError(null)
    let cvUrl: string | null = editingCandidate?.cv_url || null

    // Upload du CV si l'utilisateur en a sélectionné un
    if (cvFile) {
      const vErr = validateCvFile(cvFile)
      if (vErr) {
        setCvError(vErr)
        setSavingCandidate(false)
        return
      }
      const { storagePath, error: upErr } = await uploadFile('cvs', uploadFilePath('cvs', cvFile.name), cvFile)
      if (upErr || !storagePath) {
        setCvError(`Échec de l'upload du CV (${upErr || 'erreur inconnue'}). Le candidat n'a pas été enregistré — réessayez.`)
        setSavingCandidate(false)
        return
      }
      cvUrl = storagePath
    }

    const payload = {
      job_id: candidateForm.job_id || null,
      name: candidateForm.name.trim(),
      email: candidateForm.email.trim(),
      phone: candidateForm.phone.trim() || null,
      notes: candidateForm.notes.trim() || null,
      cv_url: cvUrl,
      status: candidateForm.status
    }

    if (editingCandidate) {
      const { error } = await supabase.from('candidates').update(payload).eq('id', editingCandidate.id)
      if (error) { setCvError(`Erreur : ${error.message}`); setSavingCandidate(false); return }
      toast('success', 'Candidat mis à jour.')
    } else {
      const { error } = await supabase.from('candidates').insert(payload)
      if (error) { setCvError(`Erreur : ${error.message}`); setSavingCandidate(false); return }
      toast('success', 'Candidat ajouté.')
    }
    setSavingCandidate(false); setShowCandidateModal(false); setCvFile(null)
    loadCandidates(selectedJob?.id)
  }

  async function updateCandidateStatus(id: string, status: CandidateStatus) {
    const { error } = await supabase.from('candidates').update({ status }).eq('id', id)
    if (error) { toast('error', `Erreur : ${error.message}`); return }
    toast('success', 'Statut du candidat mis à jour.')
    loadCandidates(selectedJob?.id)
  }

  // Ouvre le CV (bucket privé) via URL signée, dans un nouvel onglet
  async function openCv(c: CandidateRow) {
    if (!c.cv_url || cvLoadingId) return
    setCvLoadingId(c.id)
    let url: string | null = null
    if (c.cv_url.startsWith('cvs/')) url = await getSignedFileUrl('cvs', c.cv_url)
    else if (/^https?:\/\//i.test(c.cv_url)) url = c.cv_url // anciennes données : URL complète
    setCvLoadingId(null)
    if (url) window.open(url, '_blank', 'noopener')
    else toast('error', 'Impossible de récupérer le CV (stockage non configuré ?).')
  }

  // ── Pipeline ───────────────────────────────────────────────────────
  const openJobs = jobs.filter(j => j.status === 'open')
  const jobCandidates = selectedJob ? candidates.filter(c => c.job_id === selectedJob.id) : candidates
  const filteredCandidates = statusFilter === 'all' ? jobCandidates : jobCandidates.filter(c => c.status === statusFilter)
  const statusCounts = (Object.keys(statusLabels) as CandidateStatus[]).reduce<Record<string, number>>((acc, s) => {
    acc[s] = jobCandidates.filter(c => c.status === s).length
    return acc
  }, {})

  function goToCandidates(j: Job) { setSelectedJob(j); setStatusFilter('all'); loadCandidates(j.id); setTab('candidates') }
  function resetJobFilter() { setSelectedJob(null); setStatusFilter('all'); loadCandidates() }

  return (
    <div>
      <div className="page-header">
        <h2>👨‍💼 Recrutement</h2>
        {tab === 'candidates'
          ? <button className="btn-primary" onClick={openNewCandidate} disabled={jobs.length === 0}>+ Nouveau candidat</button>
          : <button className="btn-primary" onClick={openNewJob}>+ Nouvelle offre</button>}
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: '#f0ece4', borderRadius: 8, padding: 4, width: 'fit-content' }}>
          {(['jobs', 'candidates'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); if (t === 'candidates' && !selectedJob) loadCandidates() }}
              style={{ padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
                background: tab === t ? 'white' : 'transparent',
                color: tab === t ? 'var(--hub-green)' : '#666',
                boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
              {t === 'jobs' ? `💼 Offres (${openJobs.length} ouvertes)` : `👤 Candidats (${jobCandidates.length})`}
            </button>
          ))}
        </div>

        {/* Compteurs par statut (pipeline) */}
        {tab === 'candidates' && jobCandidates.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <button className={`badge ${statusFilter === 'all' ? 'badge-blue' : 'badge-gray'}`} style={{ cursor: 'pointer', border: 'none' }} onClick={() => setStatusFilter('all')}>
              Tous ({jobCandidates.length})
            </button>
            {(Object.keys(statusLabels) as CandidateStatus[]).map(s => (
              <button key={s} className={`badge ${statusFilter === s ? 'badge-blue' : statusColors[s]}`} style={{ cursor: 'pointer', border: 'none' }}
                onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}>
                {statusLabels[s]} ({statusCounts[s]})
              </button>
            ))}
          </div>
        )}

        {tab === 'jobs' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {jobs.map(j => (
              <div key={j.id} style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden', position: 'relative' }}>
                <div style={{ padding: '20px', borderBottom: '1px solid #f0ece4' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <span className={`badge ${j.status === 'open' ? 'badge-green' : 'badge-gray'}`}>
                      {j.status === 'open' ? '● Ouvert' : '○ Fermé'}
                    </span>
                    <span className="badge badge-blue">{typeLabels[j.type]}</span>
                  </div>
                  <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '1rem', margin: '8px 0 4px' }}>{j.title}</h3>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>🏢 {j.department} · 📍 {j.location}</div>
                  {j.deadline && <div style={{ fontSize: '0.75rem', color: '#92400e', marginTop: 4 }}>⏰ Clôture : {new Date(j.deadline).toLocaleDateString('fr-FR')}</div>}
                  <p style={{ fontSize: '0.8rem', color: '#555', marginTop: 10, lineHeight: 1.5 }}>{j.description.slice(0, 120)}{j.description.length > 120 ? '…' : ''}</p>
                </div>
                <div style={{ padding: '12px 20px', display: 'flex', gap: 8, background: '#fafaf7' }}>
                  <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: '0.75rem', flex: 1 }}
                    onClick={() => goToCandidates(j)}>
                    👤 {candidates.filter(c => c.job_id === j.id).length} candidat(s)
                  </button>
                  <button className="btn-ghost" style={{ padding: '6px 10px', fontSize: '0.75rem' }} title="Modifier l'offre" onClick={() => openEditJob(j)}>✏️</button>
                  <button className="btn-ghost" style={{ padding: '6px 10px', fontSize: '0.75rem' }} title={j.status === 'open' ? 'Fermer l\'offre' : 'Rouvrir l\'offre'} onClick={() => toggleJobStatus(j)}>
                    {j.status === 'open' ? '⏸' : '▶'}
                  </button>
                </div>
              </div>
            ))}
            {jobs.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: '#999' }}>
                Aucune offre d&apos;emploi. Créez votre première offre !
              </div>
            )}
          </div>
        )}

        {tab === 'candidates' && (
          <div>
            {selectedJob && (
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: '0.875rem', color: '#666' }}>Filtré par :</span>
                <span className="badge badge-blue">💼 {selectedJob.title}</span>
                <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={resetJobFilter}>✕ Tous les candidats</button>
              </div>
            )}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <table className="hub-table">
                <thead>
                  <tr><th>Candidat</th><th>Poste</th><th>Contact</th><th>Statut</th><th>CV</th><th>Date</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {filteredCandidates.map(c => (
                    <tr key={c.id}>
                      <td><strong>{c.name}</strong></td>
                      <td style={{ fontSize: '0.8rem', color: '#666' }}>{c.job?.title || <span style={{ color: '#999', fontStyle: 'italic' }}>Poste supprimé</span>}</td>
                      <td style={{ fontSize: '0.8rem' }}>
                        <div>{c.email}</div>
                        {c.phone && <div style={{ color: '#666' }}>{c.phone}</div>}
                      </td>
                      <td>
                        <select
                          value={c.status}
                          onChange={e => updateCandidateStatus(c.id, e.target.value as CandidateStatus)}
                          className={`badge ${statusColors[c.status]}`}
                          style={{ border: 'none', cursor: 'pointer', background: 'transparent' }}>
                          {(Object.keys(statusLabels) as CandidateStatus[]).map(k => <option key={k} value={k}>{statusLabels[k]}</option>)}
                        </select>
                      </td>
                      <td>
                        {c.cv_url
                          ? <span className="badge badge-green">CV ✓</span>
                          : <span className="badge badge-gray">—</span>}
                      </td>
                      <td style={{ color: '#666', fontSize: '0.8rem' }}>{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {c.cv_url && (
                            <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }}
                              onClick={() => openCv(c)} disabled={cvLoadingId === c.id}>
                              {cvLoadingId === c.id ? '⏳' : '📄 CV'}
                            </button>
                          )}
                          <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} title="Modifier le candidat" onClick={() => openEditCandidate(c)}>✏️</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredCandidates.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                        {jobCandidates.length === 0
                          ? <span>Aucun candidat {selectedJob ? 'pour cette offre' : ''}. Ajoutez-en un avec « + Nouveau candidat ».</span>
                          : 'Aucun candidat avec ce statut.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal offre */}
      {showJobModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowJobModal(false)}>
          <div className="modal-box" style={{ maxWidth: 600 }}>
            <div className="modal-title">{editingJob ? '✏️ Modifier l\'offre' : '➕ Nouvelle offre d\'emploi'}</div>
            <form onSubmit={saveJob}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Intitulé du poste *</label>
                  <input className="hub-input" value={jobForm.title} onChange={e => setJobForm({ ...jobForm, title: e.target.value })} required placeholder="Ex: Responsable Commercial" />
                </div>
                <div className="hub-form-group">
                  <label>Département *</label>
                  <input className="hub-input" value={jobForm.department} onChange={e => setJobForm({ ...jobForm, department: e.target.value })} required placeholder="Commercial, Production..." />
                </div>
                <div className="hub-form-group">
                  <label>Type de contrat</label>
                  <select className="hub-select" value={jobForm.type} onChange={e => setJobForm({ ...jobForm, type: e.target.value as JobType })}>
                    {(Object.keys(typeLabels) as JobType[]).map(k => <option key={k} value={k}>{typeLabels[k]}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Lieu</label>
                  <input className="hub-input" value={jobForm.location} onChange={e => setJobForm({ ...jobForm, location: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>Date limite de candidature</label>
                  <input className="hub-input" type="date" value={jobForm.deadline} onChange={e => setJobForm({ ...jobForm, deadline: e.target.value })} />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Description du poste *</label>
                  <textarea className="hub-input" value={jobForm.description} onChange={e => setJobForm({ ...jobForm, description: e.target.value })} required rows={3} style={{ resize: 'vertical' }} />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Profil requis</label>
                  <textarea className="hub-input" value={jobForm.requirements} onChange={e => setJobForm({ ...jobForm, requirements: e.target.value })} rows={2} style={{ resize: 'vertical' }} placeholder="Diplômes, expériences..." />
                </div>
              </div>
              {jobError && <div style={{ color: '#b91c1c', fontSize: '0.8rem', marginTop: 8 }}>⚠ {jobError}</div>}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowJobModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={savingJob}>{savingJob ? 'Enregistrement...' : editingJob ? 'Enregistrer' : 'Publier l\'offre'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal candidat (création / édition + upload CV) */}
      {showCandidateModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCandidateModal(false)}>
          <div className="modal-box" style={{ maxWidth: 560 }}>
            <div className="modal-title">{editingCandidate ? `✏️ Modifier ${editingCandidate.name}` : '➕ Nouveau candidat'}</div>
            <form onSubmit={saveCandidate}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Offre d&apos;emploi *</label>
                  <select className="hub-select" value={candidateForm.job_id} onChange={e => setCandidateForm({ ...candidateForm, job_id: e.target.value })} required>
                    <option value="" disabled>Choisir une offre...</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>{j.title} — {j.status === 'open' ? 'Ouverte' : 'Fermée'}</option>)}
                  </select>
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Nom complet *</label>
                  <input className="hub-input" value={candidateForm.name} onChange={e => setCandidateForm({ ...candidateForm, name: e.target.value })} required placeholder="Ex: Aymar MABIALA" />
                </div>
                <div className="hub-form-group">
                  <label>Email *</label>
                  <input className="hub-input" type="email" value={candidateForm.email} onChange={e => setCandidateForm({ ...candidateForm, email: e.target.value })} required placeholder="candidat@exemple.com" />
                </div>
                <div className="hub-form-group">
                  <label>Téléphone</label>
                  <input className="hub-input" value={candidateForm.phone} onChange={e => setCandidateForm({ ...candidateForm, phone: e.target.value })} placeholder="+242 ..." />
                </div>
                <div className="hub-form-group">
                  <label>Statut</label>
                  <select className="hub-select" value={candidateForm.status} onChange={e => setCandidateForm({ ...candidateForm, status: e.target.value as CandidateStatus })}>
                    {(Object.keys(statusLabels) as CandidateStatus[]).map(k => <option key={k} value={k}>{statusLabels[k]}</option>)}
                  </select>
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>CV (PDF, DOC, DOCX — max 5 Mo)</label>
                  <input className="hub-input" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={e => { setCvFile(e.target.files?.[0] || null); setCvError(null) }} />
                  {editingCandidate?.cv_url && !cvFile && (
                    <div style={{ fontSize: '0.75rem', color: '#666', marginTop: 4 }}>📄 CV actuel enregistré — choisissez un fichier pour le remplacer.</div>
                  )}
                  {cvFile && (
                    <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: 4 }}>
                      ✓ {cvFile.name} ({Math.max(1, Math.round(cvFile.size / 1024))} Ko) — sera envoyé à l&apos;enregistrement.
                    </div>
                  )}
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Notes internes</label>
                  <textarea className="hub-input" value={candidateForm.notes} onChange={e => setCandidateForm({ ...candidateForm, notes: e.target.value })} rows={2} style={{ resize: 'vertical' }} placeholder="Disponibilité, prétentions, remarques..." />
                </div>
              </div>
              {cvError && (
                <div style={{ color: '#b91c1c', fontSize: '0.8rem', marginTop: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px' }}>
                  ⚠ {cvError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowCandidateModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={savingCandidate}>{savingCandidate ? 'Enregistrement...' : editingCandidate ? 'Enregistrer' : 'Ajouter le candidat'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
