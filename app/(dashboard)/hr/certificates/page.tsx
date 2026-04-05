'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Employee } from '@/types'
import { useToast } from '@/components/ui/Toast'

const contractLabels: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', stage: 'Stage', freelance: 'Freelance' }

export default function CertificatesPage() {
  const [docs, setDocs] = useState<any[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ employee_id: '', purpose: '' })
  const supabase = createClient()
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: d }, { data: e }] = await Promise.all([
      supabase.from('employee_documents').select('*, employee:employees(id,full_name,position,department,hire_date,contract_type,employee_number)')
        .eq('type', 'attestation_travail').order('created_at', { ascending: false }),
      supabase.from('employees').select('*').eq('status', 'actif').order('full_name'),
    ])
    setDocs(d || []); setEmployees(e || []); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.employee_id) { toast('warning', 'Sélectionnez un employé.'); return }
    setSaving(true)
    const emp = employees.find(em => em.id === form.employee_id)
    await supabase.from('employee_documents').insert({
      employee_id: form.employee_id, type: 'attestation_travail', status: 'approved',
      title: `Attestation de travail — ${emp?.full_name || ''}`,
      issued_date: new Date().toISOString().split('T')[0],
      content: { purpose: form.purpose },
    })
    setSaving(false); setShowModal(false); load()
  }

  function printCertificate(doc: any) {
    const emp = doc.employee
    const today = new Date()
    const hireDate = emp?.hire_date ? new Date(emp.hire_date) : null
    const years = hireDate ? Math.floor((today.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : 0
    const months = hireDate ? Math.floor(((today.getTime() - hireDate.getTime()) / (30.44 * 24 * 60 * 60 * 1000)) % 12) : 0

    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Attestation ${emp?.full_name}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:white;line-height:1.8}@page{margin:25mm;size:A4}
.header{background:#1a3d2b;color:white;padding:28px 40px;display:flex;justify-content:space-between;align-items:center}
.company-name{font-size:1.5rem;font-weight:800;font-family:Georgia,serif}.company-sub{font-size:0.7rem;opacity:0.65;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px}
.badge{background:#d4a017;color:white;padding:5px 14px;border-radius:4px;font-weight:700;font-size:0.85rem}
.body{padding:40px;font-size:0.95rem}
.title{text-align:center;font-size:1.3rem;font-weight:800;color:#1a3d2b;margin:32px 0;text-transform:uppercase;letter-spacing:0.15em;border-bottom:3px solid #d4a017;padding-bottom:10px;display:inline-block;width:100%}
.content{max-width:620px;margin:0 auto;text-align:justify}
.content p{margin-bottom:16px}
.highlight{font-weight:700;color:#1a3d2b}
.sig-section{margin-top:50px;text-align:right;max-width:620px;margin-left:auto;margin-right:auto}
.sig-area{border:1.5px dashed #ccc;border-radius:8px;height:80px;width:240px;display:inline-flex;align-items:center;justify-content:center;color:#ccc;font-size:0.8rem;margin-top:10px}
.footer{padding:12px 40px;background:#0f1f17;color:rgba(255,255,255,0.5);font-size:0.7rem;display:flex;justify-content:space-between;margin-top:60px}
</style></head><body>
<div class="header"><div><div class="company-name">HUB Distribution</div><div class="company-sub">Transformation & Distribution Agricole</div></div><div class="badge">DOCUMENT OFFICIEL</div></div>
<div class="body">
<div class="title">Attestation de Travail</div>
<div class="content">
<p>Je soussigne, le Directeur General de <span class="highlight">HUB Distribution SARL</span>, societe specialisee dans la transformation et la distribution de produits agricoles, sise a Brazzaville, Republique du Congo,</p>
<p>Certifie par la presente que <span class="highlight">${emp?.full_name || '—'}</span>${emp?.employee_number ? ` (matricule ${emp.employee_number})` : ''} est employe(e) au sein de notre societe depuis le <span class="highlight">${hireDate ? hireDate.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</span>, soit une anciennete de <span class="highlight">${years} an(s) et ${months} mois</span>.</p>
<p>Il/Elle occupe le poste de <span class="highlight">${emp?.position || '—'}</span> au sein du departement <span class="highlight">${emp?.department || '—'}</span>, sous contrat <span class="highlight">${contractLabels[emp?.contract_type] || '—'}</span>.</p>
<p>Cette attestation est delivree a l'interesse(e) pour servir et valoir ce que de droit${doc.content?.purpose ? `, notamment pour <span class="highlight">${doc.content.purpose}</span>` : ''}.</p>
<p style="margin-top:30px;font-size:0.85rem;color:#555">Fait a Brazzaville, le ${today.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}.</p>
</div>
<div class="sig-section">
<div style="font-size:0.75rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Le Directeur General</div>
<div style="font-size:0.85rem;color:#555;margin-top:4px">HUB Distribution SARL</div>
<div class="sig-area">Signature & cachet</div>
</div>
</div>
<div class="footer"><span>HUB Distribution SARL — RCCM: BZV-XXXX-XX — NIF: XXXXXXXXXX — Brazzaville, Congo</span><span>Ref: ATT-${doc.id?.slice(-8).toUpperCase() || ''}</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 800) }
  }

  return (
    <div className="invoice-page">
      <div className="page-header">
        <h2>🏛 Attestations de travail</h2>
        <button className="btn-primary" onClick={() => { setForm({ employee_id: '', purpose: '' }); setShowModal(true) }}>+ Generer une attestation</button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 14, marginBottom: 24 }}>
          <div className="stat-card green"><div className="stat-value">{docs.length}</div><div className="stat-label">Attestations emises</div></div>
        </div>

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
            <table className="hub-table">
              <thead><tr><th>Employe</th><th>Poste</th><th>Departement</th><th>Date emission</th><th>Actions</th></tr></thead>
              <tbody>
                {docs.map(d => (
                  <tr key={d.id}>
                    <td><strong>{d.employee?.full_name || '—'}</strong>{d.employee?.employee_number && <div style={{ fontSize: '0.72rem', color: '#999', fontFamily: 'monospace' }}>{d.employee.employee_number}</div>}</td>
                    <td style={{ color: '#555' }}>{d.employee?.position || '—'}</td>
                    <td><span className="badge badge-gray">{d.employee?.department || '—'}</span></td>
                    <td style={{ fontSize: '0.85rem', color: '#666' }}>{new Date(d.issued_date || d.created_at).toLocaleDateString('fr-FR')}</td>
                    <td><button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => printCertificate(d)}>🖨️ Imprimer</button></td>
                  </tr>
                ))}
                {docs.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucune attestation</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box">
            <div className="modal-title">🏛 Generer une attestation de travail</div>
            <form onSubmit={handleSave}>
              <div className="hub-form-group"><label>Employe *</label>
                <select className="hub-select" required value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">-- Selectionner --</option>
                  {employees.map(em => <option key={em.id} value={em.id}>{em.full_name} — {em.position}</option>)}
                </select>
              </div>
              <div className="hub-form-group"><label>Motif (optionnel)</label>
                <input className="hub-input" value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="Ex: demande de pret bancaire, demarche administrative..." />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? '...' : 'Generer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
