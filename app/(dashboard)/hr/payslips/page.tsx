'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Employee } from '@/types'

const months = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre']

export default function PayslipsPage() {
  const [docs, setDocs] = useState<any[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const now = new Date()
  const [form, setForm] = useState({
    employee_id: '', month: now.getMonth(), year: now.getFullYear(),
    base_salary: 0, transport: 0, housing: 0, bonus: 0,
    cnss_rate: 4, its_rate: 5, other_deduction: 0,
  })
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: d }, { data: e }] = await Promise.all([
      supabase.from('employee_documents').select('*, employee:employees(id,full_name,position,department,employee_number)')
        .eq('type', 'fiche_paie').order('created_at', { ascending: false }),
      supabase.from('employees').select('*').eq('status', 'actif').order('full_name'),
    ])
    setDocs(d || []); setEmployees(e || []); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function prefillSalary(empId: string) {
    const emp = employees.find(e => e.id === empId)
    if (emp) setForm(f => ({ ...f, employee_id: empId, base_salary: emp.salary || 0 }))
    else setForm(f => ({ ...f, employee_id: empId }))
  }

  function compute() {
    const gross = form.base_salary + form.transport + form.housing + form.bonus
    const cnss = Math.round(form.base_salary * form.cnss_rate / 100)
    const its = Math.round(gross * form.its_rate / 100)
    const totalDeductions = cnss + its + form.other_deduction
    const net = gross - totalDeductions
    return { gross, cnss, its, totalDeductions, net }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.employee_id) { alert('Selectionnez un employe.'); return }
    setSaving(true)
    const emp = employees.find(em => em.id === form.employee_id)
    const calc = compute()
    await supabase.from('employee_documents').insert({
      employee_id: form.employee_id, type: 'fiche_paie', status: 'approved',
      title: `Bulletin de paie ${months[form.month]} ${form.year} — ${emp?.full_name || ''}`,
      issued_date: `${form.year}-${String(form.month + 1).padStart(2, '0')}-${new Date(form.year, form.month + 1, 0).getDate()}`,
      content: { ...form, ...calc, employee_name: emp?.full_name, employee_position: emp?.position, employee_department: emp?.department, employee_number: emp?.employee_number },
    })
    setSaving(false); setShowModal(false); load()
  }

  function printPayslip(doc: any) {
    const c = doc.content || {}
    const emp = doc.employee
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Bulletin ${c.employee_name || emp?.full_name}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:white}@page{margin:15mm 18mm;size:A4}
.header{background:#1a3d2b;color:white;padding:24px 32px;display:flex;justify-content:space-between;align-items:center}
.company-name{font-size:1.4rem;font-weight:800;font-family:Georgia,serif}.company-sub{font-size:0.7rem;opacity:0.65;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px}
.badge{background:#d4a017;color:white;padding:5px 14px;border-radius:4px;font-weight:700;font-size:0.85rem}
.body{padding:28px 32px;font-size:0.9rem}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
.info-box{background:#f8f5ee;padding:14px 16px;border-radius:8px}
.info-label{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:4px}
.info-value{font-size:0.9rem;font-weight:600;color:#1a3d2b}
table{width:100%;border-collapse:collapse;margin-bottom:20px}thead tr{background:#1a3d2b;color:white}
th{padding:10px 14px;text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.07em;font-weight:700}
th:last-child{text-align:right}td{padding:10px 14px;border-bottom:1px solid #f0ece4}td:last-child{text-align:right}
.section-title{font-weight:700;color:#1a3d2b;font-size:0.85rem;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #d4a017}
.total-row{background:#f8f5ee;font-weight:700}
.net-box{background:#1a3d2b;color:white;padding:20px 24px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin:20px 0}
.net-box .amount{font-family:Georgia,serif;font-size:1.8rem;font-weight:800}
.sig-section{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:30px;padding-top:16px;border-top:1px solid #ddd}
.sig-area{border:1.5px dashed #ccc;border-radius:8px;height:60px;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:0.8rem;margin-top:8px}
.footer{padding:12px 32px;background:#0f1f17;color:rgba(255,255,255,0.5);font-size:0.7rem;display:flex;justify-content:space-between;margin-top:20px}
</style></head><body>
<div class="header"><div><div class="company-name">HUB Distribution</div><div class="company-sub">Transformation & Distribution Agricole</div></div><div class="badge">BULLETIN DE PAIE</div></div>
<div class="body">
<div style="text-align:center;font-weight:700;font-size:1.05rem;color:#1a3d2b;margin-bottom:20px">${months[c.month] || ''} ${c.year || ''}</div>
<div class="info-grid">
<div class="info-box"><div class="info-label">Employe</div><div class="info-value">${c.employee_name || emp?.full_name || '—'}</div><div style="font-size:0.8rem;color:#555">${c.employee_position || emp?.position || '—'} — ${c.employee_department || emp?.department || '—'}</div></div>
<div class="info-box"><div class="info-label">Matricule</div><div class="info-value" style="font-family:monospace">${c.employee_number || emp?.employee_number || '—'}</div></div>
</div>

<div class="section-title">Gains</div>
<table><thead><tr><th>Rubrique</th><th>Montant</th></tr></thead><tbody>
<tr><td>Salaire de base</td><td>${Number(c.base_salary || 0).toLocaleString('fr-FR')} FCFA</td></tr>
${Number(c.transport) > 0 ? `<tr><td>Indemnite de transport</td><td>${Number(c.transport).toLocaleString('fr-FR')} FCFA</td></tr>` : ''}
${Number(c.housing) > 0 ? `<tr><td>Indemnite de logement</td><td>${Number(c.housing).toLocaleString('fr-FR')} FCFA</td></tr>` : ''}
${Number(c.bonus) > 0 ? `<tr><td>Primes / Bonus</td><td>${Number(c.bonus).toLocaleString('fr-FR')} FCFA</td></tr>` : ''}
<tr class="total-row"><td><strong>Salaire brut</strong></td><td><strong>${Number(c.gross || 0).toLocaleString('fr-FR')} FCFA</strong></td></tr>
</tbody></table>

<div class="section-title">Retenues</div>
<table><thead><tr><th>Rubrique</th><th>Montant</th></tr></thead><tbody>
<tr><td>CNSS (${c.cnss_rate || 4}%)</td><td>- ${Number(c.cnss || 0).toLocaleString('fr-FR')} FCFA</td></tr>
<tr><td>ITS / IRPP (${c.its_rate || 5}%)</td><td>- ${Number(c.its || 0).toLocaleString('fr-FR')} FCFA</td></tr>
${Number(c.other_deduction) > 0 ? `<tr><td>Autres retenues</td><td>- ${Number(c.other_deduction).toLocaleString('fr-FR')} FCFA</td></tr>` : ''}
<tr class="total-row"><td><strong>Total retenues</strong></td><td><strong>- ${Number(c.totalDeductions || 0).toLocaleString('fr-FR')} FCFA</strong></td></tr>
</tbody></table>

<div class="net-box"><div><div style="font-size:0.75rem;opacity:0.7;text-transform:uppercase;letter-spacing:0.1em">Net a payer</div></div><div class="amount">${Number(c.net || 0).toLocaleString('fr-FR')} FCFA</div></div>

<div class="sig-section">
<div style="text-align:center"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase">L'Employeur</div><div class="sig-area">Signature & cachet</div></div>
<div style="text-align:center"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase">L'Employe(e)</div><div class="sig-area">Signature</div></div>
</div></div>
<div class="footer"><span>HUB Distribution SARL — RCCM: BZV-XXXX-XX — NIF: XXXXXXXXXX — Brazzaville, Congo</span><span>Bulletin confidentiel</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 800) }
  }

  const calc = compute()
  const filtered = docs.filter(d => {
    const s = search.toLowerCase()
    return !s || d.employee?.full_name?.toLowerCase().includes(s) || d.title?.toLowerCase().includes(s)
  })

  return (
    <div className="invoice-page">
      <div className="page-header">
        <h2>💵 Fiches de paie</h2>
        <button className="btn-primary" onClick={() => { setForm({ employee_id: '', month: now.getMonth(), year: now.getFullYear(), base_salary: 0, transport: 0, housing: 0, bonus: 0, cnss_rate: 4, its_rate: 5, other_deduction: 0 }); setShowModal(true) }}>+ Generer un bulletin</button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 14, marginBottom: 24 }}>
          <div className="stat-card green"><div className="stat-value">{docs.length}</div><div className="stat-label">Bulletins emis</div></div>
          <div className="stat-card blue"><div className="stat-value">{docs.reduce((s, d) => s + Number((d.content as any)?.net || 0), 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div><div className="stat-label">FCFA — masse salariale nette</div></div>
        </div>

        <input className="hub-input" style={{ maxWidth: 320, marginBottom: 16 }} placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
            <table className="hub-table">
              <thead><tr><th>Employe</th><th>Periode</th><th>Brut</th><th>Retenues</th><th>Net</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(d => {
                  const c = d.content || {} as any
                  return (
                    <tr key={d.id}>
                      <td><strong>{d.employee?.full_name || '—'}</strong>{d.employee?.employee_number && <div style={{ fontSize: '0.72rem', color: '#999', fontFamily: 'monospace' }}>{d.employee.employee_number}</div>}</td>
                      <td><span className="badge badge-blue">{months[c.month] || '—'} {c.year || ''}</span></td>
                      <td style={{ color: '#555' }}>{Number(c.gross || 0).toLocaleString('fr-FR')} FCFA</td>
                      <td style={{ color: '#dc2626' }}>- {Number(c.totalDeductions || 0).toLocaleString('fr-FR')}</td>
                      <td style={{ fontWeight: 700, color: '#065f46' }}>{Number(c.net || 0).toLocaleString('fr-FR')} FCFA</td>
                      <td><button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => printPayslip(d)}>🖨️ PDF</button></td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun bulletin</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 620 }}>
            <div className="modal-title">💵 Generer un bulletin de paie</div>
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}><label>Employe *</label>
                  <select className="hub-select" required value={form.employee_id} onChange={e => prefillSalary(e.target.value)}>
                    <option value="">-- Selectionner --</option>
                    {employees.map(em => <option key={em.id} value={em.id}>{em.full_name} — {em.position} ({Number(em.salary || 0).toLocaleString()} FCFA)</option>)}
                  </select>
                </div>
                <div className="hub-form-group"><label>Mois</label>
                  <select className="hub-select" value={form.month} onChange={e => setForm(f => ({ ...f, month: Number(e.target.value) }))}>
                    {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
                  </select>
                </div>
                <div className="hub-form-group"><label>Annee</label>
                  <input className="hub-input" type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: Number(e.target.value) }))} />
                </div>
              </div>

              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '16px 0 8px', paddingBottom: 4, borderBottom: '2px solid var(--hub-amber)' }}>Gains</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group"><label>Salaire de base *</label><input className="hub-input" type="number" min={0} required value={form.base_salary} onChange={e => setForm(f => ({ ...f, base_salary: Number(e.target.value) }))} /></div>
                <div className="hub-form-group"><label>Indemnite transport</label><input className="hub-input" type="number" min={0} value={form.transport} onChange={e => setForm(f => ({ ...f, transport: Number(e.target.value) }))} /></div>
                <div className="hub-form-group"><label>Indemnite logement</label><input className="hub-input" type="number" min={0} value={form.housing} onChange={e => setForm(f => ({ ...f, housing: Number(e.target.value) }))} /></div>
                <div className="hub-form-group"><label>Primes / Bonus</label><input className="hub-input" type="number" min={0} value={form.bonus} onChange={e => setForm(f => ({ ...f, bonus: Number(e.target.value) }))} /></div>
              </div>

              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '16px 0 8px', paddingBottom: 4, borderBottom: '2px solid var(--hub-amber)' }}>Retenues</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="hub-form-group"><label>CNSS (%)</label><input className="hub-input" type="number" min={0} max={100} step={0.1} value={form.cnss_rate} onChange={e => setForm(f => ({ ...f, cnss_rate: Number(e.target.value) }))} /></div>
                <div className="hub-form-group"><label>ITS / IRPP (%)</label><input className="hub-input" type="number" min={0} max={100} step={0.1} value={form.its_rate} onChange={e => setForm(f => ({ ...f, its_rate: Number(e.target.value) }))} /></div>
                <div className="hub-form-group"><label>Autres retenues</label><input className="hub-input" type="number" min={0} value={form.other_deduction} onChange={e => setForm(f => ({ ...f, other_deduction: Number(e.target.value) }))} /></div>
              </div>

              {/* Resume en temps reel */}
              <div style={{ background: '#f8f5ee', borderRadius: 10, padding: '16px 20px', marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.875rem' }}>
                  <span style={{ color: '#666' }}>Brut</span><span style={{ fontWeight: 600 }}>{calc.gross.toLocaleString('fr-FR')} FCFA</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.875rem' }}>
                  <span style={{ color: '#666' }}>CNSS ({form.cnss_rate}%)</span><span style={{ color: '#dc2626' }}>- {calc.cnss.toLocaleString('fr-FR')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.875rem' }}>
                  <span style={{ color: '#666' }}>ITS ({form.its_rate}%)</span><span style={{ color: '#dc2626' }}>- {calc.its.toLocaleString('fr-FR')}</span>
                </div>
                {form.other_deduction > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.875rem' }}>
                  <span style={{ color: '#666' }}>Autres</span><span style={{ color: '#dc2626' }}>- {form.other_deduction.toLocaleString('fr-FR')}</span>
                </div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '2px solid var(--hub-green)', fontWeight: 700 }}>
                  <span style={{ color: 'var(--hub-green)' }}>Net a payer</span><span style={{ color: '#065f46', fontSize: '1.1rem' }}>{calc.net.toLocaleString('fr-FR')} FCFA</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? '...' : 'Generer le bulletin'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
