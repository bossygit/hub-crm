'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import type { Client, ClientType } from '@/types'
import {
  computeClientFinance,
  type ClientInvoiceInput,
  type ClientPaymentInput,
  type ClientPurchaseInput,
  type SupplierPaymentInput,
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

type InvoiceRow = {
  id: string
  invoice_number: string
  date: string
  due_date: string | null
  status: string
  total: number
  payment_terms?: string | null
}
type PaymentRow = {
  id: string
  invoice_id: string
  amount: number
  payment_date: string
  method: string
  reference?: string | null
}
type PurchaseRow = {
  id: string
  purchase_number: string
  date: string
  status: string
  subtotal: number
}
type DocRow = {
  id: string
  reference: string
  document_number?: string | null
  title: string
  type: string
  status: string
  total_amount?: number | null
  created_at: string
}

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

const invoiceStatus: Record<string, { label: string; badge: string; icon: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray', icon: '✏️' },
  pending: { label: 'En attente', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Validée', badge: 'badge-green', icon: '✅' },
  partial: { label: 'Partielle', badge: 'badge-blue', icon: '🟣' },
  paid: { label: 'Payée', badge: 'badge-green', icon: '💚' },
  cancelled: { label: 'Annulée', badge: 'badge-red', icon: '❌' },
}

const purchaseStatus: Record<string, { label: string; badge: string; icon: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray', icon: '✏️' },
  pending: { label: 'Commandé', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Réceptionné', badge: 'badge-green', icon: '✅' },
  cancelled: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

const docTypeLabels: Record<string, string> = {
  facture: '🧾 Facture',
  bon_de_livraison: '🚚 Bon de livraison',
  devis: '📝 Devis',
  bon_livraison: '🚚 Bon de livraison',
  attestation: '📋 Attestation',
  contrat: '✍️ Contrat',
  document_administratif: '🏛️ Document administratif',
  document_rh: '👤 Document RH',
  recu_paiement: '💰 Reçu de paiement',
  bon_entree_stock: '📥 Bon entrée stock',
  bon_sortie_stock: '📤 Bon sortie stock',
  autre: '📄 Autre',
}

const docStatus: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray' },
  pending: { label: 'En attente', badge: 'badge-amber' },
  approved: { label: 'Validé', badge: 'badge-green' },
  generated: { label: 'Généré', badge: 'badge-blue' },
  sent: { label: 'Envoyé', badge: 'badge-green' },
  converted: { label: 'Converti', badge: 'badge-green' },
  rejected: { label: 'Rejeté', badge: 'badge-red' },
}

function fmt(n: number): string {
  return `${(Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`
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

type TabKey = 'factures' | 'paiements' | 'achats' | 'documents'

export default function ClientDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = String(params.id || '')
  const supabase = createClient()
  const { toast } = useToast()

  const [client, setClient] = useState<ClientRow | null>(null)
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [supplierPayments, setSupplierPayments] = useState<SupplierPaymentInput[]>([])
  const [supplierPaymentsOk, setSupplierPaymentsOk] = useState(false)
  const [docs, setDocs] = useState<DocRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<TabKey>('factures')
  const [showEdit, setShowEdit] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [updating, setUpdating] = useState(false)

  const isActive = client?.is_active !== false
  const isFournisseur = client?.type === 'fournisseur'

  async function load() {
    setLoading(true)
    setNotFound(false)
    const { data: cl } = await supabase.from('clients').select('*').eq('id', id).maybeSingle()
    if (!cl) {
      setNotFound(true)
      setLoading(false)
      return
    }
    const row = cl as ClientRow
    setClient(row)

    // Données liées au partenaire.
    const [{ data: invs }, { data: pur }, { data: docsData }] = await Promise.all([
      supabase.from('invoices')
        .select('id, invoice_number, date, due_date, status, total, payment_terms')
        .eq('client_id', id).order('date', { ascending: false }),
      row.type === 'fournisseur'
        ? supabase.from('purchases')
            .select('id, purchase_number, date, status, subtotal')
            .eq('supplier_id', id).order('date', { ascending: false })
        : Promise.resolve({ data: null }),
      supabase.from('documents')
        .select('id, reference, document_number, title, type, status, total_amount, created_at')
        .eq('client_id', id).order('created_at', { ascending: false }),
    ])

    const invList = (invs as InvoiceRow[] | null) || []
    setInvoices(invList)

    // Paiements client : uniquement ceux des factures du partenaire.
    const invoiceIds = new Set(invList.map(i => i.id))
    if (invoiceIds.size > 0) {
      const { data: pays } = await supabase
        .from('invoice_payments').select('*').order('payment_date', { ascending: false })
      const allPays = (pays as PaymentRow[] | null) || []
      setPayments(allPays.filter(p => invoiceIds.has(p.invoice_id)))
    } else {
      setPayments([])
    }

    // Achats du fournisseur (table purchase_payments absente → désactivée proprement).
    const purList = (pur as PurchaseRow[] | null) || []
    setPurchases(purList)
    if (purList.length > 0) {
      try {
        const { data: sp, error: spErr } = await supabase
          .from('purchase_payments')
          .select('purchase_id, amount, payment_date')
          .in('purchase_id', purList.map(p => p.id))
        const tableMissing = !!spErr && (/does not exist/.test(spErr.message) || spErr.code === '42P01')
        if (tableMissing) {
          setSupplierPaymentsOk(false)
          setSupplierPayments([])
        } else {
          setSupplierPaymentsOk(true)
          setSupplierPayments((sp as SupplierPaymentInput[] | null) || [])
        }
      } catch {
        setSupplierPaymentsOk(false)
        setSupplierPayments([])
      }
    } else {
      setSupplierPaymentsOk(true)
      setSupplierPayments([])
    }

    setDocs((docsData as DocRow[] | null) || [])
    setLoading(false)
  }

  useEffect(() => { if (id) load() }, [id])

  // Résumé financier (factures + achats fournisseur).
  const finance = useMemo<ClientFinanceSummary | null>(() => {
    if (!client) return null
    const invInput: ClientInvoiceInput[] = invoices.map(i => ({ id: i.id, date: i.date, status: i.status, total: i.total }))
    const payInput: ClientPaymentInput[] = payments.map(p => ({ invoice_id: p.invoice_id, amount: p.amount, payment_date: p.payment_date }))
    const purInput: ClientPurchaseInput[] = purchases.map(p => ({ id: p.id, date: p.date, status: p.status, subtotal: p.subtotal }))
    return computeClientFinance(invInput, payInput, purInput, supplierPayments)
  }, [client, invoices, payments, purchases, supplierPayments])

  const paidByInvoice = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of payments) m.set(p.invoice_id, (m.get(p.invoice_id) || 0) + (Number(p.amount) || 0))
    return m
  }, [payments])

  const paidByPurchase = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of supplierPayments) m.set(p.purchase_id, (m.get(p.purchase_id) || 0) + (Number(p.amount) || 0))
    return m
  }, [supplierPayments])

  const invoiceOf = useMemo(() => {
    const m = new Map<string, InvoiceRow>()
    for (const i of invoices) m.set(i.id, i)
    return m
  }, [invoices])

  function openEdit() {
    if (!client) return
    setForm({
      name: client.name,
      type: client.type,
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || '',
      tax_id: client.tax_id || '',
      notes: client.notes || '',
      rccm: client.rccm || '',
      city: client.city || '',
      website: client.website || '',
      contact_name: client.contact_name || '',
      contact_phone: client.contact_phone || '',
      payment_terms: client.payment_terms || '30 jours',
      credit_limit: client.credit_limit != null ? String(client.credit_limit) : '',
      is_active: client.is_active !== false,
    })
    setFormError('')
    setShowEdit(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!client) return
    const validation = validateForm(form)
    if (validation) { setFormError(validation); return }
    setSaving(true)
    setFormError('')
    const { error: err } = await supabase.from('clients').update({
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
    }).eq('id', client.id)
    setSaving(false)
    if (err) toast('error', `Erreur : ${err.message}`)
    else {
      toast('success', 'Fiche partenaire mise à jour.')
      setShowEdit(false)
      load()
    }
  }

  async function toggleActive() {
    if (!client) return
    const next = !isActive
    if (!confirm(
      next
        ? `Réactiver « ${client.name} » ?`
        : `Désactiver « ${client.name} » ?\n\nLe partenaire reste consultable mais est marqué inactif.`,
    )) return
    setUpdating(true)
    const { error } = await supabase.from('clients')
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq('id', client.id)
    setUpdating(false)
    if (error) toast('error', `Erreur : ${error.message}`)
    else { toast('success', next ? 'Partenaire réactivé.' : 'Partenaire désactivé.'); load() }
  }

  async function countRelated(): Promise<number> {
    const checks: [string, string][] = [
      ['invoices', 'client_id'],
      ['purchases', 'supplier_id'],
      ['sales', 'client_id'],
      ['documents', 'client_id'],
      ['credit_notes', 'client_id'],
    ]
    let total = 0
    for (const [table, column] of checks) {
      const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq(column, id)
      total += count || 0
    }
    return total
  }

  async function handleDelete() {
    if (!client) return
    const related = await countRelated()
    if (related > 0) {
      alert(`Suppression impossible : ${related} document(s) lié(s) (factures, achats, ventes, documents).\n\nDésactivez le partenaire pour préserver l'historique financier.`)
      return
    }
    if (!confirm(`Supprimer définitivement « ${client.name} » ?`)) return
    const { error } = await supabase.from('clients').delete().eq('id', client.id)
    if (error) toast('error', `Erreur : ${error.message}`)
    else {
      toast('success', 'Contact supprimé.')
      router.push('/clients')
    }
  }

  // ── Rendu ───────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: '48px 32px', color: '#999', textAlign: 'center' }}>
        Chargement de la fiche partenaire...
      </div>
    )
  }

  if (notFound || !client || !finance) {
    return (
      <div style={{ padding: '48px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: 10 }}>🔍</div>
        <div style={{ fontWeight: 700, marginBottom: 16 }}>Partenaire introuvable ou supprimé.</div>
        <Link href="/clients" className="btn-primary" style={{ textDecoration: 'none' }}>← Retour aux clients & partenaires</Link>
      </div>
    )
  }

  const limit = Number(client.credit_limit) || 0
  const creditUsagePct = limit > 0 ? Math.min(100, Math.round((finance.balanceDue / limit) * 100)) : 0
  const creditExceeded = limit > 0 && finance.balanceDue > limit
  const tabCounts = {
    factures: invoices.length,
    paiements: payments.length,
    achats: purchases.length,
    documents: docs.length,
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => router.push('/clients')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2 style={{ margin: 0 }}>🏢 {client.name}</h2>
          <span className={`badge ${typeBadge[client.type]}`}>{typeLabels[client.type]}</span>
          {isActive
            ? <span className="badge badge-green">🟢 Actif</span>
            : <span className="badge badge-red">⚪ Inactif</span>}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={openEdit}>✏️ Modifier la fiche</button>
          <button className="btn-ghost" onClick={toggleActive} disabled={updating}>
            {isActive ? '⏸ Désactiver' : '▶ Activer'}
          </button>
          <button className="btn-danger" onClick={handleDelete} style={{ padding: '9px 14px' }}>🗑️ Supprimer</button>
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 1180, margin: '0 auto' }}>
        {/* KPIs financiers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(165px,1fr))', gap: 14, marginBottom: 20 }}>
          <div className="stat-card blue">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>🧾</div>
            <div className="stat-value">{fmt(finance.totalInvoiced)}</div>
            <div className="stat-label">Total facturé (validé)</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>💚</div>
            <div className="stat-value">{fmt(finance.totalPaid)}</div>
            <div className="stat-label">Encaissé</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⏳</div>
            <div className="stat-value">{fmt(finance.balanceDue)}</div>
            <div className="stat-label">Solde dû</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>🚩</div>
            <div className="stat-value">{finance.outstandingInvoices}</div>
            <div className="stat-label">Factures impayées</div>
          </div>
          {isFournisseur && (
            <div className="stat-card amber">
              <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>🛒</div>
              <div className="stat-value">{fmt(finance.totalPurchased)}</div>
              <div className="stat-label">Achats commandés / réceptionnés</div>
            </div>
          )}
          {isFournisseur && (
            <div className="stat-card red" style={{ background: finance.supplierBalanceDue > 0 ? '#fffbeb' : '#ecfdf5', borderColor: finance.supplierBalanceDue > 0 ? '#fde68a' : '#a7f3d0' }}>
              <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>💸</div>
              <div className="stat-value" style={{ color: finance.supplierBalanceDue > 0 ? '#92400e' : '#065f46' }}>
                {fmt(finance.supplierBalanceDue)}
              </div>
              <div className="stat-label">Dette fournisseur</div>
            </div>
          )}
        </div>

        {limit > 0 && (
          <div style={{ background: 'white', borderRadius: 10, border: '1px solid #e8e4db', padding: '12px 18px', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: '0.8rem' }}>
              <span style={{ fontWeight: 700, color: 'var(--hub-green)' }}>🎯 Utilisation limite de crédit</span>
              <span style={{ color: creditExceeded ? '#991b1b' : '#333', fontWeight: 700 }}>
                {fmt(finance.balanceDue)} / {fmt(limit)} ({creditUsagePct}%)
                {creditExceeded && ' — plafond dépassé !'}
              </span>
            </div>
            <div style={{ height: 8, background: '#f0ece4', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ width: `${creditUsagePct}%`, height: '100%', borderRadius: 6, background: creditUsagePct > 90 ? '#dc2626' : creditUsagePct > 60 ? '#d97706' : '#16a34a' }} />
            </div>
          </div>
        )}

        {/* Fiche d'identité */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px 24px', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
            📇 Fiche partenaire
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '12px 24px', fontSize: '0.875rem' }}>
            {[
              ['Ville', client.city || '—'],
              ['Adresse', client.address || '—'],
              ['Téléphone', client.phone || '—'],
              ['Email', client.email || '—'],
              ['NIF', client.tax_id || '—'],
              ['RCCM', client.rccm || '—'],
              ['Site web', client.website || '—'],
              ['Personne de contact', client.contact_name || '—'],
              ['Tél. du contact', client.contact_phone || '—'],
              ['Conditions de paiement', client.payment_terms || '—'],
              ...(client.type === 'client' ? [['Limite de crédit', limit > 0 ? fmt(limit) : 'Non définie']] : []),
              ['Créé le', new Date(client.created_at).toLocaleDateString('fr-FR')],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', fontWeight: 700, marginBottom: 2 }}>
                  {label}
                </div>
                <div style={{ fontWeight: 600, color: '#333', overflowWrap: 'anywhere' }}>
                  {label === 'Site web' && value !== '—'
                    ? <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noreferrer" style={{ color: 'var(--hub-green-mid)' }}>{value}</a>
                    : value}
                </div>
              </div>
            ))}
          </div>
          {client.notes && (
            <div style={{ marginTop: 14, padding: '12px 16px', background: '#f8f5ee', borderRadius: 8, fontSize: '0.85rem', color: '#555' }}>
              <strong>Notes :</strong> {client.notes}
            </div>
          )}
        </div>

        {/* Onglets */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {([
            { key: 'factures', label: `🧾 Factures (${tabCounts.factures})` },
            { key: 'paiements', label: `💳 Paiements (${tabCounts.paiements})` },
            ...(isFournisseur || purchases.length > 0
              ? [{ key: 'achats', label: `🛒 Achats (${tabCounts.achats})` }]
              : []),
            { key: 'documents', label: `📄 Documents (${tabCounts.documents})` },
          ] as { key: TabKey; label: string }[]).map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1.5px solid', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
                borderColor: tab === t.key ? 'var(--hub-green-mid)' : '#ddd',
                background: tab === t.key ? 'var(--hub-green-mid)' : 'white',
                color: tab === t.key ? 'white' : '#555' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Contenu de l'onglet actif */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {tab === 'factures' && (
            invoices.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: '0.9rem' }}>
                Aucune facture pour ce partenaire.
              </div>
            ) : (
              <table className="hub-table">
                <thead>
                  <tr><th>N° Facture</th><th>Date</th><th>Échéance</th><th>Montant TTC</th><th>Payé</th><th>Solde</th><th>Statut</th></tr>
                </thead>
                <tbody>
                  {invoices.map(inv => {
                    const cfg = invoiceStatus[inv.status] || invoiceStatus.draft
                    const paid = paidByInvoice.get(inv.id) || 0
                    const remaining = Math.max(0, (Number(inv.total) || 0) - paid)
                    return (
                      <tr key={inv.id}>
                        <td>
                          <Link href={`/invoices/${inv.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--hub-green-mid)', textDecoration: 'none' }}>
                            {inv.invoice_number}
                          </Link>
                        </td>
                        <td style={{ color: '#666', fontSize: '0.85rem' }}>{new Date(inv.date).toLocaleDateString('fr-FR')}</td>
                        <td style={{ color: '#666', fontSize: '0.85rem' }}>{inv.due_date ? new Date(inv.due_date).toLocaleDateString('fr-FR') : '—'}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(inv.total)}</td>
                        <td style={{ color: '#065f46', fontSize: '0.85rem' }}>{paid > 0 ? fmt(paid) : '—'}</td>
                        <td style={{ color: remaining > 0 ? '#92400e' : '#065f46', fontWeight: 600, fontSize: '0.85rem' }}>
                          {remaining > 0 ? fmt(remaining) : '✓ Soldée'}
                        </td>
                        <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          )}

          {tab === 'paiements' && (
            payments.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: '0.9rem' }}>
                Aucun paiement enregistré sur les factures de ce partenaire.
              </div>
            ) : (
              <table className="hub-table">
                <thead>
                  <tr><th>Date</th><th>Facture</th><th>Méthode</th><th>Référence</th><th>Montant</th></tr>
                </thead>
                <tbody>
                  {payments.map(p => {
                    const inv = invoiceOf.get(p.invoice_id)
                    return (
                      <tr key={p.id}>
                        <td style={{ color: '#555', fontSize: '0.85rem' }}>{new Date(p.payment_date).toLocaleDateString('fr-FR')}</td>
                        <td>
                          {inv ? (
                            <Link href={`/invoices/${inv.id}`} style={{ fontFamily: 'monospace', color: 'var(--hub-green-mid)', textDecoration: 'none', fontWeight: 600, fontSize: '0.85rem' }}>
                              {inv.invoice_number}
                            </Link>
                          ) : <span style={{ color: '#999' }}>—</span>}
                        </td>
                        <td><span className="badge badge-green">{p.method}</span></td>
                        <td style={{ color: '#666', fontSize: '0.85rem' }}>{p.reference || '—'}</td>
                        <td style={{ fontWeight: 700, color: '#065f46' }}>{fmt(p.amount)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          )}

          {tab === 'achats' && (
            <div>
              {purchases.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: '0.9rem' }}>
                  Aucun achat enregistré auprès de ce fournisseur.
                </div>
              ) : (
                <table className="hub-table">
                  <thead>
                    <tr><th>N° Achat</th><th>Date</th><th>Montant</th><th>Payé</th><th>Solde</th><th>Statut</th></tr>
                  </thead>
                  <tbody>
                    {purchases.map(p => {
                      const cfg = purchaseStatus[p.status] || purchaseStatus.draft
                      const paid = paidByPurchase.get(p.id) || 0
                      const remaining = Math.max(0, (Number(p.subtotal) || 0) - paid)
                      return (
                        <tr key={p.id}>
                          <td>
                            <Link href={`/purchases/${p.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--hub-green-mid)', textDecoration: 'none' }}>
                              {p.purchase_number}
                            </Link>
                          </td>
                          <td style={{ color: '#666', fontSize: '0.85rem' }}>{new Date(p.date).toLocaleDateString('fr-FR')}</td>
                          <td style={{ fontWeight: 700 }}>{fmt(p.subtotal)}</td>
                          <td style={{ color: '#065f46', fontSize: '0.85rem' }}>{paid > 0 ? fmt(paid) : '—'}</td>
                          <td style={{ color: remaining > 0 ? '#92400e' : '#065f46', fontWeight: 600, fontSize: '0.85rem' }}>
                            {remaining > 0 ? fmt(remaining) : '✓ Soldé'}
                          </td>
                          <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {/* Paiements fournisseur — masqué proprement si la table n'existe pas */}
              <div style={{ borderTop: '1px solid #f0ece4' }}>
                {!supplierPaymentsOk && purchases.length > 0 ? (
                  <div style={{ padding: '14px 20px', background: '#fffbeb', color: '#92400e', fontSize: '0.8rem', fontWeight: 600 }}>
                    ⚠️ Le suivi des paiements fournisseur (table purchase_payments) n'est pas actif dans la base : seuls les achats sont affichés.
                  </div>
                ) : (
                  <div style={{ padding: '14px 20px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                      💸 Paiements fournisseur
                    </div>
                    {(() => {
                      const rows = purchases
                        .map(p => supplierPayments.filter(sp => sp.purchase_id === p.id).map(sp => ({ ...sp, purchase: p })))
                        .flat()
                        .sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)))
                      if (rows.length === 0) {
                        return <div style={{ color: '#999', fontSize: '0.85rem' }}>Aucun paiement fournisseur enregistré.</div>
                      }
                      return (
                        <table className="hub-table">
                          <thead><tr><th>Date</th><th>Achat</th><th>Montant</th></tr></thead>
                          <tbody>
                            {rows.map((r, idx) => (
                              <tr key={`${r.purchase_id}-${idx}`}>
                                <td style={{ color: '#555', fontSize: '0.85rem' }}>{new Date(r.payment_date).toLocaleDateString('fr-FR')}</td>
                                <td>
                                  <Link href={`/purchases/${r.purchase_id}`} style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--hub-green-mid)', textDecoration: 'none' }}>
                                    {r.purchase?.purchase_number || r.purchase_id.slice(0, 8)}
                                  </Link>
                                </td>
                                <td style={{ fontWeight: 700, color: '#065f46' }}>{fmt(r.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'documents' && (
            docs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: '0.9rem' }}>
                Aucun document lié à ce partenaire.
              </div>
            ) : (
              <table className="hub-table">
                <thead>
                  <tr><th>Type</th><th>Titre</th><th>Référence</th><th>Statut</th><th>Date</th><th>Montant</th></tr>
                </thead>
                <tbody>
                  {docs.map(d => {
                    const sc = docStatus[d.status] || { label: d.status, badge: 'badge-gray' }
                    return (
                      <tr key={d.id}>
                        <td>{docTypeLabels[d.type] || d.type}</td>
                        <td style={{ fontWeight: 600 }}>{d.title}</td>
                        <td style={{ fontFamily: 'monospace', color: '#666', fontSize: '0.85rem' }}>{d.document_number || d.reference}</td>
                        <td><span className={`badge ${sc.badge}`}>{sc.label}</span></td>
                        <td style={{ color: '#666', fontSize: '0.85rem' }}>{new Date(d.created_at).toLocaleDateString('fr-FR')}</td>
                        <td style={{ fontWeight: 700 }}>{Number(d.total_amount) > 0 ? fmt(Number(d.total_amount)) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          )}
        </div>

        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Link href="/documents" style={{ fontSize: '0.8rem', color: 'var(--hub-green-mid)', textDecoration: 'none' }}>📄 Gérer les documents →</Link>
        </div>
      </div>

      {/* Modal édition */}
      {showEdit && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowEdit(false)}>
          <div className="modal-box" style={{ maxWidth: 720 }}>
            <div className="modal-title">✏️ Modifier la fiche partenaire</div>
            {formError && (
              <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: '0.85rem', fontWeight: 600 }}>
                ⚠️ {formError}
              </div>
            )}
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Nom / Raison sociale *</label>
                  <input className="hub-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
                </div>
                <div className="hub-form-group">
                  <label>Type *</label>
                  <select className="hub-select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value as ClientType })}>
                    <option value="client">Client</option>
                    <option value="fournisseur">Fournisseur</option>
                    <option value="institution">Institution</option>
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Partenaire actif</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontWeight: 600, fontSize: '0.8rem', color: form.is_active ? '#065f46' : '#666' }}>
                    <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} style={{ width: 18, height: 18 }} />
                    {form.is_active ? '🟢 Actif' : '⚪ Inactif'}
                  </label>
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
                  <label>Ville</label>
                  <input className="hub-input" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>Adresse</label>
                  <input className="hub-input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>NIF</label>
                  <input className="hub-input" value={form.tax_id} onChange={e => setForm({ ...form, tax_id: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>RCCM</label>
                  <input className="hub-input" value={form.rccm} onChange={e => setForm({ ...form, rccm: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>Personne de contact</label>
                  <input className="hub-input" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>Téléphone du contact</label>
                  <input className="hub-input" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Site web</label>
                  <input className="hub-input" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>Conditions de paiement</label>
                  <input className="hub-input" value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>Limite de crédit (FCFA){form.type !== 'client' ? ' — clients seulement' : ''}</label>
                  <input className="hub-input" type="number" min={0} step={1000} value={form.credit_limit}
                    disabled={form.type !== 'client'} onChange={e => setForm({ ...form, credit_limit: e.target.value })} />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Notes</label>
                  <textarea className="hub-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} style={{ resize: 'vertical' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowEdit(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
