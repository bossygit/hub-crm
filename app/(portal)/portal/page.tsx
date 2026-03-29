'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const documentTypes = [
  'Attestation fiscale', 'Extrait RCCM', 'Attestation de bonne exécution',
  'Bilan comptable', 'Statuts de la société', 'Contrat-cadre',
  'Certificat d\'origine', 'Fiche produit', 'Rapport d\'activité', 'Autre'
]

const jobs_public_types = ['cdi', 'cdd', 'stage', 'freelance'] as const

export default function PortalPage() {
  const [activeSection, setActiveSection] = useState<'requests' | 'jobs' | 'apply'>('requests')
  const [jobs, setJobs] = useState<any[]>([])
  const [jobsLoaded, setJobsLoaded] = useState(false)
  const [requestForm, setRequestForm] = useState({
    requester_name: '', organization: '', email: '', phone: '',
    document_type: '', description: ''
  })
  const [applyForm, setApplyForm] = useState({
    job_id: '', name: '', email: '', phone: '', cover_letter: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [requestSuccess, setRequestSuccess] = useState(false)
  const [applySuccess, setApplySuccess] = useState(false)
  const [trackId, setTrackId] = useState('')
  const [trackResult, setTrackResult] = useState<any>(null)
  const [trackError, setTrackError] = useState('')
  const supabase = createClient()

  async function loadJobs() {
    if (jobsLoaded) return
    const { data } = await supabase.from('jobs').select('*').eq('status', 'open').order('created_at', { ascending: false })
    setJobs(data || [])
    setJobsLoaded(true)
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true)
    await supabase.from('document_requests').insert(requestForm)
    setSubmitting(false)
    setRequestSuccess(true)
    setRequestForm({ requester_name: '', organization: '', email: '', phone: '', document_type: '', description: '' })
  }

  async function submitApplication(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true)
    await supabase.from('candidates').insert({ ...applyForm, status: 'nouveau' })
    setSubmitting(false)
    setApplySuccess(true)
    setApplyForm({ job_id: '', name: '', email: '', phone: '', cover_letter: '' })
  }

  async function trackRequest() {
    setTrackError('')
    setTrackResult(null)
    if (!trackId.trim()) return
    const { data } = await supabase.from('document_requests').select('*').ilike('id', `%${trackId.trim()}%`).single()
    if (data) setTrackResult(data)
    else setTrackError('Aucune demande trouvée avec cette référence.')
  }

  const statusLabels: Record<string, string> = {
    pending: '⏳ En attente de traitement',
    processing: '⚙️ En cours de traitement',
    approved: '✅ Approuvée — Document disponible',
    rejected: '❌ Rejetée'
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--hub-cream)' }}>
      {/* Hero */}
      <div className="portal-hero">
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🌿</div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '2.2rem', fontWeight: 800, marginBottom: 8 }}>
            Portail HUB Distribution
          </h1>
          <p style={{ opacity: 0.8, fontSize: '1rem', maxWidth: 520 }}>
            Plateforme dédiée aux partenaires, institutions et candidats.
            Soumettez vos demandes de documents ou postulez à nos offres d&apos;emploi.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
            {[
              { key: 'requests', icon: '📋', label: 'Demande de document' },
              { key: 'jobs', icon: '💼', label: 'Offres d\'emploi' },
              { key: 'apply', icon: '👤', label: 'Postuler' },
            ].map(s => (
              <button key={s.key} onClick={() => { setActiveSection(s.key as any); if (s.key === 'jobs' || s.key === 'apply') loadJobs() }}
                style={{ padding: '12px 22px', borderRadius: 10, border: '2px solid', cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem', transition: 'all 0.15s',
                  borderColor: activeSection === s.key ? 'var(--hub-amber-light)' : 'rgba(255,255,255,0.3)',
                  background: activeSection === s.key ? 'var(--hub-amber)' : 'rgba(255,255,255,0.1)',
                  color: 'white' }}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 20px' }}>

        {/* Section: Demande de document */}
        {activeSection === 'requests' && (
          <div>
            <h2 style={{ fontFamily: 'Georgia, serif', color: 'var(--hub-green)', marginBottom: 8, fontSize: '1.5rem' }}>
              📋 Demande de document officiel
            </h2>
            <p style={{ color: '#666', marginBottom: 24, fontSize: '0.875rem' }}>
              Pour les institutions (DGI, assurances, douanes, etc.) et partenaires souhaitant obtenir un document officiel de HUB Distribution.
            </p>

            {requestSuccess ? (
              <div className="alert alert-success" style={{ fontSize: '1rem', padding: '20px' }}>
                ✅ <strong>Demande envoyée avec succès !</strong> Notre équipe vous contactera sous 48h à l&apos;adresse indiquée. Conservez votre email de confirmation.
                <button className="btn-ghost" style={{ marginTop: 12, display: 'block' }} onClick={() => setRequestSuccess(false)}>
                  Nouvelle demande
                </button>
              </div>
            ) : (
              <div style={{ background: 'white', borderRadius: 16, padding: 32, border: '1px solid #e8e4db' }}>
                <form onSubmit={submitRequest}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div className="hub-form-group">
                      <label>Votre nom *</label>
                      <input className="hub-input" required value={requestForm.requester_name}
                        onChange={e => setRequestForm({...requestForm, requester_name: e.target.value})}
                        placeholder="Prénom et Nom" />
                    </div>
                    <div className="hub-form-group">
                      <label>Organisation / Institution *</label>
                      <input className="hub-input" required value={requestForm.organization}
                        onChange={e => setRequestForm({...requestForm, organization: e.target.value})}
                        placeholder="Ex: Direction des Impôts" />
                    </div>
                    <div className="hub-form-group">
                      <label>Email *</label>
                      <input className="hub-input" type="email" required value={requestForm.email}
                        onChange={e => setRequestForm({...requestForm, email: e.target.value})}
                        placeholder="contact@institution.cg" />
                    </div>
                    <div className="hub-form-group">
                      <label>Téléphone</label>
                      <input className="hub-input" value={requestForm.phone}
                        onChange={e => setRequestForm({...requestForm, phone: e.target.value})}
                        placeholder="+242 06 ..." />
                    </div>
                    <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                      <label>Type de document souhaité *</label>
                      <select className="hub-select" required value={requestForm.document_type}
                        onChange={e => setRequestForm({...requestForm, document_type: e.target.value})}>
                        <option value="">-- Sélectionner le document --</option>
                        {documentTypes.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </div>
                    <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                      <label>Motif / Précisions</label>
                      <textarea className="hub-input" value={requestForm.description}
                        onChange={e => setRequestForm({...requestForm, description: e.target.value})}
                        rows={3} style={{ resize: 'vertical' }}
                        placeholder="Expliquez le contexte ou l'utilisation prévue du document..." />
                    </div>
                  </div>
                  <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '14px', marginTop: 8 }} disabled={submitting}>
                    {submitting ? 'Envoi en cours...' : '📤 Soumettre la demande'}
                  </button>
                </form>
              </div>
            )}

            {/* Tracking */}
            <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e8e4db', marginTop: 24 }}>
              <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', marginBottom: 12, fontSize: '0.95rem' }}>🔍 Suivre une demande existante</h3>
              <div style={{ display: 'flex', gap: 12 }}>
                <input className="hub-input" placeholder="Référence (ex: A1B2C3D4)" value={trackId}
                  onChange={e => setTrackId(e.target.value)} style={{ flex: 1 }} />
                <button className="btn-primary" onClick={trackRequest}>Suivre</button>
              </div>
              {trackError && <div className="alert alert-error" style={{ marginTop: 12 }}>{trackError}</div>}
              {trackResult && (
                <div className="alert alert-success" style={{ marginTop: 12 }}>
                  <div>
                    <strong>{trackResult.requester_name}</strong> — {trackResult.document_type}<br />
                    <span style={{ fontWeight: 700 }}>{statusLabels[trackResult.status]}</span>
                    {trackResult.response_notes && <div style={{ marginTop: 4, fontSize: '0.8rem' }}>📝 {trackResult.response_notes}</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section: Offres d'emploi */}
        {activeSection === 'jobs' && (
          <div>
            <h2 style={{ fontFamily: 'Georgia, serif', color: 'var(--hub-green)', marginBottom: 8, fontSize: '1.5rem' }}>
              💼 Nos offres d&apos;emploi
            </h2>
            <p style={{ color: '#666', marginBottom: 24, fontSize: '0.875rem' }}>
              Rejoignez l&apos;équipe HUB Distribution et participez à la transformation agricole en République du Congo.
            </p>
            <div style={{ display: 'grid', gap: 16 }}>
              {jobs.map(j => (
                <div key={j.id} style={{ background: 'white', borderRadius: 12, padding: '24px', border: '1px solid #e8e4db' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '1.1rem', margin: '0 0 4px' }}>{j.title}</h3>
                      <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 8 }}>🏢 {j.department} · 📍 {j.location}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span className="badge badge-green">{j.type.toUpperCase()}</span>
                        {j.deadline && <span className="badge badge-amber">⏰ Avant le {new Date(j.deadline).toLocaleDateString('fr-FR')}</span>}
                      </div>
                    </div>
                    <button className="btn-primary"
                      onClick={() => { setApplyForm({...applyForm, job_id: j.id}); setActiveSection('apply') }}>
                      Postuler →
                    </button>
                  </div>
                  <p style={{ color: '#555', fontSize: '0.875rem', marginTop: 14, lineHeight: 1.6 }}>{j.description}</p>
                  {j.requirements && (
                    <div style={{ marginTop: 12, background: '#f8f5ee', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem', color: '#555' }}>
                      <strong>Profil recherché :</strong> {j.requirements}
                    </div>
                  )}
                </div>
              ))}
              {jobs.length === 0 && (
                <div style={{ textAlign: 'center', padding: 60, color: '#999', background: 'white', borderRadius: 12, border: '1px solid #e8e4db' }}>
                  Aucune offre d&apos;emploi disponible pour le moment.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section: Candidature */}
        {activeSection === 'apply' && (
          <div>
            <h2 style={{ fontFamily: 'Georgia, serif', color: 'var(--hub-green)', marginBottom: 8, fontSize: '1.5rem' }}>
              👤 Soumettre une candidature
            </h2>
            {applySuccess ? (
              <div className="alert alert-success" style={{ fontSize: '1rem', padding: '20px' }}>
                ✅ <strong>Candidature envoyée !</strong> Nous avons bien reçu votre dossier. Nous vous contacterons si votre profil correspond à nos besoins.
                <button className="btn-ghost" style={{ marginTop: 12, display: 'block' }} onClick={() => setApplySuccess(false)}>
                  Nouvelle candidature
                </button>
              </div>
            ) : (
              <div style={{ background: 'white', borderRadius: 16, padding: 32, border: '1px solid #e8e4db' }}>
                <form onSubmit={submitApplication}>
                  <div className="hub-form-group">
                    <label>Poste visé *</label>
                    <select className="hub-select" required value={applyForm.job_id}
                      onChange={e => setApplyForm({...applyForm, job_id: e.target.value})}>
                      <option value="">-- Sélectionner un poste --</option>
                      {jobs.map(j => <option key={j.id} value={j.id}>{j.title} ({j.department})</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div className="hub-form-group">
                      <label>Nom complet *</label>
                      <input className="hub-input" required value={applyForm.name}
                        onChange={e => setApplyForm({...applyForm, name: e.target.value})} placeholder="Prénom et Nom" />
                    </div>
                    <div className="hub-form-group">
                      <label>Email *</label>
                      <input className="hub-input" type="email" required value={applyForm.email}
                        onChange={e => setApplyForm({...applyForm, email: e.target.value})} placeholder="votre@email.com" />
                    </div>
                    <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                      <label>Téléphone</label>
                      <input className="hub-input" value={applyForm.phone}
                        onChange={e => setApplyForm({...applyForm, phone: e.target.value})} placeholder="+242 06 ..." />
                    </div>
                  </div>
                  <div className="hub-form-group">
                    <label>Lettre de motivation</label>
                    <textarea className="hub-input" value={applyForm.cover_letter}
                      onChange={e => setApplyForm({...applyForm, cover_letter: e.target.value})}
                      rows={5} style={{ resize: 'vertical' }}
                      placeholder="Présentez-vous et expliquez votre motivation..." />
                  </div>
                  <button type="submit" className="btn-primary"
                    style={{ width: '100%', justifyContent: 'center', padding: '14px', marginTop: 8 }} disabled={submitting}>
                    {submitting ? 'Envoi...' : '📤 Envoyer ma candidature'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ background: 'var(--hub-green)', color: 'rgba(255,255,255,0.6)', textAlign: 'center', padding: '24px 20px', fontSize: '0.8rem' }}>
        🌿 HUB Distribution — Transformation & Distribution Agricole — Brazzaville, République du Congo
        <div style={{ marginTop: 8 }}>
          <a href="/login" style={{ color: 'var(--hub-amber-light)', textDecoration: 'none' }}>Accès espace interne →</a>
        </div>
      </div>
    </div>
  )
}
