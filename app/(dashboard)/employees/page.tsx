'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import type { Employee } from '@/types'

const statusColors: Record<string, string> = { actif: 'badge-green', conge: 'badge-amber', suspendu: 'badge-red', sorti: 'badge-gray' }
const statusLabels: Record<string, string> = { actif: '● Actif', conge: '⏸ En congé', suspendu: '⚠ Suspendu', sorti: '○ Sorti' }
const contractLabels: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', stage: 'Stage', freelance: 'Freelance' }
const departments = ['Direction', 'Commercial', 'Production', 'Qualité', 'Logistique', 'Finance', 'RH', 'Informatique', 'Autre']

const emptyForm = { full_name: '', position: '', department: 'Commercial', email: '', phone: '', hire_date: '', contract_type: 'cdi' as const, salary: 0, status: 'actif' as const, address: '', notes: '', employee_number: '' }

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Employee | null>(null)
  const [empDocs, setEmpDocs] = useState<any[]>([])
  const [showDocModal, setShowDocModal] = useState(false)
  const [docForm, setDocForm] = useState({ type: 'contrat', title: '', issued_date: new Date().toISOString().split('T')[0] })
  const [leaveBalance, setLeaveBalance] = useState<any>(null)
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('employees').select('*').order('full_name')
    setEmployees(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function loadEmpDocs(empId: string) {
    const [{ data }, { data: lb }] = await Promise.all([
      supabase.from('employee_documents').select('*').eq('employee_id', empId).order('created_at', { ascending: false }),
      supabase.from('leave_balances').select('*').eq('employee_id', empId).eq('year', new Date().getFullYear()).maybeSingle(),
    ])
    setEmpDocs(data || [])
    setLeaveBalance(lb)
  }

  function openNew() { setEditing(null); setForm(emptyForm); setShowModal(true) }
  function openEdit(emp: Employee) {
    setEditing(emp)
    setForm({ full_name: emp.full_name, position: emp.position, department: emp.department, email: emp.email || '', phone: emp.phone || '', hire_date: emp.hire_date, contract_type: emp.contract_type, salary: emp.salary || 0, status: emp.status, address: emp.address || '', notes: emp.notes || '', employee_number: emp.employee_number || '' })
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const payload = { ...form, salary: form.salary || null }
    if (editing) {
      await supabase.from('employees').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id)
    } else {
      const num = `EMP-${String(Date.now()).slice(-5)}`
      await supabase.from('employees').insert({ ...payload, employee_number: form.employee_number || num })
    }
    setSaving(false); setShowModal(false); load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Archiver cet employé ?')) return
    await supabase.from('employees').update({ status: 'sorti' }).eq('id', id)
    load()
  }

  async function addDocument(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await supabase.from('employee_documents').insert({ ...docForm, employee_id: selected!.id })
    setSaving(false); setShowDocModal(false)
    setDocForm({ type: 'contrat', title: '', issued_date: new Date().toISOString().split('T')[0] })
    loadEmpDocs(selected!.id)
  }

  const filtered = employees.filter(emp =>
    emp.full_name.toLowerCase().includes(search.toLowerCase()) ||
    emp.position.toLowerCase().includes(search.toLowerCase()) ||
    emp.department.toLowerCase().includes(search.toLowerCase())
  )

  const docTypeLabels: Record<string, string> = {
    contrat: '📝 Contrat', avenant: '📋 Avenant', attestation_travail: '🏛 Attestation', fiche_paie: '💵 Fiche de paie', conge: '🏖 Congé', discipline: '⚠ Discipline', autre: '📄 Autre'
  }

  return (
    <div>
      <div className="page-header">
        <h2>👨‍💼 Ressources Humaines</h2>
        <button className="btn-primary" onClick={openNew}>+ Nouvel employé</button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Stats */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {['actif', 'conge', 'suspendu', 'sorti'].map(s => (
            <div key={s} style={{ background: 'white', padding: '10px 16px', borderRadius: 8, border: '1px solid #e8e4db', fontSize: '0.8rem' }}>
              <strong>{employees.filter(e => e.status === s).length}</strong> {statusLabels[s]}
            </div>
          ))}
        </div>

        <input className="hub-input" style={{ maxWidth: 320, marginBottom: 16 }} placeholder="🔍 Rechercher un employé..."
          value={search} onChange={e => setSearch(e.target.value)} />

        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 20 }}>
          {/* Liste */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
              <table className="hub-table">
                <thead><tr><th>Employé</th><th>Poste</th><th>Département</th><th>Contrat</th><th>Embauche</th><th>Statut</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.map(emp => (
                    <tr key={emp.id} style={{ cursor: 'pointer', background: selected?.id === emp.id ? '#f0f9f5' : '' }}
                      onClick={() => { setSelected(emp); loadEmpDocs(emp.id) }}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{emp.full_name}</div>
                        {emp.employee_number && <div style={{ fontSize: '0.72rem', color: '#999', fontFamily: 'monospace' }}>{emp.employee_number}</div>}
                      </td>
                      <td style={{ color: '#555' }}>{emp.position}</td>
                      <td><span className="badge badge-gray">{emp.department}</span></td>
                      <td><span className="badge badge-blue">{contractLabels[emp.contract_type]}</span></td>
                      <td style={{ fontSize: '0.8rem', color: '#666' }}>{new Date(emp.hire_date).toLocaleDateString('fr-FR')}</td>
                      <td><span className={`badge ${statusColors[emp.status]}`}>{statusLabels[emp.status]}</span></td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => openEdit(emp)}>✏️</button>
                          <button className="btn-danger" onClick={() => handleDelete(emp.id)}>📦</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#999' }}>Aucun employé</td></tr>}
                </tbody>
              </table>
            )}
          </div>

          {/* Fiche employé */}
          {selected && (
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden', height: 'fit-content' }}>
              <div style={{ background: 'var(--hub-green)', color: 'white', padding: '20px', position: 'relative' }}>
                <button onClick={() => setSelected(null)} style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
                <div style={{ fontSize: '2rem', marginBottom: 4 }}>👤</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{selected.full_name}</div>
                <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>{selected.position} · {selected.department}</div>
                <div style={{ marginTop: 6 }}><span className={`badge ${statusColors[selected.status]}`}>{statusLabels[selected.status]}</span></div>
              </div>
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                  {[
                    ['📧', selected.email || '—'],
                    ['📱', selected.phone || '—'],
                    ['📅', new Date(selected.hire_date).toLocaleDateString('fr-FR')],
                    ['📋', contractLabels[selected.contract_type]],
                    ['💵', selected.salary ? `${Number(selected.salary).toLocaleString()} FCFA` : '—'],
                    ['🔢', selected.employee_number || '—'],
                  ].map(([icon, val]) => (
                    <div key={String(icon)} style={{ fontSize: '0.8rem' }}>
                      <span style={{ marginRight: 4 }}>{icon}</span>
                      <span style={{ color: '#555' }}>{val}</span>
                    </div>
                  ))}
                </div>

                {/* Liens rapides modules RH */}
                <div style={{ borderTop: '1px solid #f0ece4', paddingTop: 12, marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--hub-green)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Modules RH</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {[
                      { href: '/hr/contracts', icon: '📝', label: 'Contrats' },
                      { href: '/hr/certificates', icon: '🏛', label: 'Attestations' },
                      { href: '/hr/payslips', icon: '💵', label: 'Fiches paie' },
                      { href: '/hr/leaves', icon: '🏖', label: 'Conges' },
                    ].map(link => (
                      <Link key={link.href} href={link.href} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: '#f8f5ee', borderRadius: 6, textDecoration: 'none', color: '#555', fontSize: '0.78rem', fontWeight: 600 }}>
                        <span>{link.icon}</span> {link.label}
                      </Link>
                    ))}
                  </div>
                </div>

                {/* Solde conge */}
                {leaveBalance && (
                  <div style={{ borderTop: '1px solid #f0ece4', paddingTop: 12, marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--hub-green)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Solde conge {leaveBalance.year}</div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ flex: 1, textAlign: 'center', background: '#ecfdf5', borderRadius: 8, padding: '8px 4px' }}>
                        <div style={{ fontWeight: 700, color: '#065f46', fontSize: '1.1rem' }}>{leaveBalance.remaining_days}</div>
                        <div style={{ fontSize: '0.68rem', color: '#666' }}>Restant</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center', background: '#fef2f2', borderRadius: 8, padding: '8px 4px' }}>
                        <div style={{ fontWeight: 700, color: '#991b1b', fontSize: '1.1rem' }}>{leaveBalance.used_days}</div>
                        <div style={{ fontSize: '0.68rem', color: '#666' }}>Utilises</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center', background: '#f8f5ee', borderRadius: 8, padding: '8px 4px' }}>
                        <div style={{ fontWeight: 700, color: '#555', fontSize: '1.1rem' }}>{leaveBalance.total_days}</div>
                        <div style={{ fontSize: '0.68rem', color: '#666' }}>Total</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Documents RH */}
                <div style={{ borderTop: '1px solid #f0ece4', paddingTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--hub-green)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Documents RH</div>
                    <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => setShowDocModal(true)}>+ Ajouter</button>
                  </div>
                  {empDocs.length === 0 && <div style={{ color: '#999', fontSize: '0.8rem', textAlign: 'center', padding: '10px 0' }}>Aucun document</div>}
                  {empDocs.map(d => (
                    <div key={d.id} style={{ padding: '8px', background: '#f8f5ee', borderRadius: 6, marginBottom: 6, fontSize: '0.8rem' }}>
                      <div style={{ fontWeight: 600 }}>{docTypeLabels[d.type] || d.type} — {d.title}</div>
                      <div style={{ color: '#999' }}>{new Date(d.issued_date).toLocaleDateString('fr-FR')}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal employé */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 600 }}>
            <div className="modal-title">{editing ? '✏️ Modifier l\'employé' : '➕ Nouvel employé'}</div>
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Nom complet *</label>
                  <input className="hub-input" required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>Poste *</label>
                  <input className="hub-input" required value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} placeholder="Responsable commercial" />
                </div>
                <div className="hub-form-group">
                  <label>Département</label>
                  <select className="hub-select" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>
                    {departments.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Email</label>
                  <input className="hub-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>Téléphone</label>
                  <input className="hub-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>Date d'embauche *</label>
                  <input className="hub-input" type="date" required value={form.hire_date} onChange={e => setForm({ ...form, hire_date: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>Type de contrat</label>
                  <select className="hub-select" value={form.contract_type} onChange={e => setForm({ ...form, contract_type: e.target.value as any })}>
                    {Object.entries(contractLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Salaire (FCFA)</label>
                  <input className="hub-input" type="number" min={0} value={form.salary} onChange={e => setForm({ ...form, salary: Number(e.target.value) })} />
                </div>
                <div className="hub-form-group">
                  <label>Statut</label>
                  <select className="hub-select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as any })}>
                    {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Adresse</label>
                  <input className="hub-input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Notes</label>
                  <textarea className="hub-input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ resize: 'vertical' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal doc RH */}
      {showDocModal && selected && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowDocModal(false)}>
          <div className="modal-box">
            <div className="modal-title">📄 Ajouter document RH — {selected.full_name}</div>
            <form onSubmit={addDocument}>
              <div className="hub-form-group">
                <label>Type de document</label>
                <select className="hub-select" value={docForm.type} onChange={e => setDocForm({ ...docForm, type: e.target.value })}>
                  {Object.entries(docTypeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="hub-form-group">
                <label>Titre *</label>
                <input className="hub-input" required value={docForm.title} onChange={e => setDocForm({ ...docForm, title: e.target.value })} placeholder="Ex: Contrat CDI 2025" />
              </div>
              <div className="hub-form-group">
                <label>Date d'émission</label>
                <input className="hub-input" type="date" value={docForm.issued_date} onChange={e => setDocForm({ ...docForm, issued_date: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowDocModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? '...' : 'Ajouter'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
