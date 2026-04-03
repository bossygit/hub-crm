'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

const statusConfig = {
  draft:     { label: 'Brouillon',    badge: 'badge-gray',  icon: '✏️', color: '#666' },
  pending:   { label: 'En attente',   badge: 'badge-amber', icon: '⏳', color: '#92400e' },
  paid:      { label: 'Payée',        badge: 'badge-green', icon: '✅', color: '#065f46' },
  cancelled: { label: 'Annulée',      badge: 'badge-red',   icon: '❌', color: '#991b1b' },
}

export default function InvoiceDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [invoice, setInvoice] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [clientHistory, setClientHistory] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentForm, setPaymentForm] = useState({ amount: 0, payment_date: new Date().toISOString().split('T')[0], method: 'virement', reference: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  async function load() {
    setLoading(true)
    const [{ data: inv }, { data: it }, { data: pay }] = await Promise.all([
      supabase.from('invoices').select('*, client:clients(*), creator:profiles!invoices_created_by_fkey(full_name)').eq('id', id).single(),
      supabase.from('invoice_items').select('*, product:products(name,unit)').eq('invoice_id', id).order('sort_order'),
      supabase.from('invoice_payments').select('*').eq('invoice_id', id).order('payment_date', { ascending: false }),
    ])
    setInvoice(inv)
    setItems(it || [])
    setPayments(pay || [])

    // Historique financier du client
    if (inv?.client_id) {
      const { data: hist } = await supabase.from('client_financial_summary').select('*').eq('client_id', inv.client_id).single()
      setClientHistory(hist)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  async function updateStatus(status: string) {
    setUpdating(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('invoices').update({
      status, updated_at: new Date().toISOString(),
      ...(status === 'paid' ? { validated_by: userData.user?.id } : {}),
    }).eq('id', id)
    if (error) alert('Erreur: ' + error.message)
    else load()
    setUpdating(false)
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const { data: userData } = await supabase.auth.getUser()
    await supabase.from('invoice_payments').insert({ ...paymentForm, invoice_id: id, created_by: userData.user?.id })
    // Si le montant couvre le total, marquer comme payé
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0) + paymentForm.amount
    if (totalPaid >= (invoice?.total || 0)) await supabase.from('invoices').update({ status: 'paid' }).eq('id', id)
    setSaving(false); setShowPaymentModal(false); load()
  }

  function generatePDF() {
    if (!invoice) return
    const logoUrl = '/app-icon.png'
    const statusCfg = statusConfig[invoice.status as keyof typeof statusConfig]
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0)
    const balance = Number(invoice.total || 0) - totalPaid

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Facture ${invoice.invoice_number}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; background: white; padding: 0; }
  @page { margin: 15mm 18mm; size: A4; }

  /* En-tête */
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding: 24px 32px 20px; background: #1a3d2b; color: white; }
  .logo-area { display: flex; align-items: center; gap: 14px; }
  .logo-area img { width: 52px; height: 52px; border-radius: 10px; background: rgba(255,255,255,0.1); }
  .company-name { font-size: 1.4rem; font-weight: 800; font-family: Georgia, serif; letter-spacing: -0.02em; }
  .company-sub { font-size: 0.7rem; opacity: 0.65; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 2px; }
  .invoice-badge { text-align: right; }
  .invoice-badge .type { background: #d4a017; color: white; padding: 5px 14px; border-radius: 4px; font-weight: 700; font-size: 0.85rem; letter-spacing: 0.06em; }
  .invoice-badge .num { font-family: monospace; font-size: 1.1rem; font-weight: 700; margin-top: 6px; }

  /* Corps */
  .body { padding: 28px 32px; }

  /* Infos */
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .meta-box { background: #f8f5ee; padding: 14px 16px; border-radius: 8px; }
  .meta-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: #888; font-weight: 700; margin-bottom: 4px; }
  .meta-value { font-size: 0.9rem; font-weight: 600; color: #1a3d2b; }
  .meta-value.mono { font-family: monospace; }

  /* Client */
  .client-section { margin-bottom: 24px; padding: 16px 20px; border-left: 4px solid #2d6a4f; background: #f8f5ee; border-radius: 0 8px 8px 0; }
  .client-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: #888; font-weight: 700; margin-bottom: 4px; }
  .client-name { font-size: 1.05rem; font-weight: 700; color: #1a3d2b; }
  .client-detail { font-size: 0.8rem; color: #555; margin-top: 2px; }

  /* Table articles */
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 0.875rem; }
  thead tr { background: #1a3d2b; color: white; }
  th { padding: 10px 14px; text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 700; }
  th:last-child { text-align: right; }
  td { padding: 10px 14px; border-bottom: 1px solid #f0ece4; vertical-align: top; }
  td:last-child { text-align: right; font-weight: 600; }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(even) td { background: #fafaf7; }
  .item-name { font-weight: 600; color: #1a3d2b; }
  .item-desc { font-size: 0.75rem; color: #888; margin-top: 2px; }

  /* Totaux */
  .totals-section { display: flex; justify-content: flex-end; margin-bottom: 28px; }
  .totals-box { width: 300px; }
  .total-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 0.875rem; border-bottom: 1px solid #f0ece4; }
  .total-row:last-child { border-bottom: none; }
  .total-final { background: #1a3d2b; color: white; padding: 12px 16px; border-radius: 8px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; }
  .total-final .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.8; }
  .total-final .amount { font-family: Georgia, serif; font-size: 1.4rem; font-weight: 800; }

  /* Paiements */
  .payments-section { margin-bottom: 24px; padding: 16px; background: #ecfdf5; border-radius: 8px; border: 1px solid #a7f3d0; }
  .payments-title { font-size: 0.75rem; font-weight: 700; color: #065f46; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
  .payment-row { display: flex; justify-content: space-between; font-size: 0.8rem; color: #065f46; padding: 2px 0; }

  /* Balance due */
  .balance-due { padding: 12px 16px; border-radius: 8px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
  .balance-due.outstanding { background: #fffbeb; border: 1px solid #fde68a; }
  .balance-due.settled { background: #ecfdf5; border: 1px solid #a7f3d0; }

  /* Signature + cachet */
  .signature-section { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 32px; padding-top: 20px; border-top: 1px solid #ddd; }
  .sig-box { text-align: center; }
  .sig-label { font-size: 0.72rem; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
  .sig-area { border: 1.5px dashed #ccc; border-radius: 8px; height: 60px; display: flex; align-items: center; justify-content: center; color: #ccc; font-size: 0.8rem; }

  /* Notes */
  .notes-box { padding: 12px 16px; background: #f8f5ee; border-radius: 8px; font-size: 0.8rem; color: #555; margin-bottom: 20px; }
  .notes-label { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 4px; }

  /* Footer */
  .footer { padding: 12px 32px; background: #0f1f17; color: rgba(255,255,255,0.5); font-size: 0.7rem; display: flex; justify-content: space-between; }

  /* Status ribbon */
  .status-ribbon { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
  .status-paid { background: #d1fae5; color: #065f46; }
  .status-pending { background: #fef3c7; color: #92400e; }
  .status-draft { background: #f3f4f6; color: #374151; }
</style>
</head>
<body>

<!-- EN-TÊTE -->
<div class="header">
  <div class="logo-area">
    <img src="${window.location.origin}${logoUrl}" alt="HUB Distribution Logo" onerror="this.style.display='none'" />
    <div>
      <div class="company-name">HUB Distribution</div>
      <div class="company-sub">Transformation & Distribution Agricole</div>
      <div style="font-size:0.72rem;opacity:0.6;margin-top:4px">Brazzaville, République du Congo · hub@distribution.cg</div>
    </div>
  </div>
  <div class="invoice-badge">
    <div class="type">🧾 FACTURE</div>
    <div class="num">${invoice.invoice_number}</div>
    <div style="margin-top:6px"><span class="status-ribbon status-${invoice.status}">${statusCfg.icon} ${statusCfg.label}</span></div>
  </div>
</div>

<div class="body">
  <!-- META INFOS -->
  <div class="meta-grid">
    <div class="meta-box">
      <div class="meta-label">Date d'émission</div>
      <div class="meta-value">${new Date(invoice.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
    </div>
    <div class="meta-box">
      <div class="meta-label">Date d'échéance</div>
      <div class="meta-value" style="color:${invoice.due_date && new Date(invoice.due_date) < new Date() && invoice.status !== 'paid' ? '#dc2626' : '#1a3d2b'}">
        ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}
      </div>
    </div>
    <div class="meta-box">
      <div class="meta-label">Conditions paiement</div>
      <div class="meta-value">${invoice.payment_terms || '30 jours'}</div>
    </div>
  </div>

  <!-- CLIENT -->
  ${invoice.client ? `
  <div class="client-section">
    <div class="client-label">Facturé à</div>
    <div class="client-name">${invoice.client.name}</div>
    ${invoice.client.email ? `<div class="client-detail">📧 ${invoice.client.email}</div>` : ''}
    ${invoice.client.phone ? `<div class="client-detail">📱 ${invoice.client.phone}</div>` : ''}
    ${invoice.client.address ? `<div class="client-detail">📍 ${invoice.client.address}</div>` : ''}
    ${invoice.client.tax_id ? `<div class="client-detail">NIF: ${invoice.client.tax_id}</div>` : ''}
  </div>` : ''}

  <!-- ARTICLES -->
  <table>
    <thead>
      <tr>
        <th style="width:40%">Désignation</th>
        <th style="width:12%">Qté</th>
        <th style="width:12%">Unité</th>
        <th style="width:18%">Prix unitaire</th>
        <th style="width:18%">Total HT</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((it: any) => `
      <tr>
        <td><div class="item-name">${it.name}</div>${it.description ? `<div class="item-desc">${it.description}</div>` : ''}</td>
        <td>${it.quantity}</td>
        <td>${it.unit || '—'}</td>
        <td>${Number(it.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
        <td>${Number(it.subtotal || it.quantity * it.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <!-- TOTAUX -->
  <div class="totals-section">
    <div class="totals-box">
      <div class="total-row"><span style="color:#666">Sous-total HT</span><span>${Number(invoice.subtotal || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span></div>
      ${Number(invoice.discount) > 0 ? `<div class="total-row"><span style="color:#666">Remise</span><span style="color:#dc2626">- ${Number(invoice.discount).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span></div>` : ''}
      <div class="total-row"><span style="color:#666">TVA (${invoice.tax_rate}%)</span><span>${Number(invoice.tax_amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span></div>
      <div class="total-final">
        <div><div class="label">Total TTC</div></div>
        <div class="amount">${Number(invoice.total || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</div>
      </div>
    </div>
  </div>

  <!-- PAIEMENTS -->
  ${payments.length > 0 ? `
  <div class="payments-section">
    <div class="payments-title">✅ Paiements enregistrés</div>
    ${payments.map((p: any) => `
    <div class="payment-row">
      <span>${new Date(p.payment_date).toLocaleDateString('fr-FR')} — ${p.method} ${p.reference ? '· Réf: ' + p.reference : ''}</span>
      <span style="font-weight:700">${Number(p.amount).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span>
    </div>`).join('')}
  </div>` : ''}

  <!-- SOLDE -->
  ${balance > 0 ? `
  <div class="balance-due outstanding">
    <span style="font-weight:600;color:#92400e">⏳ Solde restant dû</span>
    <span style="font-weight:800;font-size:1.1rem;color:#92400e">${balance.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span>
  </div>` : `
  <div class="balance-due settled">
    <span style="font-weight:600;color:#065f46">✅ Facture soldée</span>
    <span style="font-weight:700;color:#065f46">Aucun solde dû</span>
  </div>`}

  ${invoice.notes ? `
  <div class="notes-box">
    <div class="notes-label">Notes</div>
    <div>${invoice.notes}</div>
  </div>` : ''}

  <!-- SIGNATURES -->
  <div class="signature-section">
    <div class="sig-box">
      <div class="sig-label">Émetteur — HUB Distribution</div>
      <div class="sig-area">Signature & Cachet</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">Client — ${invoice.client?.name || 'Client'}</div>
      <div class="sig-area">Lu et approuvé</div>
    </div>
  </div>
</div>

<!-- FOOTER -->
<div class="footer">
  <span>HUB Distribution — RCCM: BZV-XXXX-XX — NIF: XXXXXXXXXX — Brazzaville, République du Congo</span>
  <span>Généré le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
</div>

</body>
</html>`

    const w = window.open('', '_blank')
    if (w) {
      w.document.write(html)
      w.document.close()
      setTimeout(() => w.print(), 800)
    }
  }

  if (loading) return <div className="invoice-state invoice-state--loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#999' }}>Chargement...</div>
  if (!invoice) return <div className="invoice-state invoice-state--empty" style={{ padding: 40, textAlign: 'center', color: '#999' }}>Facture introuvable</div>

  const statusCfg = statusConfig[invoice.status as keyof typeof statusConfig]
  const totalPaid = payments.reduce((s: number, p: any) => s + Number(p.amount), 0)
  const balance = Number(invoice.total || 0) - totalPaid
  const isOverdue = invoice.status === 'pending' && invoice.due_date && new Date(invoice.due_date) < new Date()

  return (
    <div className="invoice-page invoice-page--detail">
      <div className="page-header invoice-page__toolbar">
        <div className="invoice-page__header-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="invoice-btn invoice-btn--back" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>🧾 {invoice.invoice_number}</h2>
          <span className={`badge ${statusCfg.badge}`}>{statusCfg.icon} {statusCfg.label}</span>
          {isOverdue && <span className="badge badge-red">⚠️ En retard</span>}
        </div>
        <div className="invoice-page__header-actions" style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn-ghost invoice-btn invoice-btn--print-pdf" onClick={generatePDF}>🖨️ Imprimer / PDF</button>
          <Link href={`/invoices/new?duplicate=${invoice.id}`} className="btn-ghost invoice-btn invoice-btn--duplicate" style={{ textDecoration: 'none' }}>📋 Dupliquer</Link>
          {invoice.status === 'draft' && (
            <Link href={`/invoices/${invoice.id}/edit`} className="btn-amber invoice-btn invoice-btn--edit" style={{ textDecoration: 'none' }}>✏️ Modifier</Link>
          )}
        </div>
      </div>

      <div className="invoice-page__body" style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <div className="invoice-page__layout" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>

          {/* Colonne principale */}
          <div className="invoice-page__main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Infos + Client */}
            <div className="invoice-section invoice-section--header-card" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              {/* Mini header style PDF */}
              <div className="invoice-detail-card__banner" style={{ background: 'var(--hub-green)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'white' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/app-icon.png" alt="Logo" width={40} height={40} style={{ borderRadius: 8, background: 'rgba(255,255,255,0.1)' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  <div>
                    <div style={{ fontFamily: 'Georgia, serif', fontWeight: 800, fontSize: '1.1rem' }}>HUB Distribution</div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.65, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Transformation & Distribution Agricole</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', color: 'white' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '1.2rem', fontWeight: 700 }}>{invoice.invoice_number}</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{new Date(invoice.date).toLocaleDateString('fr-FR')}</div>
                </div>
              </div>

              <div className="invoice-section__body" style={{ padding: '20px 24px' }}>
                <div className="invoice-detail-meta invoice-form-grid invoice-form-grid--meta" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
                  {[
                    ['Date', new Date(invoice.date).toLocaleDateString('fr-FR')],
                    ['Échéance', invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('fr-FR') : '—'],
                    ['Conditions', invoice.payment_terms || '30 jours'],
                  ].map(([label, val]) => (
                    <div key={label} className="invoice-detail-meta__cell" style={{ background: '#f8f5ee', padding: '12px 14px', borderRadius: 8 }}>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', fontWeight: 700, marginBottom: 3 }}>{label}</div>
                      <div style={{ fontWeight: 600, color: 'var(--hub-green)' }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Client */}
                {invoice.client && (
                  <div className="invoice-detail-client" style={{ padding: '14px 18px', borderLeft: '4px solid var(--hub-green-mid)', background: '#f8f5ee', borderRadius: '0 8px 8px 0', marginBottom: 0 }}>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', fontWeight: 700, marginBottom: 4 }}>Facturé à</div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--hub-green)' }}>{invoice.client.name}</div>
                    {invoice.client.email && <div style={{ fontSize: '0.8rem', color: '#666' }}>📧 {invoice.client.email}</div>}
                    {invoice.client.phone && <div style={{ fontSize: '0.8rem', color: '#666' }}>📱 {invoice.client.phone}</div>}
                    {invoice.client.address && <div style={{ fontSize: '0.8rem', color: '#666' }}>📍 {invoice.client.address}</div>}
                  </div>
                )}
              </div>
            </div>

            {/* Lignes articles */}
            <div className="invoice-section invoice-section--lines-detail" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div className="invoice-section__title" style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.875rem' }}>
                📦 Articles
              </div>
              <table className="hub-table invoice-detail-items-table">
                <thead>
                  <tr><th>Désignation</th><th>Qté</th><th>Unité</th><th>Prix unit.</th><th>Total HT</th></tr>
                </thead>
                <tbody>
                  {items.map((it: any) => (
                    <tr key={it.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{it.name}</div>
                        {it.description && <div style={{ fontSize: '0.75rem', color: '#999' }}>{it.description}</div>}
                        {it.product?.name && it.product.name !== it.name && <div style={{ fontSize: '0.72rem', color: '#aaa' }}>Produit: {it.product.name}</div>}
                      </td>
                      <td style={{ fontWeight: 700 }}>{it.quantity}</td>
                      <td style={{ color: '#666' }}>{it.unit || '—'}</td>
                      <td>{Number(it.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
                      <td style={{ fontWeight: 700 }}>{Number(it.subtotal || it.quantity * it.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totaux */}
              <div className="invoice-detail-totals" style={{ padding: '16px 20px', background: '#f8f5ee', display: 'flex', justifyContent: 'flex-end' }}>
                <div className="invoice-detail-totals__inner" style={{ width: 300 }}>
                  {[
                    ['Sous-total HT', `${Number(invoice.subtotal || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`],
                    ...(Number(invoice.discount) > 0 ? [['Remise', `- ${Number(invoice.discount).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`]] : []),
                    [`TVA (${invoice.tax_rate}%)`, `${Number(invoice.tax_amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.875rem', borderBottom: '1px solid #e8e4db' }}>
                      <span style={{ color: '#666' }}>{label}</span><span>{val}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, padding: '12px 16px', background: 'var(--hub-green)', color: 'white', borderRadius: 8 }}>
                    <span style={{ fontWeight: 700 }}>Total TTC</span>
                    <span style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', fontWeight: 800 }}>{Number(invoice.total || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Paiements */}
            {(payments.length > 0 || invoice.status === 'pending') && (
              <div className="invoice-section invoice-section--payments" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
                <div className="invoice-section__header invoice-payments__toolbar" style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="invoice-section__title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.875rem' }}>💳 Paiements</div>
                  {invoice.status !== 'paid' && (
                    <button type="button" className="btn-primary invoice-btn invoice-btn--add-payment-inline" style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={() => { setPaymentForm(f => ({ ...f, amount: balance > 0 ? balance : 0 })); setShowPaymentModal(true) }}>
                      + Enregistrer paiement
                    </button>
                  )}
                </div>
                {payments.length > 0 ? (
                  <table className="hub-table invoice-payments-table">
                    <thead><tr><th>Date</th><th>Méthode</th><th>Référence</th><th>Montant</th></tr></thead>
                    <tbody>
                      {payments.map((p: any) => (
                        <tr key={p.id}>
                          <td>{new Date(p.payment_date).toLocaleDateString('fr-FR')}</td>
                          <td><span className="badge badge-green">{p.method}</span></td>
                          <td style={{ color: '#666' }}>{p.reference || '—'}</td>
                          <td style={{ fontWeight: 700, color: '#065f46' }}>{Number(p.amount).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="invoice-payments-empty" style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>Aucun paiement enregistré</div>
                )}
                {balance > 0 && payments.length > 0 && (
                  <div className="invoice-payments-balance" style={{ padding: '12px 20px', background: '#fffbeb', borderTop: '1px solid #fde68a', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#92400e', fontWeight: 600 }}>⏳ Solde restant dû</span>
                    <span style={{ fontWeight: 800, color: '#92400e' }}>{balance.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span>
                  </div>
                )}
              </div>
            )}

            {invoice.notes && (
              <div className="invoice-section invoice-section--notes-detail" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '16px 20px' }}>
                <div className="invoice-section__title" style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', marginBottom: 6 }}>Notes</div>
                <div style={{ color: '#555', fontSize: '0.875rem' }}>{invoice.notes}</div>
              </div>
            )}
          </div>

          {/* Colonne droite */}
          <div className="invoice-page__aside" style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 80 }}>

            {/* Actions */}
            <div className="invoice-section invoice-section--actions-detail" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px' }}>
              <div className="invoice-section__title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Actions</div>
              <div className="invoice-detail-actions" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button type="button" className="btn-primary invoice-btn invoice-btn--print-pdf-aside" style={{ justifyContent: 'center', padding: '11px' }} onClick={generatePDF}>🖨️ Imprimer / Télécharger PDF</button>
                {invoice.status === 'draft' && (
                  <button type="button" className="btn-amber invoice-btn invoice-btn--submit-detail" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => updateStatus('pending')} disabled={updating}>
                    📤 Soumettre pour validation
                  </button>
                )}
                {invoice.status === 'pending' && (
                  <>
                    <button type="button" className="btn-primary invoice-btn invoice-btn--mark-paid" style={{ justifyContent: 'center', padding: '11px', background: '#065f46' }} onClick={() => updateStatus('paid')} disabled={updating}>
                      ✅ Marquer comme Payée
                    </button>
                    <button type="button" className="btn-ghost invoice-btn invoice-btn--add-payment-aside" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => { setPaymentForm(f => ({ ...f, amount: balance })); setShowPaymentModal(true) }}>
                      💳 Enregistrer un paiement
                    </button>
                  </>
                )}
                {invoice.status !== 'cancelled' && invoice.status !== 'paid' && (
                  <button type="button" className="btn-danger invoice-btn invoice-btn--cancel-invoice" style={{ padding: '10px', justifyContent: 'center' }} onClick={() => { if (confirm('Annuler cette facture ?')) updateStatus('cancelled') }}>
                    ❌ Annuler la facture
                  </button>
                )}
              </div>
            </div>

            {/* Résumé financier */}
            <div className="invoice-section invoice-section--financial-summary" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px' }}>
              <div className="invoice-section__title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>💰 Résumé</div>
              {[
                ['Total TTC', `${Number(invoice.total || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`, true],
                ['Total payé', `${totalPaid.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`, false],
                ['Solde dû', `${Math.max(0, balance).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`, false],
              ].map(([label, val, bold]) => (
                <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0ece4', fontSize: '0.875rem' }}>
                  <span style={{ color: '#666' }}>{label}</span>
                  <span style={{ fontWeight: bold ? 700 : 600, color: bold ? 'var(--hub-green)' : '#333' }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Historique client */}
            {clientHistory && (
              <div className="invoice-section invoice-section--client-profile" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px' }}>
                <div className="invoice-section__title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                  👤 Profil Client
                </div>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>{clientHistory.client_name}</div>
                {[
                  ['Factures totales', clientHistory.total_invoices],
                  ['CA total commandé', `${Number(clientHistory.total_ordered || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`],
                  ['Total encaissé', `${Number(clientHistory.total_paid || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`],
                  ['Solde dû', `${Number(clientHistory.balance_due || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`],
                ].map(([label, val]) => (
                  <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0ece4', fontSize: '0.8rem' }}>
                    <span style={{ color: '#666' }}>{label}</span>
                    <span style={{ fontWeight: 600 }}>{String(val)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Métadonnées */}
            <div className="invoice-section invoice-section--meta-footer" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '16px 20px' }}>
              <div className="invoice-detail-meta-footer" style={{ fontSize: '0.7rem', color: '#999', lineHeight: 1.8 }}>
                <div>Créé par: {invoice.creator?.full_name || '—'}</div>
                <div>Créé le: {new Date(invoice.created_at).toLocaleString('fr-FR')}</div>
                {invoice.validated_at && <div>Validé le: {new Date(invoice.validated_at).toLocaleString('fr-FR')}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Paiement */}
      {showPaymentModal && (
        <div className="modal-overlay invoice-payment-modal-overlay" onClick={e => e.target === e.currentTarget && setShowPaymentModal(false)}>
          <div className="modal-box invoice-payment-modal">
            <div className="modal-title invoice-payment-modal__title">💳 Enregistrer un paiement</div>
            <form className="invoice-payment-modal__form" onSubmit={addPayment}>
              <div className="hub-form-group">
                <label>Montant (FCFA) *</label>
                <input className="hub-input invoice-field invoice-field--payment-amount" type="number" min={1} required value={paymentForm.amount || ''}
                  onChange={e => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })} />
                {balance > 0 && <div className="invoice-payment-modal__hint" style={{ fontSize: '0.75rem', color: '#666', marginTop: 4 }}>Solde dû: {balance.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</div>}
              </div>
              <div className="hub-form-group">
                <label>Date du paiement</label>
                <input className="hub-input invoice-field invoice-field--payment-date" type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm({ ...paymentForm, payment_date: e.target.value })} />
              </div>
              <div className="hub-form-group">
                <label>Méthode de paiement</label>
                <select className="hub-select invoice-field invoice-field--payment-method" value={paymentForm.method} onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value })}>
                  {['virement', 'espèces', 'chèque', 'mobile money', 'autre'].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="hub-form-group">
                <label>Référence / N° de transaction</label>
                <input className="hub-input invoice-field invoice-field--payment-reference" value={paymentForm.reference} onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })} placeholder="TXN-2026-XXXX" />
              </div>
              <div className="hub-form-group">
                <label>Notes</label>
                <textarea className="hub-input invoice-field invoice-field--payment-notes" rows={2} value={paymentForm.notes} onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })} style={{ resize: 'vertical' }} />
              </div>
              <div className="invoice-payment-modal__actions" style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost invoice-btn invoice-btn--payment-cancel" onClick={() => setShowPaymentModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary invoice-btn invoice-btn--payment-submit" disabled={saving}>{saving ? '...' : '✅ Enregistrer le paiement'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
