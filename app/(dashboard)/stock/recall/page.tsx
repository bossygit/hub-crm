'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { buildLotRecall, type LotDispatch, type LotRecall } from '@/lib/stock/traceability'
import { QUALITY_LABELS } from '@/lib/quality/release'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon',
  pending: 'En attente',
  approved: 'Validé',
  partial: 'Partiel',
  paid: 'Payée',
  cancelled: 'Annulée',
  rejected: 'Rejeté',
}

type BatchRow = {
  id: string
  batch_number: string
  quantity: number
  expiry_date?: string | null
  production_date?: string | null
  supplier?: string | null
  quality_status?: string | null
  product?: { name?: string; unit?: string } | { name?: string; unit?: string }[] | null
}

type MovementRow = {
  id: string
  type: 'IN' | 'OUT' | 'ADJUST'
  quantity: number
  reason?: string | null
  created_at: string
  reference_type?: string | null
}

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function productOf(batch: BatchRow) {
  return asOne(batch.product)
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('fr-FR')
}

export default function LotRecallPage() {
  const searchParams = useSearchParams()
  const initialId = searchParams.get('id') || ''
  const supabase = createClient()

  const [batches, setBatches] = useState<BatchRow[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(initialId)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingRecall, setLoadingRecall] = useState(false)
  const [recall, setRecall] = useState<LotRecall | null>(null)
  const [remainingQty, setRemainingQty] = useState<number | null>(null)
  const [unit, setUnit] = useState('')
  const [movements, setMovements] = useState<MovementRow[]>([])
  const [error, setError] = useState('')

  const loadBatches = useCallback(async () => {
    setLoadingList(true)
    const { data } = await supabase
      .from('product_batches')
      .select('id, batch_number, quantity, expiry_date, production_date, supplier, quality_status, product:products(name, unit)')
      .order('expiry_date', { ascending: true })
    setBatches((data as BatchRow[]) || [])
    setLoadingList(false)
  }, [])

  useEffect(() => { loadBatches() }, [loadBatches])

  const filteredBatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return batches
    return batches.filter(b => {
      const name = productOf(b)?.name || ''
      return b.batch_number.toLowerCase().includes(q) || name.toLowerCase().includes(q)
    })
  }, [batches, query])

  const loadRecall = useCallback(async (batchId: string) => {
    if (!batchId) {
      setRecall(null)
      setMovements([])
      setRemainingQty(null)
      return
    }
    setLoadingRecall(true)
    setError('')
    const [{ data: batch }, { data: invItems }, { data: docItems }, { data: movs }] = await Promise.all([
      supabase
        .from('product_batches')
        .select('id, batch_number, quantity, expiry_date, production_date, quality_status, product:products(name, unit)')
        .eq('id', batchId)
        .single(),
      supabase
        .from('invoice_items')
        .select('quantity, invoice:invoices(id, invoice_number, date, status, client_id, client:clients(id, name))')
        .eq('batch_id', batchId),
      supabase
        .from('document_items')
        .select('quantity, document:documents(id, document_number, reference, type, status, created_at, client_id, client:clients(id, name))')
        .eq('batch_id', batchId),
      supabase
        .from('stock_movements')
        .select('id, type, quantity, reason, created_at, reference_type')
        .eq('batch_id', batchId)
        .order('created_at', { ascending: true }),
    ])

    if (!batch) {
      setError('Lot introuvable.')
      setRecall(null)
      setLoadingRecall(false)
      return
    }

    const product = asOne((batch as BatchRow).product)
    const dispatches: LotDispatch[] = []

    for (const row of invItems || []) {
      const invoice = asOne((row as any).invoice)
      if (!invoice) continue
      const client = asOne(invoice.client)
      dispatches.push({
        source: 'invoice',
        document_id: invoice.id,
        document_number: invoice.invoice_number,
        date: invoice.date,
        status: invoice.status,
        client_id: invoice.client_id || client?.id || null,
        client_name: client?.name || null,
        quantity: Number(row.quantity) || 0,
      })
    }

    for (const row of docItems || []) {
      const doc = asOne((row as any).document)
      if (!doc || doc.type !== 'bon_livraison') continue
      const client = asOne(doc.client)
      dispatches.push({
        source: 'delivery_note',
        document_id: doc.id,
        document_number: doc.document_number || doc.reference,
        date: doc.created_at,
        status: doc.status,
        client_id: doc.client_id || client?.id || null,
        client_name: client?.name || null,
        quantity: Number(row.quantity) || 0,
      })
    }

    setRecall(buildLotRecall({
      batch_id: batch.id,
      batch_number: batch.batch_number,
      product_name: product?.name || 'Produit',
      expiry_date: batch.expiry_date,
      production_date: batch.production_date,
    }, dispatches))
    setRemainingQty(Number(batch.quantity) || 0)
    setUnit(product?.unit || '')
    setMovements((movs as MovementRow[]) || [])
    setLoadingRecall(false)
  }, [])

  useEffect(() => {
    if (selectedId) loadRecall(selectedId)
  }, [selectedId, loadRecall])

  function selectLot(id: string) {
    setSelectedId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('id', id)
    window.history.replaceState({}, '', url.pathname + '?' + url.searchParams.toString())
  }

  function printRecall() {
    if (!recall) return
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rappel lot ${recall.batch_number}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a}
@page{margin:15mm 18mm;size:A4}
.header{display:flex;justify-content:space-between;padding:24px 32px 20px;background:#7f1d1d;color:white}
.company-name{font-size:1.4rem;font-weight:800;font-family:Georgia,serif}
.company-sub{font-size:0.7rem;opacity:0.65;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px}
.body{padding:28px 32px}h2{font-size:1rem;margin:24px 0 10px;color:#7f1d1d}
table{width:100%;border-collapse:collapse;font-size:0.85rem}
th{text-align:left;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:#888;border-bottom:2px solid #e8e4db;padding:8px 6px}
td{padding:8px 6px;border-bottom:1px solid #f0ece4}
.meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:8px}
.box{background:#f8f5ee;padding:12px 14px;border-radius:8px}
.label{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:4px}
.footer{padding:12px 32px;background:#0f1f17;color:rgba(255,255,255,0.5);font-size:0.7rem;display:flex;justify-content:space-between}
</style></head><body>
<div class="header"><div><div class="company-name">HUB Distribution</div><div class="company-sub">Rappel sanitaire / traçabilité lot</div></div>
<div style="text-align:right;font-family:monospace;font-size:1.1rem">${recall.batch_number}</div></div>
<div class="body">
<div class="meta">
<div class="box"><div class="label">Produit</div><div>${recall.product_name}</div></div>
<div class="box"><div class="label">Production</div><div>${formatDate(recall.production_date)}</div></div>
<div class="box"><div class="label">Péremption</div><div>${formatDate(recall.expiry_date)}</div></div>
</div>
<p style="margin:16px 0;font-size:0.9rem">${recall.clientCount} client(s) · ${recall.totalQuantity} ${unit} expédié(s) (factures et BL hors brouillon / annulé)</p>
<h2>Clients concernés</h2>
<table><thead><tr><th>Client</th><th>Quantité</th><th>Documents</th></tr></thead><tbody>
${recall.clients.map(c => `<tr><td>${c.client_name}</td><td>${c.quantity} ${unit}</td><td>${c.documents.map(d => d.document_number).join(', ')}</td></tr>`).join('')}
</tbody></table>
<h2>Généalogie des documents</h2>
<table><thead><tr><th>Date</th><th>Type</th><th>N°</th><th>Client</th><th>Qté</th></tr></thead><tbody>
${recall.clients.flatMap(c => c.documents).map(d => `<tr><td>${formatDate(d.date)}</td><td>${d.source === 'invoice' ? 'Facture' : 'BL'}</td><td>${d.document_number}</td><td>${d.client_name || '—'}</td><td>${d.quantity} ${unit}</td></tr>`).join('')}
</tbody></table>
</div>
<div class="footer"><span>HUB Distribution — Brazzaville, Congo</span><span>Imprimé le ${new Date().toLocaleDateString('fr-FR')}</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 800) }
  }

  return (
    <div>
      <div className="page-header">
        <h2>🔎 Traçabilité des lots</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/stock" className="btn-ghost" style={{ textDecoration: 'none' }}>← Stock</Link>
          {recall && <button className="btn-primary" onClick={printRecall}>Imprimer le rappel</button>}
        </div>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <p style={{ color: '#666', marginBottom: 16, maxWidth: 720, fontSize: '0.9rem' }}>
          Recherchez un lot pour voir quels clients l&apos;ont reçu (factures et bons de livraison).
          Les brouillons, rejets et annulations sont exclus.
        </p>

        <input
          className="hub-input"
          style={{ maxWidth: 420, marginBottom: 16 }}
          placeholder="🔍 N° de lot ou produit…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />

        {loadingList ? (
          <div style={{ color: '#999' }}>Chargement des lots…</div>
        ) : (
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden', marginBottom: 24 }}>
            <table className="hub-table">
              <thead>
                <tr><th>N° lot</th><th>Produit</th><th>Reste</th><th>Qualité</th><th>Péremption</th><th></th></tr>
              </thead>
              <tbody>
                {filteredBatches.slice(0, 40).map(b => {
                  const product = productOf(b)
                  const selected = b.id === selectedId
                  return (
                    <tr key={b.id} style={{ background: selected ? '#ecfdf5' : undefined }}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{b.batch_number}</td>
                      <td>{product?.name || '—'}</td>
                      <td>{b.quantity} {product?.unit || ''}</td>
                      <td>
                        {(() => {
                          const q = QUALITY_LABELS[b.quality_status || 'released']
                          return <span className={`badge ${q.badge}`}>{q.icon} {q.label}</span>
                        })()}
                      </td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{formatDate(b.expiry_date)}</td>
                      <td>
                        <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => selectLot(b.id)}>
                          {selected ? 'Sélectionné' : 'Rappel'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {filteredBatches.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#999' }}>Aucun lot ne correspond</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        {loadingRecall && selectedId && <div style={{ color: '#999' }}>Analyse du lot…</div>}

        {recall && !loadingRecall && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16, marginBottom: 24 }}>
              <div className="stat-card">
                <div className="stat-value" style={{ fontSize: '1.1rem' }}>{recall.batch_number}</div>
                <div className="stat-label">{recall.product_name}</div>
              </div>
              <div className="stat-card green">
                <div className="stat-value">{recall.clientCount}</div>
                <div className="stat-label">Client(s) concernés</div>
              </div>
              <div className="stat-card amber">
                <div className="stat-value">{recall.totalQuantity} {unit}</div>
                <div className="stat-label">Quantité sur documents expédiés</div>
              </div>
              <div className="stat-card blue">
                <div className="stat-value">{remainingQty ?? '—'} {unit}</div>
                <div className="stat-label">Reste en stock</div>
              </div>
              {(() => {
                const selected = batches.find(b => b.id === selectedId)
                const q = QUALITY_LABELS[selected?.quality_status || 'released']
                return (
                  <div className="stat-card">
                    <div className="stat-value" style={{ fontSize: '1.1rem' }}>{q.icon} {q.label}</div>
                    <div className="stat-label">Statut qualité</div>
                  </div>
                )
              })()}
            </div>

            <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: 20 }}>
              Production {formatDate(recall.production_date)} · Péremption {formatDate(recall.expiry_date)}
            </div>

            <h3 style={{ marginBottom: 12, color: 'var(--hub-green)' }}>Clients concernés</h3>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden', marginBottom: 28 }}>
              <table className="hub-table">
                <thead>
                  <tr><th>Client</th><th>Quantité</th><th>Documents</th></tr>
                </thead>
                <tbody>
                  {recall.clients.map(c => (
                    <tr key={c.client_id || c.client_name}>
                      <td style={{ fontWeight: 600 }}>{c.client_name}</td>
                      <td style={{ fontWeight: 700 }}>{c.quantity} {unit}</td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {c.documents.map((d, i) => (
                          <span key={d.document_id}>
                            {i > 0 && ' · '}
                            <Link href={d.source === 'invoice' ? `/invoices/${d.document_id}` : `/delivery-notes/${d.document_id}`}>
                              {d.document_number}
                            </Link>
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {recall.clients.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                      Aucune facture ni BL expédié pour ce lot
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <h3 style={{ marginBottom: 12, color: 'var(--hub-green)' }}>Généalogie des documents</h3>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden', marginBottom: 28 }}>
              <table className="hub-table">
                <thead>
                  <tr><th>Date</th><th>Type</th><th>N°</th><th>Statut</th><th>Client</th><th>Qté</th></tr>
                </thead>
                <tbody>
                  {recall.clients.flatMap(c => c.documents).sort((a, b) => a.date.localeCompare(b.date)).map(d => (
                    <tr key={`${d.source}-${d.document_id}`}>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{formatDate(d.date)}</td>
                      <td>{d.source === 'invoice' ? 'Facture' : 'Bon de livraison'}</td>
                      <td>
                        <Link href={d.source === 'invoice' ? `/invoices/${d.document_id}` : `/delivery-notes/${d.document_id}`}>
                          {d.document_number}
                        </Link>
                      </td>
                      <td>{STATUS_LABEL[d.status] || d.status}</td>
                      <td>{d.client_name || '—'}</td>
                      <td style={{ fontWeight: 700 }}>{d.quantity} {unit}</td>
                    </tr>
                  ))}
                  {recall.clients.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#999' }}>Pas encore de généalogie commerciale</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <h3 style={{ marginBottom: 12, color: 'var(--hub-green)' }}>Mouvements de stock du lot</h3>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <table className="hub-table">
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Quantité</th><th>Motif</th></tr>
                </thead>
                <tbody>
                  {movements.map(m => (
                    <tr key={m.id}>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{formatDate(m.created_at)}</td>
                      <td>
                        <span className={`badge ${m.type === 'IN' ? 'badge-green' : m.type === 'OUT' ? 'badge-red' : 'badge-blue'}`}>
                          {m.type === 'IN' ? '↑ Entrée' : m.type === 'OUT' ? '↓ Sortie' : '⟳ Ajust.'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700, color: m.type === 'IN' ? '#065f46' : m.type === 'OUT' ? '#991b1b' : '#1e40af' }}>
                        {m.type === 'IN' ? '+' : m.type === 'OUT' ? '-' : ''}{m.quantity} {unit}
                      </td>
                      <td style={{ color: '#666', fontSize: '0.85rem' }}>{m.reason || m.reference_type || '—'}</td>
                    </tr>
                  ))}
                  {movements.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: '#999' }}>Aucun mouvement enregistré sur ce lot</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
