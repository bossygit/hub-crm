'use client'
import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import type { Client, ClientType } from '@/types'
import {
  computeClientFinance,
  type ClientInvoiceInput,
  type ClientPaymentInput,
  type ClientFinanceSummary,
} from '@/lib/clients/finance'

// Fiche partenaire enrichie (colonnes ajoutées par supabase/fix-clients-file.sql)
type ClientRow = Client & {
  rccm?: string | null
  city?: string | null
  website?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  is_active?: boolean
  payment_terms?: string | null
  credit_limit?: number | null
}

type InvoiceRow = { id: string; client_id: string | null; status: string; total: number; date: string }
type PaymentRow = { invoice_id: string; amount: number; payment_date: string }

const typeLabels: Record<ClientType, string> = {
  client: 'Client',
  fournisseur: 'Fournisseur',
  institution: 'Institution',
}

const typeBadge: Record<ClientType, string> = {
  client: 'badge-blue',
  fournisseur: 'badge-green',
  institution: 'badge-amber',
}

const typePlural: Record<ClientType, string> = {
  client: 'Clients',
  fournisseur: 'Fournisseurs',
  institution: 'Institutions',
}

const emptyForm = {
  name: '',
  type: 'client' as ClientType,
  email: '',
  phone: '',
  address: '',
  tax_id: '',
  notes: '',
  rccm: '',
  city: '',
  website: '',
  contact_name: '',
  contact_phone: '',
  payment_terms: '30 jours',
  credit_limit: '',
  is_active: true,
}
type FormState = typeof emptyForm

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function validateForm(form: FormState): string | null {
  if (!form.name.trim()) return 'Le nom / raison sociale est obligatoire.'
  if (form.email && !EMAIL_RE.test(form.email.trim())) return "L'adresse email n'est pas valide."
  if (form.phone) {
    const digits = form.phone.replace(/\D/g, '')
    if (digits.length < 6 || digits.length > 15) return 'Le téléphone semble invalide (6 à 15 chiffres).'
  }
  if (form.credit_limit !== '' && form.credit_limit !== null) {
    const limit = Number(form.credit_limit)
    if (!Number.isFinite(limit) || limit < 0) return 'La limite de crédit doit être un montant positif.'
  }
  return null
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'actif' | 'inactif'>('all')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<ClientRow | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()
  const { toast } = useToast()

  async function load() {
    setLoading(true)
    const [{ data: cls }, { data: invs }, { data: pays }] = await Promise.all([
      supabase.from('clients').select('*').order('created_at', { ascending: false }),
      supabase.from('invoices').select('id, client_id, status, total, date'),
      supabase.from('invoice_payments').select('invoice_id, amount, payment_date'),
    ])
    setClients((cls as ClientRow[]) || [])
    setInvoices((invs as InvoiceRow[]) || [])
    setPayments((pays as PaymentRow[]) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Solde par client : factures validées − paiements (uniquement type client).
  const balances = useMemo(() => {
    const byClient = new Map<string, ClientInvoiceInput[]>()
    for (const inv of invoices) {
      if (!inv.client_id) continue
      const list = byClient.get(inv.client_id) || []
      list.push({ id: inv.id, date: inv.date, status: inv.status, total: inv.total })
      byClient.set(inv.client_id, list)
    }
    const payList: ClientPaymentInput[] = payments.map(p => ({ ...p }))
    const map = new Map<string, ClientFinanceSummary>()
    byClient.forEach((invs, cid) => {
      const ids = new Set(invs.map(i => i.id))
      map.set(cid, computeClientFinance(invs, payList.filter(p => ids.has(p.invoice_id))))
    })
    return map
  }, [invoices, payments])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return clients.filter(c => {
      const haystack = [c.name, c.email || '', c.tax_id || '', c.rccm || '', c.city || '', c.contact_name || '']
        .join(' ').toLowerCase()
      const matchSearch = !q || haystack.includes(q)
      const matchType = filter === 'all' || c.type === filter
      const isActive = c.is_active !== false
      const matchActive = activeFilter === 'all' ||
        (activeFilter === 'actif' ? isActive : !isActive)
      return matchSearch && matchType && matchActive
    })
  }, [clients, search, filter, activeFilter])

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  function openEdit(c: ClientRow) {
    setEditing(c)
    setForm({
      name: c.name,
      type: c.type,
      email: c.email || '',
      phone: c.phone || '',
      address: c.address || '',
      tax_id: c.tax_id || '',
      notes: c.notes || '',
      rccm: c.rccm || '',
      city: c.city || '',
      website: c.website || '',
      contact_name: c.contact_name || '',
      contact_phone: c.contact_phone || '',
      payment_terms: c.payment_terms || '30 jours',
      credit_limit: c.credit_limit != null ? String(c.credit_limit) : '',
      is_active: c.is_active !== false,
    })
    setError('')
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const validation = validateForm(form)
    if (validation) { setError(validation); return }
    setSaving(true)
    setError('')
    const payload = {
      name: form.name.trim(),
      type: form.type,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      tax_id: form.tax_id.trim() || null,
      notes: form.notes.trim() || null,
      rccm: form.rccm.trim() || null,
      city: form.city.trim() || null,
      website: form.website.trim() || null,
      contact_name: form.contact_name.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      payment_terms: form.payment_terms.trim() || '30 jours',
      credit_limit: form.credit_limit === '' ? 0 : Number(form.credit_limit),
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    }
    let ok = true
    if (editing) {
      const { error: err } = await supabase.from('clients').update(payload).eq('id', editing.id)
      ok = !err
      if (err) toast('error', `Erreur : ${err.message}`)
      else toast('success', 'Fiche partenaire mise à jour.')
    } else {
      const { updated_at, ...insert } = payload
      void updated_at
      const { error: err } = await supabase.from('clients').insert(insert)
      ok = !err
      if (err) toast('error', `Erreur : ${err.message}`)
      else toast('success', 'Contact créé.')
    }
    setSaving(false)
    if (ok) { setShowModal(false); load() }
  }

  async function setActive(c: ClientRow, active: boolean) {
    const action = active ? 'activer' : 'désactiver'
    if (!confirm(`${active ? 'Réactiver' : 'Désactiver'} « ${c.name} » ?\n\nUn partenaire inactif reste consultable mais n'apparaît plus dans les listes actives et ne peut plus recevoir de nouvelles factures par défaut.`)) return
    const { error } = await supabase.from('clients')
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq('id', c.id)
    if (error) toast('error', `Erreur : ${error.message}`)
    else { toast('success', `Partenaire ${action === 'activer' ? 'réactivé' : 'désactivé'}.`); load() }
  }

  // Garde-fou suppression : on bloque le DELETE dur si des documents sont liés.
  async function countRelated(clientId: string): Promise<number> {
    const checks: [string, string][] = [
      ['invoices', 'client_id'],
      ['purchases', 'supplier_id'],
      ['sales', 'client_id'],
      ['documents', 'client_id'],
      ['credit_notes', 'client_id'],
    ]
    let total = 0
    for (const [table, column] of checks) {
      const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq(column, clientId)
      total += count || 0
    }
    return total
  }

  async function handleDelete(c: ClientRow) {
    const related = await countRelated(c.id)
    if (related > 0) {
      const deactivate = confirm(
        `Impossible de supprimer « ${c.name} » : ${related} document(s) lié(s) (factures, achats, ventes, documents).\n\n` +
        'Pour préserver l\u2019historique financier, le partenaire doit être désactivé plutôt que supprimé.\n\nDésactiver à la place ?',
      )
      if (deactivate) await setActive(c, false)
      return
    }
    if (!confirm(`Supprimer définitivement « ${c.name} » ?`)) return
    const { error } = await supabase.from('clients').delete().eq('id', c.id)
    if (error) toast('error', `Erreur : ${error.message}`)
    else { toast('success', 'Contact supprimé.'); load() }
  }

  const activeCount = clients.filter(c => c.is_active !== false).length
  const inactiveCount = clients.length - activeCount

  return (
    <div>
      <div className="page-header">
        <h2>👥 Clients & Partenaires</h2>
        <button className="btn-primary" onClick={openNew}>+ Nouveau contact</button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Recherche + filtres */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="hub-input" style={{ maxWidth: 340 }}
            placeholder="🔍 Nom, NIF, RCCM, ville, email, contact..."
            value={search} onChange={e => setSearch(e.target.value)} />
          <div style={{ display: 'flex', gap: 0, background: '#f0ece4', borderRadius: 8, padding: 3 }}>
            {[{ key: 'all', label: 'Tous' }, { key: 'client', label: typeLabels.client }, { key: 'fournisseur', label: typeLabels.fournisseur }, { key: 'institution', label: typeLabels.institution }].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{ padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
                  background: filter === f.key ? 'white' : 'transparent',
                  color: filter === f.key ? 'var(--hub-green)' : '#666',
                  boxShadow: filter === f.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 0, background: '#f0ece4', borderRadius: 8, padding: 3 }}>
            {[{ key: 'all', label: 'Tous statuts' }, { key: 'actif', label: '🟢 Actifs' }, { key: 'inactif', label: '⚪ Inactifs' }].map(f => (
              <button key={f.key} onClick={() => setActiveFilter(f.key as 'all' | 'actif' | 'inactif')}
                style={{ padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
                  background: activeFilter === f.key ? 'white' : 'transparent',
                  color: activeFilter === f.key ? 'var(--hub-green)' : '#666',
                  boxShadow: activeFilter === f.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats mini */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ background: 'white', padding: '10px 16px', borderRadius: 8, border: '1px solid #e8e4db', fontSize: '0.8rem' }}>
            <strong>{activeCount}</strong> actifs · <strong style={{ color: '#999' }}>{inactiveCount}</strong> inactifs
          </div>
          {(['client', 'fournisseur', 'institution'] as ClientType[]).map(t => (
            <div key={t} style={{ background: 'white', padding: '10px 16px', borderRadius: 8, border: '1px solid #e8e4db', fontSize: '0.8rem' }}>
              <strong>{clients.filter(c => c.type === t && c.is_active !== false).length}</strong> {typePlural[t]} actifs
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Chargement...</div>
          ) : (
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Partenaire</th>
                  <th>Type</th>
                  <th>Ville</th>
                  <th>Contact</th>
                  <th>NIF</th>
                  <th>Solde client</th>
                  <th>Statut</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const isActive = c.is_active !== false
                  const fin = c.type === 'client' ? balances.get(c.id) : undefined
                  const due = (fin?.balanceDue || 0) > 0
                  return (
                    <tr key={c.id} style={{ opacity: isActive ? 1 : 0.55 }}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{c.name}</div>
                        {c.contact_name && <div style={{ fontSize: '0.75rem', color: '#888' }}>👤 {c.contact_name}</div>}
                      </td>
                      <td><span className={`badge ${typeBadge[c.type]}`}>{typeLabels[c.type]}</span></td>
                      <td style={{ color: '#666' }}>{c.city || c.address?.split(',')[0]?.trim() || '—'}</td>
                      <td style={{ fontSize: '0.82rem', color: '#555' }}>
                        {c.phone && <div>📱 {c.phone}</div>}
                        {c.email && <div style={{ color: '#888' }}>✉️ {c.email}</div>}
                        {!c.phone && !c.email && <span style={{ color: '#bbb' }}>—</span>}
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>
                        {c.tax_id
                          ? <span style={{ fontFamily: 'monospace' }}>{c.tax_id}</span>
                          : <span style={{ color: '#bbb' }}>—</span>}
                        {c.rccm && <div style={{ color: '#999', fontSize: '0.7rem' }}>RCCM {c.rccm}</div>}
                      </td>
                      <td>
                        {fin ? (
                          fin.totalInvoiced === 0 && fin.totalPaid === 0 ? (
                            <span style={{ color: '#bbb' }}>—</span>
                          ) : due ? (
                            <div style={{ color: '#92400e', fontWeight: 700, fontSize: '0.85rem' }}>
                              {Number(fin.balanceDue).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA
                              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#b45309' }}>⚠ impayé</div>
                            </div>
                          ) : (
                            <div style={{ color: '#065f46', fontWeight: 700, fontSize: '0.85rem' }}>
                              {Number(fin.totalInvoiced).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA
                              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#065f46' }}>✓ à jour</div>
                            </div>
                          )
                        ) : (
                          <span style={{ color: '#bbb' }}>—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: isActive ? '#22c55e' : '#cbd5e1' }} />
                          <span style={{ fontSize: '0.72rem', color: isActive ? '#065f46' : '#888' }}>
                            {isActive ? 'Actif' : 'Inactif'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Link href={`/clients/${c.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>
                            Voir la fiche
                          </Link>
                          <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => openEdit(c)}>✏️ Éditer</button>
                          <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }}
                            onClick={() => setActive(c, !isActive)}>
                            {isActive ? '⏸ Désactiver' : '▶ Activer'}
                          </button>
                          <button className="btn-danger" style={{ padding: '5px 9px', fontSize: '0.75rem' }} onClick={() => handleDelete(c)} title="Supprimer">🗑️</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                      {clients.length === 0 ? 'Aucun partenaire pour le moment.' : 'Aucun résultat avec ces filtres.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal nouveau / édition */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 720 }}>
            <div className="modal-title">{editing ? '✏️ Modifier la fiche partenaire' : '➕ Nouveau contact'}</div>
            {error && (
              <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: '0.85rem', fontWeight: 600 }}>
                ⚠️ {error}
              </div>
            )}
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Nom / Raison sociale *</label>
                  <input className="hub-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex: Coopérative du Pool" autoFocus />
                </div>
                <div className="hub-form-group">
                  <label>Type *</label>
                  <select className="hub-select" value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value as ClientType })}>
                    <option value="client">Client</option>
                    <option value="fournisseur">Fournisseur</option>
                    <option value="institution">Institution</option>
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Partenaire actif</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontWeight: 600, fontSize: '0.8rem', color: form.is_active ? '#065f46' : '#666' }}>
                    <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })}
                      style={{ width: 18, height: 18 }} />
                    {form.is_active ? '🟢 Actif' : '⚪ Inactif'}
                  </label>
                </div>
                <div className="hub-form-group">
                  <label>Email</label>
                  <input className="hub-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="contact@entreprise.cg" />
                </div>
                <div className="hub-form-group">
                  <label>Téléphone</label>
                  <input className="hub-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="+242 06 ..." />
                </div>
                <div className="hub-form-group">
                  <label>Ville</label>
                  <input className="hub-input" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}
                    placeholder="Brazzaville" />
                </div>
                <div className="hub-form-group">
                  <label>Adresse</label>
                  <input className="hub-input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                    placeholder="Avenue ..., quartier ..." />
                </div>
                <div className="hub-form-group">
                  <label>NIF</label>
                  <input className="hub-input" value={form.tax_id} onChange={e => setForm({ ...form, tax_id: e.target.value })}
                    placeholder="Ex: CG-P-123456" />
                </div>
                <div className="hub-form-group">
                  <label>RCCM</label>
                  <input className="hub-input" value={form.rccm} onChange={e => setForm({ ...form, rccm: e.target.value })}
                    placeholder="Ex: BZV-2024-A-1234" />
                </div>
                <div className="hub-form-group">
                  <label>Personne de contact</label>
                  <input className="hub-input" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })}
                    placeholder="Nom du responsable" />
                </div>
                <div className="hub-form-group">
                  <label>Téléphone du contact</label>
                  <input className="hub-input" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })}
                    placeholder="+242 06 ..." />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Site web</label>
                  <input className="hub-input" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })}
                    placeholder="https://..." />
                </div>
                <div className="hub-form-group">
                  <label>Conditions de paiement</label>
                  <input className="hub-input" list="payment-terms-suggestions" value={form.payment_terms}
                    onChange={e => setForm({ ...form, payment_terms: e.target.value })} placeholder="Ex: 30 jours" />
                  <datalist id="payment-terms-suggestions">
                    <option value="Comptant" />
                    <option value="15 jours" />
                    <option value="30 jours" />
                    <option value="45 jours" />
                    <option value="60 jours" />
                    <option value="À la livraison" />
                  </datalist>
                </div>
                <div className="hub-form-group">
                  <label>Limite de crédit (FCFA){form.type !== 'client' ? ' — clients seulement' : ''}</label>
                  <input className="hub-input" type="number" min={0} step={1000} value={form.credit_limit}
                    disabled={form.type !== 'client'}
                    onChange={e => setForm({ ...form, credit_limit: e.target.value })}
                    placeholder="0 = sans plafond" />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Notes</label>
                  <textarea className="hub-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                    rows={3} placeholder="Informations complémentaires..." style={{ resize: 'vertical' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
