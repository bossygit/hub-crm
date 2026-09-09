import { createClient } from '@/lib/supabase/server'
import { receiptsJournalToCsv, salesJournalToCsv } from '@/lib/reports/csv'
import { buildMonthJournal, resolveMonth } from '@/lib/reports/journal'
import {
  buildClientLedger,
  buildSupplierLedger,
  grandLivreCsvFilename,
  ledgerCsv,
  ledgerTotals,
  withRunningBalance,
} from '@/lib/reports/ledger'
import JournalExports from './JournalExports'

export const dynamic = 'force-dynamic'

function fcfa(n: number) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function capitalizedMonthLabel(month: string) {
  const label = monthLabel(month)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function frDay(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const supabase = await createClient()
  const rawMonth = searchParams.month
  const month = resolveMonth(Array.isArray(rawMonth) ? rawMonth[0] : rawMonth)

  const now = new Date()
  const startOfMonthIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [
    { data: invoicesData },
    { data: clientsData },
    { data: paymentsData },
    { data: products },
    { data: batches },
    { data: movements },
    { count: totalEmployees },
    { data: pendingDocs },
    { count: pendingRequests },
    { data: purchasesData },
    { data: supplierPaymentsData },
  ] = await Promise.all([
    supabase.from('invoices').select('id, invoice_number, status, subtotal, discount, tax_amount, total, date, client_id'),
    supabase.from('clients').select('id, name, tax_id, type'),
    supabase.from('invoice_payments').select('invoice_id, amount, payment_date, method, reference'),
    supabase.from('products').select('id, name, quantity, threshold_alert, unit, price_per_unit'),
    supabase.from('product_batches').select('id, product_id, batch_number, quantity, expiry_date, product:products(name)'),
    supabase.from('stock_movements').select('type, quantity, created_at').gte('created_at', startOfMonthIso),
    supabase.from('employees').select('*', { count: 'exact', head: true }).eq('status', 'actif'),
    supabase.from('documents').select('id, title, type, status, created_at').eq('status', 'pending'),
    supabase.from('document_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('purchases').select('id, purchase_number, supplier_id, date, status, subtotal'),
    supabase.from('purchase_payments').select('purchase_id, amount, payment_date'),
  ])

  const journal = buildMonthJournal(
    (invoicesData || []).map(inv => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      date: inv.date,
      status: inv.status,
      subtotal: Number(inv.subtotal || 0),
      discount: Number(inv.discount || 0),
      tax_amount: Number(inv.tax_amount || 0),
      total: Number(inv.total || 0),
      client_id: inv.client_id,
    })),
    (clientsData || []).map(c => ({ id: c.id, name: c.name, tax_id: c.tax_id })),
    (paymentsData || []).map(p => ({
      invoice_id: p.invoice_id,
      amount: Number(p.amount || 0),
      payment_date: p.payment_date,
      method: p.method,
      reference: p.reference,
    })),
    month,
  )

  const salesCsv = salesJournalToCsv(journal.sales)
  const receiptsCsv = receiptsJournalToCsv(journal.receipts)

  // ── Grand livre simplifié (auxiliaires clients & fournisseurs) ─────────────
  const parties = clientsData || []
  const partiesById = new Map(parties.map(c => [c.id, c]))
  const partyTypeLabel = (type?: string | null) =>
    type === 'fournisseur' ? 'Fournisseur' : type === 'institution' ? 'Institution' : 'Client'

  const rawLedgerScope = searchParams['gl-scope']
  const ledgerScopeParam = Array.isArray(rawLedgerScope) ? rawLedgerScope[0] : rawLedgerScope
  const ledgerScope =
    ledgerScopeParam === 'clients' || ledgerScopeParam === 'fournisseurs' || ledgerScopeParam === 'tout'
      ? ledgerScopeParam
      : 'tout'

  const rawLedgerAccount = searchParams['gl-compte']
  const ledgerAccountParam = Array.isArray(rawLedgerAccount) ? rawLedgerAccount[0] : rawLedgerAccount
  const ledgerScopeAccounts = parties.filter(c => {
    if (ledgerScope === 'clients') return c.type !== 'fournisseur'
    if (ledgerScope === 'fournisseurs') return c.type === 'fournisseur'
    return true
  })
  const ledgerAccount =
    typeof ledgerAccountParam === 'string' && ledgerScopeAccounts.some(c => c.id === ledgerAccountParam)
      ? ledgerAccountParam
      : ''

  const rawLedgerMonth = searchParams['gl-month']
  const ledgerMonthParam = Array.isArray(rawLedgerMonth) ? rawLedgerMonth[0] : rawLedgerMonth
  const ledgerMonth =
    typeof ledgerMonthParam === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ledgerMonthParam)
      ? ledgerMonthParam
      : ''

  const ledgerMonthOptions: string[] = []
  {
    const ledgerNow = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(ledgerNow.getUTCFullYear(), ledgerNow.getUTCMonth() - i, 1))
      ledgerMonthOptions.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
    }
  }

  const invoiceLedgerRows = (invoicesData || []).map(inv => {
    const party = inv.client_id ? partiesById.get(inv.client_id) : undefined
    return {
      id: inv.id,
      invoice_number: inv.invoice_number,
      date: inv.date,
      status: inv.status,
      client_id: inv.client_id,
      total: Number(inv.total || 0),
      client: party ? { id: party.id, name: party.name } : null,
    }
  })
  const clientPaymentRows = (paymentsData || []).map(p => ({
    invoice_id: p.invoice_id,
    amount: Number(p.amount || 0),
    payment_date: p.payment_date,
  }))

  const purchaseLedgerRows = (purchasesData || []).map(p => {
    const party = p.supplier_id ? partiesById.get(p.supplier_id) : undefined
    return {
      id: p.id,
      purchase_number: p.purchase_number,
      date: p.date,
      status: p.status,
      supplier_id: p.supplier_id,
      subtotal: Number(p.subtotal || 0),
      client: party ? { id: party.id, name: party.name } : null,
    }
  })
  const supplierPaymentRows = (supplierPaymentsData || []).map(p => ({
    purchase_id: p.purchase_id,
    amount: Number(p.amount || 0),
    payment_date: p.payment_date,
  }))

  const clientLedger = buildClientLedger(invoiceLedgerRows, clientPaymentRows, ledgerAccount || null)
  const supplierLedger = buildSupplierLedger(purchaseLedgerRows, supplierPaymentRows, ledgerAccount || null)
  const ledgerRaw =
    ledgerScope === 'clients'
      ? clientLedger
      : ledgerScope === 'fournisseurs'
        ? supplierLedger
        : [...clientLedger, ...supplierLedger].sort(
            (a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label),
          )
  const ledgerRows = withRunningBalance(
    ledgerMonth ? ledgerRaw.filter(e => e.date.startsWith(ledgerMonth)) : ledgerRaw,
  )
  const ledgerTotal = ledgerTotals(ledgerRows)
  const ledgerCsvContent = ledgerCsv(ledgerRows)
  const ledgerCsvName = grandLivreCsvFilename(ledgerScope, ledgerMonth)

  const lowStock = (products || []).filter(p => p.quantity <= p.threshold_alert)
  const today = new Date().toISOString().split('T')[0]
  const expiredBatches = (batches || []).filter(b => b.expiry_date && b.expiry_date < today && b.quantity > 0)
  const soonExpiring = (batches || []).filter(b => {
    if (!b.expiry_date || b.quantity <= 0) return false
    const diff = (new Date(b.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    return diff >= 0 && diff <= 30
  })

  const stockValue = (products || []).reduce((s, p) => s + p.quantity * (p.price_per_unit || 0), 0)
  const monthIN = (movements || []).filter(m => m.type === 'IN').reduce((s, m) => s + Number(m.quantity), 0)
  const monthOUT = (movements || []).filter(m => m.type === 'OUT').reduce((s, m) => s + Number(m.quantity), 0)

  return (
    <div>
      <div className="page-header">
        <h2>📊 Rapports & Tableaux de bord</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <form method="get" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: '0.8rem', color: '#666', fontWeight: 600 }}>Mois</label>
            <input className="hub-input" type="month" name="month" defaultValue={month} style={{ maxWidth: 180 }} />
            <button type="submit" className="btn-ghost" style={{ padding: '8px 14px', fontSize: '0.8rem' }}>Afficher</button>
          </form>
          <JournalExports month={month} salesCsv={salesCsv} receiptsCsv={receiptsCsv} />
        </div>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: 16, textTransform: 'capitalize' }}>
          Journal {monthLabel(month)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, marginBottom: 32 }}>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>📈</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{fcfa(journal.monthHt)}</div>
            <div className="stat-label">FCFA — CA HT du mois</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>💵</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{fcfa(journal.monthTtc)}</div>
            <div className="stat-label">FCFA — CA TTC du mois</div>
          </div>
          <div className="stat-card blue">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>🏦</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{fcfa(journal.monthVat)}</div>
            <div className="stat-label">FCFA — TVA du mois</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>💳</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{fcfa(journal.monthCollected)}</div>
            <div className="stat-label">FCFA — Encaissé du mois</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>⏳</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{fcfa(journal.monthOutstanding)}</div>
            <div className="stat-label">FCFA — Solde ouvert du mois</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>📊</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{fcfa(journal.cumulativeHt)}</div>
            <div className="stat-label">FCFA — CA cumulé HT</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>🧾</div>
            <div className="stat-value">{journal.pendingCount}</div>
            <div className="stat-label">Factures en validation</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>📦</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{fcfa(stockValue)}</div>
            <div className="stat-label">FCFA — Valeur du stock</div>
          </div>
          <div className="stat-card red">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>⚠️</div>
            <div className="stat-value">{lowStock.length}</div>
            <div className="stat-label">Produits stock bas</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>👥</div>
            <div className="stat-value">{totalEmployees ?? 0}</div>
            <div className="stat-label">Employés actifs</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>📬</div>
            <div className="stat-value">{pendingRequests ?? 0}</div>
            <div className="stat-label">Demandes en attente</div>
          </div>
        </div>

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4' }}>
            <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.9rem' }}>Journal des ventes</h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>N°</th>
                  <th>Client</th>
                  <th>NIF</th>
                  <th>Statut</th>
                  <th>HT</th>
                  <th>Remise</th>
                  <th>TVA</th>
                  <th>TTC</th>
                  <th>Encaissé</th>
                  <th>Solde</th>
                </tr>
              </thead>
              <tbody>
                {journal.sales.map(row => (
                  <tr key={row.invoiceNumber + row.date}>
                    <td>{frDay(row.date)}</td>
                    <td>{row.invoiceNumber}</td>
                    <td>{row.clientName || '—'}</td>
                    <td>{row.nif || '—'}</td>
                    <td>{row.statusLabel}</td>
                    <td>{fcfa(row.ht)}</td>
                    <td>{fcfa(row.discount)}</td>
                    <td>{fcfa(row.vat)}</td>
                    <td>{fcfa(row.ttc)}</td>
                    <td>{fcfa(row.collected)}</td>
                    <td>{fcfa(row.balance)}</td>
                  </tr>
                ))}
                {journal.sales.length === 0 && (
                  <tr><td colSpan={11} style={{ textAlign: 'center', padding: 32, color: '#999' }}>Aucune facture ce mois</td></tr>
                )}
                {journal.sales.length > 0 && (
                  <tr style={{ fontWeight: 700, background: '#f8f6f2' }}>
                    <td colSpan={5}>Totaux</td>
                    <td>{fcfa(journal.monthHt)}</td>
                    <td></td>
                    <td>{fcfa(journal.monthVat)}</td>
                    <td>{fcfa(journal.monthTtc)}</td>
                    <td></td>
                    <td>{fcfa(journal.monthOutstanding)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4' }}>
            <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.9rem' }}>Journal des encaissements</h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>N° facture</th>
                  <th>Client</th>
                  <th>NIF</th>
                  <th>Mode</th>
                  <th>Référence</th>
                  <th>Montant</th>
                </tr>
              </thead>
              <tbody>
                {journal.receipts.map((row, i) => (
                  <tr key={`${row.invoiceNumber}-${row.date}-${i}`}>
                    <td>{frDay(row.date)}</td>
                    <td>{row.invoiceNumber || '—'}</td>
                    <td>{row.clientName || '—'}</td>
                    <td>{row.nif || '—'}</td>
                    <td>{row.method || '—'}</td>
                    <td>{row.reference || '—'}</td>
                    <td>{fcfa(row.amount)}</td>
                  </tr>
                ))}
                {journal.receipts.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: '#999' }}>Aucun encaissement ce mois</td></tr>
                )}
                {journal.receipts.length > 0 && (
                  <tr style={{ fontWeight: 700, background: '#f8f6f2' }}>
                    <td colSpan={6}>Total</td>
                    <td>{fcfa(journal.monthCollected)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.9rem' }}>
                📒 Grand livre simplifié — Clients & Fournisseurs
              </h3>
              <div style={{ fontSize: '0.75rem', color: '#888', marginTop: 4 }}>
                Auxiliaires 411 (clients) & 401 (fournisseurs) : créances, dettes, encaissements et règlements en FCFA,
                avec solde courant. Les soldes sont recalculés sur la période affichée.
              </div>
            </div>
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(ledgerCsvContent)}`}
              download={ledgerCsvName}
              className="btn-primary"
              style={{ padding: '8px 14px', fontSize: '0.8rem', textDecoration: 'none' }}
            >
              Export grand livre CSV
            </a>
          </div>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0ece4', background: '#fbfaf7' }}>
            <form method="get" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ fontSize: '0.75rem', color: '#666', fontWeight: 600 }}>Périmètre</label>
              <select name="gl-scope" className="hub-input" defaultValue={ledgerScope} style={{ maxWidth: 220 }}>
                <option value="clients">Comptes clients</option>
                <option value="fournisseurs">Comptes fournisseurs</option>
                <option value="tout">Tout (clients + fournisseurs)</option>
              </select>
              <label style={{ fontSize: '0.75rem', color: '#666', fontWeight: 600 }}>Compte</label>
              <select name="gl-compte" className="hub-input" defaultValue={ledgerAccount} style={{ maxWidth: 230 }}>
                <option value="">— Tous les comptes —</option>
                {ledgerScopeAccounts.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.type ? ` (${partyTypeLabel(c.type)})` : ''}
                  </option>
                ))}
              </select>
              <label style={{ fontSize: '0.75rem', color: '#666', fontWeight: 600 }}>Mois</label>
              <select name="gl-month" className="hub-input" defaultValue={ledgerMonth} style={{ maxWidth: 180 }}>
                <option value="">Toutes les périodes</option>
                {ledgerMonthOptions.map(m => (
                  <option key={m} value={m}>{capitalizedMonthLabel(m)}</option>
                ))}
              </select>
              <button type="submit" className="btn-ghost" style={{ padding: '8px 14px', fontSize: '0.8rem' }}>Afficher</button>
            </form>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>N° pièce</th>
                  <th>Compte</th>
                  <th>Libellé</th>
                  <th style={{ textAlign: 'right' }}>Débit</th>
                  <th style={{ textAlign: 'right' }}>Crédit</th>
                  <th style={{ textAlign: 'right' }}>Solde</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((row, i) => (
                  <tr key={`${row.date}-${row.docNumber}-${i}`}>
                    <td>{frDay(row.date)}</td>
                    <td>{row.docNumber}</td>
                    <td>{row.accountName}</td>
                    <td>{row.label}</td>
                    <td style={{ textAlign: 'right' }}>{row.debit ? fcfa(row.debit) : ''}</td>
                    <td style={{ textAlign: 'right' }}>{row.credit ? fcfa(row.credit) : ''}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fcfa(row.balance)}</td>
                  </tr>
                ))}
                {ledgerRows.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: '#999' }}>Aucune écriture pour cette sélection</td></tr>
                )}
                {ledgerRows.length > 0 && (
                  <tr style={{ fontWeight: 700, background: '#f8f6f2' }}>
                    <td colSpan={4}>Totaux ({ledgerRows.length} écritures)</td>
                    <td style={{ textAlign: 'right' }}>{fcfa(ledgerTotal.debit)}</td>
                    <td style={{ textAlign: 'right' }}>{fcfa(ledgerTotal.credit)}</td>
                    <td style={{ textAlign: 'right' }}>{fcfa(ledgerTotal.debit - ledgerTotal.credit)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', background: '#fff7ed' }}>
              <h3 style={{ fontWeight: 700, color: '#92400e', fontSize: '0.9rem' }}>⚠️ Alertes Stock ({lowStock.length})</h3>
            </div>
            {lowStock.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>✅ Tous les stocks sont OK</div>
            ) : (
              <div>
                {lowStock.slice(0, 6).map(p => (
                  <div key={p.id} style={{ padding: '10px 20px', borderBottom: '1px solid #f8f6f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{p.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#92400e' }}>Seuil: {p.threshold_alert} {p.unit}</div>
                    </div>
                    <span className="badge badge-red">{p.quantity} {p.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', background: expiredBatches.length > 0 ? '#fef2f2' : '#fff7ed' }}>
              <h3 style={{ fontWeight: 700, color: expiredBatches.length > 0 ? '#991b1b' : '#92400e', fontSize: '0.9rem' }}>
                🕐 Péremptions — {expiredBatches.length} expirés, {soonExpiring.length} bientôt
              </h3>
            </div>
            {expiredBatches.length === 0 && soonExpiring.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>✅ Aucun lot proche de péremption</div>
            ) : (
              <div>
                {[...expiredBatches.map(b => ({ ...b, expired: true })), ...soonExpiring.map(b => ({ ...b, expired: false }))].slice(0, 6).map(b => {
                  const daysLeft = Math.ceil((new Date(b.expiry_date!).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  return (
                    <div key={b.id} style={{ padding: '10px 20px', borderBottom: '1px solid #f8f6f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{(b.product as any)?.name} — Lot {b.batch_number}</div>
                        <div style={{ fontSize: '0.75rem', color: '#666' }}>Exp: {new Date(b.expiry_date!).toLocaleDateString('fr-FR')} · {b.quantity} unités</div>
                      </div>
                      <span className={`badge ${b.expired ? 'badge-red' : 'badge-amber'}`}>{b.expired ? '❌ Expiré' : `J-${daysLeft}`}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4' }}>
              <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.9rem' }}>📦 Mouvements ce mois</h3>
            </div>
            <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ textAlign: 'center', background: '#ecfdf5', borderRadius: 10, padding: '20px' }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#065f46' }}>+{monthIN.toLocaleString()}</div>
                <div style={{ fontSize: '0.75rem', color: '#065f46', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>Unités entrées</div>
              </div>
              <div style={{ textAlign: 'center', background: '#fef2f2', borderRadius: 10, padding: '20px' }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#991b1b' }}>-{monthOUT.toLocaleString()}</div>
                <div style={{ fontSize: '0.75rem', color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>Unités sorties</div>
              </div>
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4' }}>
              <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.9rem' }}>📄 Documents en attente de validation ({(pendingDocs || []).length})</h3>
            </div>
            {(pendingDocs || []).length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>✅ Aucun document en attente</div>
            ) : (
              <div>
                {(pendingDocs || []).slice(0, 5).map(d => (
                  <div key={d.id} style={{ padding: '10px 20px', borderBottom: '1px solid #f8f6f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{d.title}</div>
                      <div style={{ fontSize: '0.75rem', color: '#666' }}>{d.type} · {new Date(d.created_at).toLocaleDateString('fr-FR')}</div>
                    </div>
                    <span className="badge badge-amber">En attente</span>
                  </div>
                ))}
                {(pendingDocs || []).length > 5 && (
                  <div style={{ padding: '10px 20px', textAlign: 'center', fontSize: '0.8rem', color: '#999' }}>
                    + {(pendingDocs || []).length - 5} autres <a href="/documents" style={{ color: 'var(--hub-green-mid)' }}>→ Voir tous</a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
