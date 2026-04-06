'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import type { Job, Candidate } from '@/types'

const statusColors: Record<string, string> = {
  nouveau: 'badge-gray', en_cours: 'badge-blue', entretien: 'badge-amber',
  accepte: 'badge-green', refuse: 'badge-red'
}
const statusLabels: Record<string, string> = {
  nouveau: 'Nouveau', en_cours: 'En cours', entretien: 'Entretien',
  accepte: 'Accepté ✓', refuse: 'Refusé'
}
const typeLabels: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', stage: 'Stage', freelance: 'Freelance' }
const emptyJob = { title: '', department: '', description: '', requirements: '', location: 'Brazzaville', type: 'cdi' as const, deadline: '' }

export default function RecruitmentPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [candidates, setCandidates] = useState<any[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [tab, setTab] = useState<'jobs' | 'candidates'>('jobs')
  const [showJobModal, setShowJobModal] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [jobForm, setJobForm] = useState(emptyJob)
  const [saving, setSaving] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  async function loadJobs() {
    const { data, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false })
    if (error) { toast('error', 'Erreur de chargement des offres.'); return }
    setJobs(data || [])
  }

  async function loadCandidates(jobId?: string) {
    let q = supabase.from('candidates').select('*, job:jobs(title)').order('created_at', { ascending: false })
    if (jobId) q = q.eq('job_id', jobId)
    const { data, error } = await q
    if (error) { toast('error', 'Erreur de chargement des candidats.'); return }
    setCandidates(data || [])
  }

  useEffect(() => { loadJobs(); loadCandidates() }, [])

  function openNewJob() { setEditingJob(null); setJobForm(emptyJob); setShowJobModal(true) }
  function openEditJob(j: Job) {
    setEditingJob(j)
    setJobForm({ title: j.title, department: j.department, description: j.description, requirements: j.requirements || '', location: j.location, type: j.type, deadline: j.deadline || '' })
    setShowJobModal(true)
  }

  async function saveJob(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    if (editingJob) {
      const { error } = await supabase.from('jobs').update(jobForm).eq('id', editingJob.id)
      if (error) { toast('error', `Erreur : ${error.message}`); setSaving(false); return }
      toast('success', 'Offre mise à jour.')
    } else {
      const { error } = await supabase.from('jobs').insert({ ...jobForm, status: 'open' })
      if (error) { toast('error', `Erreur : ${error.message}`); setSaving(false); return }
      toast('success', 'Offre publiée.')
    }
    setSaving(false); setShowJobModal(false); loadJobs()
  }

  async function toggleJobStatus(j: Job) {
    const newStatus = j.status === 'open' ? 'closed' : 'open'
    const { error } = await supabase.from('jobs').update({ status: newStatus }).eq('id', j.id)
    if (error) { toast('error', `Erreur : ${error.message}`); return }
    toast('success', newStatus === 'open' ? 'Offre réouverte.' : 'Offre fermée.')
    loadJobs()
  }

  async function updateCandidateStatus(id: string, status: string) {
    const { error } = await supabase.from('candidates').update({ status }).eq('id', id)
    if (error) { toast('error', `Erreur : ${error.message}`); return }
    toast('success', 'Statut du candidat mis à jour.')
    loadCandidates(selectedJob?.id)
  }

  const jobCandidates = selectedJob ? candidates.filter(c => c.job_id === selectedJob.id) : candidates

  return (
    <div>
      <div className="page-header">
        <h2>👨‍💼 Recrutement</h2>
        <button className="btn-primary" onClick={openNewJob}>+ Nouvelle offre</button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, background: '#f0ece4', borderRadius: 8, padding: 4, width: 'fit-content' }}>
          {(['jobs', 'candidates'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); if (t === 'candidates') loadCandidates() }}
              style={{ padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
                background: tab === t ? 'white' : 'transparent',
                color: tab === t ? 'var(--hub-green)' : '#666',
                boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
              {t === 'jobs' ? `💼 Offres (${jobs.filter(j => j.status === 'open').length} ouvertes)` : `👤 Candidats (${candidates.length})`}
            </button>
          ))}
        </div>

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
                  {j.deadline && <div style={{ fontSize: '0.75rem', color: '#92400e', marginTop: 4 }}>⏰ Clôture: {new Date(j.deadline).toLocaleDateString('fr-FR')}</div>}
                  <p style={{ fontSize: '0.8rem', color: '#555', marginTop: 10, lineHeight: 1.5 }}>{j.description.slice(0, 120)}...</p>
                </div>
                <div style={{ padding: '12px 20px', display: 'flex', gap: 8, background: '#fafaf7' }}>
                  <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: '0.75rem', flex: 1 }}
                    onClick={() => { setSelectedJob(j); loadCandidates(j.id); setTab('candidates') }}>
                    👤 {candidates.filter(c => c.job_id === j.id).length} candidat(s)
                  </button>
                  <button className="btn-ghost" style={{ padding: '6px 10px', fontSize: '0.75rem' }} onClick={() => openEditJob(j)}>✏️</button>
                  <button className="btn-ghost" style={{ padding: '6px 10px', fontSize: '0.75rem' }} onClick={() => toggleJobStatus(j)}>
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
                <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                  onClick={() => { setSelectedJob(null); loadCandidates() }}>✕ Tous les candidats</button>
              </div>
            )}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <table className="hub-table">
                <thead>
                  <tr><th>Candidat</th><th>Poste</th><th>Contact</th><th>Statut</th><th>Date</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {jobCandidates.map(c => (
                    <tr key={c.id}>
                      <td><strong>{c.name}</strong></td>
                      <td style={{ fontSize: '0.8rem', color: '#666' }}>{c.job?.title}</td>
                      <td style={{ fontSize: '0.8rem' }}>
                        <div>{c.email}</div>
                        {c.phone && <div style={{ color: '#666' }}>{c.phone}</div>}
                      </td>
                      <td>
                        <select
                          value={c.status}
                          onChange={e => updateCandidateStatus(c.id, e.target.value)}
                          className={`badge ${statusColors[c.status]}`}
                          style={{ border: 'none', cursor: 'pointer', background: 'transparent' }}>
                          {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td style={{ color: '#666', fontSize: '0.8rem' }}>{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                      <td>
                        {c.cv_url && <a href={c.cv_url} target="_blank" className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>📎 CV</a>}
                      </td>
                    </tr>
                  ))}
                  {jobCandidates.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#999' }}>Aucun candidat</td></tr>}
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
            <div className="modal-title">{editingJob ? '✏️ Modifier l&apos;offre' : '➕ Nouvelle offre d&apos;emploi'}</div>
            <form onSubmit={saveJob}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Intitulé du poste *</label>
                  <input className="hub-input" value={jobForm.title} onChange={e => setJobForm({...jobForm, title: e.target.value})} required placeholder="Ex: Responsable Commercial" />
                </div>
                <div className="hub-form-group">
                  <label>Département *</label>
                  <input className="hub-input" value={jobForm.department} onChange={e => setJobForm({...jobForm, department: e.target.value})} required placeholder="Commercial, Production..." />
                </div>
                <div className="hub-form-group">
                  <label>Type de contrat</label>
                  <select className="hub-select" value={jobForm.type} onChange={e => setJobForm({...jobForm, type: e.target.value as any})}>
                    {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Lieu</label>
                  <input className="hub-input" value={jobForm.location} onChange={e => setJobForm({...jobForm, location: e.target.value})} />
                </div>
                <div className="hub-form-group">
                  <label>Date limite de candidature</label>
                  <input className="hub-input" type="date" value={jobForm.deadline} onChange={e => setJobForm({...jobForm, deadline: e.target.value})} />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Description du poste *</label>
                  <textarea className="hub-input" value={jobForm.description} onChange={e => setJobForm({...jobForm, description: e.target.value})} required rows={3} style={{ resize: 'vertical' }} />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Profil requis</label>
                  <textarea className="hub-input" value={jobForm.requirements} onChange={e => setJobForm({...jobForm, requirements: e.target.value})} rows={2} style={{ resize: 'vertical' }} placeholder="Diplômes, expériences..." />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowJobModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Enregistrement...' : 'Publier l\'offre'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
