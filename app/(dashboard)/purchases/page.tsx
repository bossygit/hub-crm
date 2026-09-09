'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import {
  PAYMENT_STATUS_CONFIG,
  computePaymentStatus,
  formatFCFA,
  paidByPurchase,
  supplierBalances,
  type PurchasePayment,
  type SupplierBalance,
} from '@/lib/purchases/payments'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray', icon: '✏️' },
  pending: { label: 'Commandé', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Réceptionné', badge: 'badge-green', icon: '✅' },
  cancelled: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

function rowsOf(res: unknown): any[] {
  if (Array.isArray(res)) return res
  if (res && typeof res === 'object' && Array.isArray((res as { data?: unknown }).data)) return (res as { data: unknown[] }).data
  return []
}

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<any[]>([])
  const [payments, setPayments] = useState<PurchasePayment[]>([])
  const [balances, setBalances] = useState<SupplierBalance[]>([])
  const [summary, setSummary] = useState({ total: 0, draft: 0, pending: 0, approved: 0, amount: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('purchases').select('*, supplier:clients(id,name)').order('created_at', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    const [res, payRes, allRes] = await Promise.all([
      q,
      supabase.from('purchase_payments').select('purchase_id, amount'),
      supabase.from('purchases').select('id, supplier_id, status, subtotal, supplier:clients(name)'),
    ])
    const list = rowsOf(res)
    const payList = rowsOf(payRes) as PurchasePayment[]
    const allPurchases = rowsOf(allRes)
    setPurchases(list)
    setPayments(payList)
    setSummary({
      total: list.length,
      draft: list.filter(d => d.status === 'draft').length,
      pending: list.filter(d => d.status === 'pending').length,
      approved: list.filter(d => d.status === 'approved').length,
      amount: list.filter(d => d.status === 'approved').reduce((s, d) => s + Number(d.subtotal || 0), 0),
    })

    // Soldes fournisseurs : préfère le snapshot SQL (si le SQL a été appliqué),
    // sinon agrégation locale équivalente (mêmes règles : hors brouillon/annulé).
    const paidMap = paidByPurchase(payList)
    const localBalances = supplierBalances(allPurchases.map((r: any) => ({
      supplier_id: r.supplier_id,
      supplier_name: r.supplier?.name,
      status: r.status,
      total: Number(r.subtotal || 0),
      paid: paidMap.get(r.id) || 0,
    })))
    const { data: snap, error: snapError } = await supabase.rpc('supplier_balance_snapshot')
    setBalances((!snapError && Array.isArray(snap) ? snap : localBalances) as SupplierBalance[])
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const filtered = purchases.filter(p => {
    const s = search.toLowerCase()
    return !s || p.purchase_number?.toLowerCase().includes(s) || p.supplier?.name?.toLowerCase().includes(s)
  })

  const paidMap = paidByPurchase(payments)

  return (
    <div className="invoice-page invoice-page--list">
      <div className="page-header">
        <h2>🛒 Achats & réception</h2>
        <Link href="/purchases/new" className="btn-primary" style={{ textDecoration: 'none' }}>+ Nouvelle réception</Link>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '18px 20px', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              📋 Soldes fournisseurs
            </div>
            <div style={{ fontSize: '0.75rem', color: '#888' }}>Achats commandés et réceptionnés (hors brouillons et annulés)</div>
          </div>
          {balances.length === 0 ? (
            <div style={{ color: '#999', fontSize: '0.85rem', padding: '6px 0' }}>
              Aucune dette en cours — tous les achats commandés ou réceptionnés sont réglés. 🎉
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {balances.map(b => {
                const due = b.balance > 0
                return (
                  <div key={b.supplier_id}
                    style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', borderRadius: 10,
                      background: due ? '#fffbeb' : '#ecfdf5', border: due ? '1px solid #fde68a' : '1px solid #a7f3d0' }}>
                    <div style={{ minWidth: 170, flex: 1 }}>
                      <div style={{ fontWeight: 700, color: 'var(--hub-green)' }}>{b.supplier_name}</div>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>
                      Dû <strong style={{ color: '#333' }}>{formatFCFA(b.total_purchases)}</strong>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>
                      Payé <strong style={{ color: '#065f46' }}>{formatFCFA(b.total_paid)}</strong>
                    </div>
                    <div style={{ fontSize: '0.85rem', minWidth: 150 }}>
                      Solde <strong style={{ color: due ? '#92400e' : '#065f46', fontWeight: 800 }}>{formatFCFA(b.balance)}</strong>
                    </div>
                    <span className={`badge ${due ? 'badge-red' : 'badge-green'}`} style={{ fontSize: '0.7rem' }}>
                      {due ? '🔴 À payer' : '✅ Soldé'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 14, marginBottom: 28 }}>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>🛒</div><div className="stat-value">{summary.total}</div><div className="stat-label">Total achats</div></div>
          <div className="stat-card green"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>✅</div><div className="stat-value">{summary.approved}</div><div className="stat-label">Réceptionnés</div></div>
          <div className="stat-card amber"><div style={{ fontSize: '1.1rem', marginBottom: 4 }}>⏳</div><div className="stat-value">{summary.pending}</div><div className="stat-label">Commandés</div></div>
          <div className="stat-card"><div className="stat-value" style={{ fontSize: '1.15rem' }}>{summary.amount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div><div className="stat-label">FCFA réceptionnés</div></div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, maxWidth: 320 }}>
            <input className="hub-input" placeholder="🔍 N° achat, fournisseur..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 0, background: '#f0ece4', borderRadius: 8, padding: 3 }}>
            {[{ key: 'all', label: 'Tous' }, { key: 'draft', label: '✏️ Brouillon' }, { key: 'pending', label: '⏳ Commandé' }, { key: 'approved', label: '✅ Réceptionné' }].map(f => (
              <button key={f.key} type="button" onClick={() => setStatusFilter(f.key)}
                style={{ padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
                  background: statusFilter === f.key ? 'white' : 'transparent', color: statusFilter === f.key ? 'var(--hub-green)' : '#666',
                  boxShadow: statusFilter === f.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
            <table className="hub-table">
              <thead><tr><th>N° achat</th><th>Fournisseur</th><th>Date</th><th>Montant HT</th><th>Statut</th><th>Paiement</th><th></th></tr></thead>
              <tbody>
                {filtered.map(p => {
                  const cfg = statusConfig[p.status] || statusConfig.draft
                  const paid = paidMap.get(p.id) || 0
                  const showPay = p.status === 'pending' || p.status === 'approved'
                  const payCfg = showPay ? PAYMENT_STATUS_CONFIG[computePaymentStatus(Number(p.subtotal || 0), paid)] : null
                  return (
                    <tr key={p.id}>
                      <td><Link href={`/purchases/${p.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--hub-green-mid)', textDecoration: 'none' }}>{p.purchase_number}</Link></td>
                      <td style={{ fontWeight: 600 }}>{p.supplier?.name || '—'}</td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{p.date ? new Date(p.date).toLocaleDateString('fr-FR') : '—'}</td>
                      <td>{Number(p.subtotal || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
                      <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                      <td>
                        {payCfg ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span className={`badge ${payCfg.badge}`} style={{ fontSize: '0.7rem' }}>{payCfg.icon} {payCfg.label}</span>
                            <span style={{ fontSize: '0.72rem', color: paid > 0 ? '#065f46' : '#aaa' }}>Payé {paid.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span>
                          </div>
                        ) : (
                          <span style={{ color: '#ccc' }}>—</span>
                        )}
                      </td>
                      <td><Link href={`/purchases/${p.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>Voir</Link></td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 48, color: '#999' }}>{search ? 'Aucun résultat' : 'Aucun achat — réceptionnez des matières premières'}</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
