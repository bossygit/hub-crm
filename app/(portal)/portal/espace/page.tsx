'use client'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { computeClientFinance, type ClientInvoiceInput, type ClientPaymentInput } from '@/lib/clients/finance'

/**
 * Espace partenaire (phase 3) — accessible aux comptes reliés à une fiche
 * `clients` (clients.user_id). La RLS limite strictement aux données du
 * partenaire : sa fiche, ses factures, ses documents, ses commandes portail.
 */

const invoiceStatus: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray' },
  pending: { label: 'En attente', badge: 'badge-amber' },
  approved: { label: 'Validée', badge: 'badge-green' },
  partial: { label: 'Partielle', badge: 'badge-blue' },
  paid: { label: 'Payée', badge: 'badge-green' },
  cancelled: { label: 'Annulée', badge: 'badge-red' },
}

const documentStatus: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray' },
  pending: { label: 'En attente', badge: 'badge-amber' },
  approved: { label: 'Livré', badge: 'badge-green' },
  rejected: { label: 'Annulé', badge: 'badge-red' },
}

const orderStatus: Record<string, string> = {
  nouvelle: 'Nouvelle',
  en_cours: 'En cours',
  pret: 'Prête',
  livree: 'Livrée',
  convertie: 'Convertie',
  annulee: 'Annulée',
}

const documentType: Record<string, string> = {
  bon_livraison: 'Bon de livraison',
  bon_de_livraison: 'Bon de livraison',
  facture: 'Facture',
  recu_paiement: 'Reçu de paiement',
  devis: 'Devis',
}

function frDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('fr-FR')
}

function fcfa(value: number): string {
  return `${(Number(value) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`
}

export default function PartnerSpacePage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [client, setClient] = useState<any>(null)
  const [invoices, setInvoices] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [documents, setDocuments] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) { setLoading(false); return }
      setEmail(user.email || null)

      const { data: cl } = await supabase.from('clients').select('*').eq('user_id', user.id).maybeSingle()
      if (cancelled) return
      setClient(cl || null)

      if (cl) {
        const { data: inv } = await supabase
          .from('invoices')
          .select('*')
          .eq('client_id', cl.id)
          .order('date', { ascending: false })
        const list = inv || []
        const ids = list.map(i => i.id)

        const [payRes, docRes, ordRes] = await Promise.all([
          ids.length
            ? supabase.from('invoice_payments').select('invoice_id, amount, payment_date').in('invoice_id', ids)
            : Promise.resolve({ data: [] as any[] }),
          supabase.from('documents')
            .select('id, document_number, type, status, created_at, invoice_id')
            .eq('client_id', cl.id)
            .order('created_at', { ascending: false }),
          user.email
            ? supabase.from('portal_orders').select('*').ilike('customer_email', user.email).order('created_at', { ascending: false })
            : Promise.resolve({ data: [] as any[] }),
        ])

        if (cancelled) return
        setInvoices(list)
        setPayments((payRes.data || []) as any[])
        setDocuments(docRes.data || [])
        setOrders(ordRes.data || [])
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const finance = useMemo(
    () => computeClientFinance(
      invoices as ClientInvoiceInput[],
      payments as ClientPaymentInput[],
    ),
    [invoices, payments],
  )

  function shell(title: string, children: ReactNode) {
    return (
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 20px 64px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888', fontWeight: 700 }}>HUB Distribution</div>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.8rem', fontWeight: 800, color: 'var(--hub-green)', margin: '4px 0 0' }}>{title}</h1>
          </div>
          <Link href="/portal" className="btn-ghost" style={{ textDecoration: 'none' }}>← Portail public</Link>
        </div>
        {children}
      </div>
    )
  }

  if (loading) {
    return shell('Espace partenaire', <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement…</div>)
  }

  if (!email) {
    return shell('Espace partenaire', (
      <div style={{ background: 'white', border: '1px solid #e8e4db', borderRadius: 12, padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '2.2rem', marginBottom: 10 }}>🔐</div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Connexion requise</div>
        <div style={{ color: '#666', fontSize: '0.9rem', marginBottom: 18 }}>
          Connectez-vous avec le compte partenaire communiqué par HUB Distribution pour consulter vos factures, livraisons et commandes.
        </div>
        <Link href="/login" className="btn-primary" style={{ textDecoration: 'none' }}>Se connecter</Link>
      </div>
    ))
  }

  if (!client) {
    return shell('Espace partenaire', (
      <div style={{ background: 'white', border: '1px solid #e8e4db', borderRadius: 12, padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '2.2rem', marginBottom: 10 }}>🔗</div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Compte non rattaché à une fiche partenaire</div>
        <div style={{ color: '#666', fontSize: '0.9rem' }}>
          Le compte <strong>{email}</strong> n'est relié à aucune fiche partenaire. Contactez HUB Distribution pour activer votre accès.
        </div>
      </div>
    ))
  }

  return shell(`Espace de ${client.name}`, (
    <>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14, marginBottom: 22 }}>
        <div className="stat-card green"><div className="stat-value" style={{ fontSize: '1.15rem' }}>{fcfa(finance.totalInvoiced)}</div><div className="stat-label">Total facturé</div></div>
        <div className={`stat-card ${finance.balanceDue > 0 ? 'amber' : 'green'}`}><div className="stat-value" style={{ fontSize: '1.15rem' }}>{fcfa(finance.balanceDue)}</div><div className="stat-label">Solde dû</div></div>
        <div className="stat-card blue"><div className="stat-value">{finance.invoiceCount}</div><div className="stat-label">Factures</div></div>
        <div className="stat-card green"><div className="stat-value">{documents.length}</div><div className="stat-label">Documents</div></div>
        <div className="stat-card amber"><div className="stat-value">{orders.length}</div><div className="stat-label">Commandes portail</div></div>
      </div>

      {/* Fiche */}
      <div style={{ background: 'white', border: '1px solid #e8e4db', borderRadius: 12, padding: '18px 20px', marginBottom: 22 }}>
        <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Ma fiche</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, fontSize: '0.85rem', color: '#555' }}>
          <div>🏢 <strong>{client.name}</strong></div>
          <div>✉️ {client.email || '—'}</div>
          <div>📱 {client.phone || '—'}</div>
          <div>📍 {client.city || client.address || '—'}</div>
          <div>🆔 NIF {client.tax_id || '—'}</div>
          <div>📄 RCCM {client.rccm || '—'}</div>
        </div>
      </div>

      {/* Factures */}
      <div style={{ background: 'white', border: '1px solid #e8e4db', borderRadius: 12, overflow: 'hidden', marginBottom: 22 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.875rem' }}>🧾 Mes factures</div>
        {invoices.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Aucune facture.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="hub-table">
              <thead><tr><th>N°</th><th>Date</th><th>Échéance</th><th>Montant TTC</th><th>Statut</th></tr></thead>
              <tbody>
                {invoices.map(inv => {
                  const cfg = invoiceStatus[inv.status] || invoiceStatus.draft
                  const overdue = ['approved', 'partial'].includes(inv.status) && inv.due_date && new Date(inv.due_date) < new Date()
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{inv.invoice_number}</td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{frDate(inv.date)}</td>
                      <td style={{ color: overdue ? '#dc2626' : '#666', fontSize: '0.85rem', fontWeight: overdue ? 700 : 400 }}>
                        {frDate(inv.due_date)}{overdue && <span style={{ display: 'block', fontSize: '0.7rem' }}>⚠ en retard</span>}
                      </td>
                      <td style={{ fontWeight: 700 }}>{fcfa(inv.total)}</td>
                      <td><span className={`badge ${cfg.badge}`}>{cfg.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Documents / livraisons */}
      <div style={{ background: 'white', border: '1px solid #e8e4db', borderRadius: 12, overflow: 'hidden', marginBottom: 22 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.875rem' }}>🚚 Mes livraisons & documents</div>
        {documents.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Aucun document.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="hub-table">
              <thead><tr><th>Référence</th><th>Type</th><th>Date</th><th>Statut</th></tr></thead>
              <tbody>
                {documents.map(doc => {
                  const cfg = documentStatus[doc.status] || documentStatus.draft
                  return (
                    <tr key={doc.id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{doc.document_number || `#${String(doc.id).slice(-6)}`}</td>
                      <td style={{ color: '#555', fontSize: '0.85rem' }}>{documentType[doc.type] || doc.type}</td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{frDate(doc.created_at)}</td>
                      <td><span className={`badge ${cfg.badge}`}>{cfg.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Commandes portail */}
      <div style={{ background: 'white', border: '1px solid #e8e4db', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.875rem' }}>🛍️ Mes commandes portail</div>
        {orders.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>
            Aucune commande. <Link href="/portal" style={{ color: 'var(--hub-green-mid)' }}>Passer une commande →</Link>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="hub-table">
              <thead><tr><th>N°</th><th>Date</th><th>Montant</th><th>Statut</th></tr></thead>
              <tbody>
                {orders.map(order => (
                  <tr key={order.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{order.order_number}</td>
                    <td style={{ color: '#666', fontSize: '0.85rem' }}>{frDate(order.created_at)}</td>
                    <td style={{ fontWeight: 700 }}>{fcfa(order.total_amount)}</td>
                    <td><span className="badge badge-blue">{orderStatus[order.status] || order.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  ))
}
