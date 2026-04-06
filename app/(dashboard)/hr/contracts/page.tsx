'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Employee } from '@/types'
import { useToast } from '@/components/ui/Toast'
import { generateContractPDF } from '@/lib/pdf/generateContractPDF'

const contractLabels: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', stage: 'Stage', freelance: 'Freelance' }

export default function ContractsPage() {
  const [docs, setDocs] = useState<any[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<any>(null)
  const { toast } = useToast()
  const emptyForm = {
    employee_id: '', contract_type: 'cdi', start_date: new Date().toISOString().split('T')[0],
    end_date: '', salary: 0, position: '', department: '', clauses: '',
  }
  const [form, setForm] = useState(emptyForm)
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    const [docsRes, empRes] = await Promise.all([
      supabase.from('employee_documents').select('*, employee:employees(id,full_name,position,department,contract_type,salary)')
        .eq('type', 'contrat').order('created_at', { ascending: false }),
      supabase.from('employees').select('*').eq('status', 'actif').order('full_name'),
    ])
    if (docsRes.error || empRes.error) toast('error', 'Erreur de chargement des contrats.')
    setDocs(docsRes.data || []); setEmployees(empRes.data || []); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function prefillFromEmployee(empId: string) {
    const emp = employees.find(e => e.id === empId)
    if (emp) setForm(f => ({ ...f, employee_id: empId, contract_type: emp.contract_type, salary: emp.salary || 0, position: emp.position, department: emp.department }))
    else setForm(f => ({ ...f, employee_id: empId }))
  }

  function openEdit(doc: any) {
    const c = doc.content || {}
    setEditing(doc)
    setForm({
      employee_id: doc.employee_id || '',
      contract_type: c.contract_type || 'cdi',
      start_date: doc.start_date || '',
      end_date: doc.end_date || '',
      salary: c.salary || 0,
      position: c.position || '',
      department: c.department || '',
      clauses: c.clauses || '',
    })
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.employee_id) { toast('warning', 'Sélectionnez un employé.'); return }
    setSaving(true)
    const emp = employees.find(em => em.id === form.employee_id)
    const payload = {
      employee_id: form.employee_id,
      title: `Contrat ${contractLabels[form.contract_type]} — ${emp?.full_name || ''}`,
      issued_date: form.start_date, start_date: form.start_date,
      end_date: form.contract_type === 'cdd' || form.contract_type === 'stage' ? form.end_date || null : null,
      content: { contract_type: form.contract_type, salary: form.salary, position: form.position, department: form.department, clauses: form.clauses },
    }
    if (editing) {
      const { error } = await supabase.from('employee_documents').update(payload).eq('id', editing.id)
      if (error) toast('error', `Erreur : ${error.message}`)
      else toast('success', 'Contrat mis à jour.')
    } else {
      const { error } = await supabase.from('employee_documents').insert({ ...payload, type: 'contrat', status: 'approved' })
      if (error) toast('error', `Erreur : ${error.message}`)
      else toast('success', 'Contrat créé.')
    }
    setSaving(false); setShowModal(false); setEditing(null); load()
  }

  async function handleDelete(docId: string) {
    if (!confirm('Supprimer définitivement ce contrat ?')) return
    const { error } = await supabase.from('employee_documents').delete().eq('id', docId)
    if (error) toast('error', `Erreur : ${error.message}`)
    else { toast('success', 'Contrat supprimé.'); load() }
  }

  function downloadContractPDF(doc: any) {
    const emp = doc.employee
    const c = doc.content || {}
    const pdf = generateContractPDF({
      employee_name: emp?.full_name || '\u2014',
      position: c.position || emp?.position || '\u2014',
      department: c.department || emp?.department || '\u2014',
      contract_type: c.contract_type || 'cdi',
      salary: Number(c.salary || 0),
      start_date: doc.start_date || doc.issued_date || new Date().toISOString(),
      end_date: doc.end_date || null,
      issued_date: doc.issued_date || doc.created_at || new Date().toISOString(),
      clauses: c.clauses || undefined,
    })
    pdf.save(`Contrat_${emp?.full_name || 'employe'}.pdf`)
  }

  function printContract(doc: any) {
    const emp = doc.employee
    const c = doc.content || {}
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Contrat ${emp?.full_name}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:white;line-height:1.7}@page{margin:20mm 22mm;size:A4}
.header{background:#1a3d2b;color:white;padding:28px 36px;display:flex;justify-content:space-between;align-items:center}
.company-name{font-size:1.5rem;font-weight:800;font-family:Georgia,serif}.company-sub{font-size:0.7rem;opacity:0.65;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px}
.badge{background:#d4a017;color:white;padding:5px 14px;border-radius:4px;font-weight:700;font-size:0.85rem}
.body{padding:32px 36px;font-size:0.92rem}
h2{color:#1a3d2b;font-size:1.15rem;margin:24px 0 12px;border-bottom:2px solid #d4a017;padding-bottom:4px}
.article{margin-bottom:14px}.article strong{color:#1a3d2b}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
.party-box{background:#f8f5ee;padding:16px;border-radius:8px}
.party-label{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:6px}
.sig-section{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:40px;padding-top:20px;border-top:1px solid #ddd}
.sig-box{text-align:center}.sig-area{border:1.5px dashed #ccc;border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:0.8rem;margin-top:8px}
.footer{padding:12px 36px;background:#0f1f17;color:rgba(255,255,255,0.5);font-size:0.7rem;display:flex;justify-content:space-between;margin-top:40px}
</style></head><body>
<div class="header"><div><div class="company-name">HUB Distribution</div><div class="company-sub">Transformation & Distribution Agricole</div></div><div class="badge">CONTRAT DE TRAVAIL</div></div>
<div class="body">
<div class="parties"><div class="party-box"><div class="party-label">Employeur</div><div style="font-weight:700;font-size:1rem">HUB Distribution SARL</div><div style="font-size:0.85rem;color:#555">Brazzaville, Congo<br>RCCM: BZV-XXXX-XX — NIF: XXXXXXXXXX</div></div>
<div class="party-box"><div class="party-label">Employe(e)</div><div style="font-weight:700;font-size:1rem">${emp?.full_name || '—'}</div><div style="font-size:0.85rem;color:#555">Poste: ${c.position || emp?.position || '—'}<br>Departement: ${c.department || emp?.department || '—'}</div></div></div>

<h2>Article 1 — Objet du contrat</h2>
<div class="article">Le present contrat est un <strong>${contractLabels[c.contract_type] || 'CDI'}</strong>. L'employe(e) est engage(e) en qualite de <strong>${c.position || emp?.position || '—'}</strong> au sein du departement <strong>${c.department || emp?.department || '—'}</strong>.</div>

<h2>Article 2 — Duree</h2>
<div class="article">Le contrat prend effet a compter du <strong>${doc.start_date ? new Date(doc.start_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</strong>${doc.end_date ? ` et se termine le <strong>${new Date(doc.end_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>` : ', pour une duree indeterminee'}.</div>

<h2>Article 3 — Remuneration</h2>
<div class="article">L'employe(e) percevra une remuneration mensuelle brute de <strong>${Number(c.salary || 0).toLocaleString('fr-FR')} FCFA</strong>, payable a terme echu.</div>

<h2>Article 4 — Periode d'essai</h2>
<div class="article">Le contrat est soumis a une periode d'essai de ${c.contract_type === 'cdi' ? 'trois (3) mois' : c.contract_type === 'cdd' ? 'un (1) mois' : 'quinze (15) jours'}, renouvelable une fois.</div>

<h2>Article 5 — Obligations</h2>
<div class="article">L'employe(e) s'engage a respecter le reglement interieur, les horaires de travail et les consignes de securite. Il/elle est tenu(e) a une obligation de confidentialite concernant les informations de l'entreprise.</div>

<h2>Article 6 — Conges</h2>
<div class="article">L'employe(e) beneficie de trente (30) jours de conge annuel paye conformement a la legislation en vigueur.</div>

${c.clauses ? `<h2>Article 7 — Clauses particulieres</h2><div class="article">${c.clauses}</div>` : ''}

<h2>Article ${c.clauses ? '8' : '7'} — Droit applicable</h2>
<div class="article">Le present contrat est regi par le droit du travail de la Republique du Congo.</div>

<div style="margin-top:20px;font-size:0.85rem;color:#555">Fait en deux exemplaires originaux a Brazzaville, le ${new Date(doc.issued_date || doc.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}.</div>

<div class="sig-section"><div class="sig-box"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">L'Employeur — HUB Distribution</div><div class="sig-area">Signature & cachet</div></div>
<div class="sig-box"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">L'Employe(e) — ${emp?.full_name || ''}</div><div class="sig-area">Lu et approuve, signature</div></div></div>
</div>
<div class="footer"><span>HUB Distribution SARL — Brazzaville, Congo</span><span>Document genere le ${new Date().toLocaleDateString('fr-FR')}</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 800) }
  }

  const filtered = docs.filter(d => {
    const s = search.toLowerCase()
    return !s || d.employee?.full_name?.toLowerCase().includes(s) || d.title?.toLowerCase().includes(s)
  })

  return (
    <div className="invoice-page">
      <div className="page-header">
        <h2>📝 Contrats de travail</h2>
        <button className="btn-primary" onClick={() => { setEditing(null); setForm(emptyForm); setShowModal(true) }}>+ Nouveau contrat</button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 14, marginBottom: 24 }}>
          <div className="stat-card green"><div className="stat-value">{docs.length}</div><div className="stat-label">Total contrats</div></div>
          <div className="stat-card blue"><div className="stat-value">{docs.filter(d => (d.content as any)?.contract_type === 'cdi').length}</div><div className="stat-label">CDI</div></div>
          <div className="stat-card amber"><div className="stat-value">{docs.filter(d => (d.content as any)?.contract_type === 'cdd').length}</div><div className="stat-label">CDD</div></div>
          <div className="stat-card green"><div className="stat-value">{docs.filter(d => ['stage', 'freelance'].includes((d.content as any)?.contract_type)).length}</div><div className="stat-label">Stage / Freelance</div></div>
        </div>

        <input className="hub-input" style={{ maxWidth: 320, marginBottom: 16 }} placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
            <table className="hub-table">
              <thead><tr><th>Employe</th><th>Type</th><th>Poste</th><th>Salaire</th><th>Debut</th><th>Fin</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(d => {
                  const c = d.content || {}
                  return (
                    <tr key={d.id}>
                      <td><strong>{d.employee?.full_name || '—'}</strong></td>
                      <td><span className="badge badge-blue">{contractLabels[(c as any).contract_type] || '—'}</span></td>
                      <td style={{ color: '#555' }}>{(c as any).position || d.employee?.position || '—'}</td>
                      <td style={{ fontWeight: 700 }}>{Number((c as any).salary || 0).toLocaleString('fr-FR')} FCFA</td>
                      <td style={{ fontSize: '0.85rem', color: '#666' }}>{d.start_date ? new Date(d.start_date).toLocaleDateString('fr-FR') : '—'}</td>
                      <td style={{ fontSize: '0.85rem', color: '#666' }}>{d.end_date ? new Date(d.end_date).toLocaleDateString('fr-FR') : 'Indetermine'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => downloadContractPDF(d)} title="T\u00e9l\u00e9charger PDF">📥</button>
                          <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => printContract(d)} title="Imprimer">🖨️</button>
                          <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => openEdit(d)}>✏️</button>
                          <button className="btn-danger" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => handleDelete(d.id)}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun contrat</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 600 }}>
            <div className="modal-title">{editing ? '✏️ Modifier le contrat' : '📝 Générer un contrat'}</div>
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Employe *</label>
                  <select className="hub-select" required value={form.employee_id} onChange={e => prefillFromEmployee(e.target.value)}>
                    <option value="">-- Selectionner --</option>
                    {employees.map(em => <option key={em.id} value={em.id}>{em.full_name} — {em.position}</option>)}
                  </select>
                </div>
                <div className="hub-form-group"><label>Type de contrat</label>
                  <select className="hub-select" value={form.contract_type} onChange={e => setForm(f => ({ ...f, contract_type: e.target.value }))}>
                    {Object.entries(contractLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="hub-form-group"><label>Salaire (FCFA)</label>
                  <input className="hub-input" type="number" min={0} value={form.salary} onChange={e => setForm(f => ({ ...f, salary: Number(e.target.value) }))} />
                </div>
                <div className="hub-form-group"><label>Poste</label>
                  <input className="hub-input" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} />
                </div>
                <div className="hub-form-group"><label>Departement</label>
                  <input className="hub-input" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
                </div>
                <div className="hub-form-group"><label>Date de debut *</label>
                  <input className="hub-input" type="date" required value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                </div>
                {(form.contract_type === 'cdd' || form.contract_type === 'stage') && (
                  <div className="hub-form-group"><label>Date de fin</label>
                    <input className="hub-input" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                  </div>
                )}
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}><label>Clauses particulieres</label>
                  <textarea className="hub-input" rows={3} value={form.clauses} onChange={e => setForm(f => ({ ...f, clauses: e.target.value }))} placeholder="Clause de non-concurrence, avantages en nature..." style={{ resize: 'vertical' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? '...' : editing ? 'Mettre à jour' : 'Générer le contrat'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
