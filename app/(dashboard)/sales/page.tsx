'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Sale, Client, Product, ProductBatch, SaleItem } from '@/types'
import { useToast } from '@/components/ui/Toast'

const statusColors: Record<string, string> = {
  draft: 'badge-gray', pending: 'badge-amber', approved: 'badge-green',
  rejected: 'badge-red', cancelled: 'badge-red'
}
const statusLabels: Record<string, string> = {
  draft: 'Brouillon', pending: 'En validation', approved: '✓ Approuvé',
  rejected: 'Rejeté', cancelled: 'Annulé'
}

function generateInvoicePDF(sale: Sale, items: SaleItem[]) {
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0) - (sale.discount || 0)
  const tax = subtotal * (sale.tax_rate || 18) / 100
  const total = subtotal + tax
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Facture ${sale.reference}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0} body{font-family:Georgia,serif;color:#0f1f17;background:#fff;padding:40px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:3px solid #2d6a4f;margin-bottom:28px}
  .logo{font-size:1.6rem;font-weight:800;color:#1a3d2b}.logo .sub{font-size:.7rem;color:#666;letter-spacing:.15em;text-transform:uppercase;font-family:sans-serif;display:block;margin-top:2px}
  .badge{background:#2d6a4f;color:#fff;padding:6px 16px;border-radius:4px;font-family:sans-serif;font-size:.85rem;font-weight:700}
  .ref{color:#666;font-size:.75rem;font-family:sans-serif;text-align:right;margin-top:4px}
  .meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;background:#f8f5ee;padding:18px 20px;border-radius:8px;margin-bottom:24px;font-family:sans-serif}
  .meta-label{font-size:.65rem;text-transform:uppercase;letter-spacing:.1em;color:#888;font-weight:700;margin-bottom:2px}
  .meta-value{font-size:.875rem;color:#1a3d2b;font-weight:600}
  table{width:100%;border-collapse:collapse;font-family:sans-serif;font-size:.875rem;margin-bottom:20px}
  thead tr{background:#1a3d2b;color:#fff}
  th{padding:10px 14px;text-align:left;font-size:.75rem;letter-spacing:.06em;text-transform:uppercase}
  td{padding:10px 14px;border-bottom:1px solid #f0ece4}
  tr:hover td{background:#fafaf7}
  .totals{margin-left:auto;width:280px;font-family:sans-serif}
  .totals .row{display:flex;justify-content:space-between;padding:6px 0;font-size:.875rem;border-bottom:1px solid #f0ece4}
  .totals .total{font-weight:800;font-size:1.1rem;color:#1a3d2b;border-bottom:none;padding-top:10px}
  .footer{margin-top:48px;padding-top:16px;border-top:1px solid #ddd;display:flex;justify-content:space-between;font-size:.72rem;color:#999;font-family:sans-serif}
  .stamp{border:1.5px dashed #ccc;border-radius:8px;padding:18px 24px;display:inline-block;color:#ccc;font-size:.8rem;margin-top:6px;text-align:center}
</style></head><body>
<div class="header">
  <div><div class="logo">🌿 HUB Distribution<span class="sub">Transformation & Distribution Agricole</span></div>
    <div style="margin-top:10px;font-family:sans-serif;font-size:.75rem;color:#666">Brazzaville, République du Congo<br>hub@distribution.cg · +242 06 000 0000</div></div>
  <div style="text-align:right"><div class="badge">🧾 Facture</div><div class="ref">${sale.reference}</div>
    <div class="ref">Émise le ${new Date(sale.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}</div></div>
</div>
<div class="meta">
  <div><div class="meta-label">Client</div><div class="meta-value">${(sale as any).client?.name || '—'}</div></div>
  <div><div class="meta-label">Échéance</div><div class="meta-value">${sale.due_date ? new Date(sale.due_date).toLocaleDateString('fr-FR') : '—'}</div></div>
  <div><div class="meta-label">Statut</div><div class="meta-value">${statusLabels[sale.status]}</div></div>
</div>
<table>
  <thead><tr><th>#</th><th>Désignation</th><th>Qté</th><th>Prix unit.</th><th>Sous-total</th></tr></thead>
  <tbody>
    ${items.map((it, i) => `<tr><td>${i+1}</td><td>${it.description}</td><td>${it.quantity}</td><td>${it.unit_price.toLocaleString()} FCFA</td><td>${it.subtotal.toLocaleString()} FCFA</td></tr>`).join('')}
  </tbody>
</table>
<div class="totals">
  <div class="row"><span>Sous-total HT</span><span>${subtotal.toLocaleString()} FCFA</span></div>
  ${sale.discount ? `<div class="row"><span>Remise</span><span>- ${Number(sale.discount).toLocaleString()} FCFA</span></div>` : ''}
  <div class="row"><span>TVA (${sale.tax_rate}%)</span><span>${tax.toLocaleString('fr-FR',{maximumFractionDigits:0})} FCFA</span></div>
  <div class="row total"><span>TOTAL TTC</span><span>${(total).toLocaleString('fr-FR',{maximumFractionDigits:0})} FCFA</span></div>
</div>
<div style="margin-top:32px;display:flex;justify-content:flex-end">
  <div><div style="font-family:sans-serif;font-size:.75rem;color:#666;margin-bottom:4px">Signature & Cachet</div>
  <div class="stamp">Autorisé<br><br>&nbsp;</div></div>
</div>
${sale.notes ? `<div style="margin-top:20px;padding:12px 16px;background:#f8f5ee;border-radius:8px;font-family:sans-serif;font-size:.8rem;color:#555"><strong>Notes :</strong> ${sale.notes}</div>` : ''}
<div class="footer">
  <div>HUB Distribution — RCCM: BZV-XXXX-XX — NIF: XXXXXXXXXX</div>
  <div>Document généré le ${new Date().toLocaleDateString('fr-FR')}</div>
</div>
</body></html>`
  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 600) }
}

const emptyForm = { client_id: '', notes: '', due_date: '', tax_rate: 18, discount: 0 }

export default function SalesPage() {
  const [sales, setSales] = useState<any[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [batches, setBatches] = useState<ProductBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedSale, setSelectedSale] = useState<any>(null)
  const [saleItems, setSaleItems] = useState<any[]>([])
  const [form, setForm] = useState(emptyForm)
  const [items, setItems] = useState<{product_id:string;batch_id:string;description:string;quantity:number;unit_price:number}[]>([])
  const [saving, setSaving] = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const supabase = createClient()
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('sales').select('*, client:clients(name,email), created_by_profile:profiles!sales_created_by_fkey(full_name)').order('created_at', { ascending: false })
    if (filterStatus !== 'all') q = q.eq('status', filterStatus)
    const [{ data: s }, { data: c }, { data: p }, { data: b }] = await Promise.all([
      q,
      supabase.from('clients').select('*').order('name'),
      supabase.from('products').select('*').order('name'),
      supabase.from('product_batches').select('*, product:products(name,unit)').order('expiry_date'),
    ])
    setSales(s || [])
    setClients(c || [])
    setProducts(p || [])
    setBatches(b || [])
    setLoading(false)
  }, [filterStatus])

  useEffect(() => { load() }, [load])

  async function openSaleDetail(sale: any) {
    setSelectedSale(sale)
    const { data } = await supabase.from('sale_items').select('*, product:products(name,unit)').eq('sale_id', sale.id)
    setSaleItems(data || [])
  }

  function addItem() {
    setItems([...items, { product_id: '', batch_id: '', description: '', quantity: 1, unit_price: 0 }])
  }

  function updateItem(i: number, field: string, val: string | number) {
    const updated = [...items]
    updated[i] = { ...updated[i], [field]: val }
    if (field === 'product_id') {
      const p = products.find(p => p.id === val)
      if (p) { updated[i].description = p.name; updated[i].unit_price = p.price_per_unit || 0 }
    }
    setItems(updated)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (items.length === 0) { toast('warning', 'Ajoutez au moins un article'); return }
    setSaving(true)
    const { data: user } = await supabase.auth.getUser()
    const { data: sale, error } = await supabase.from('sales').insert({ ...form, created_by: user.user?.id, status: 'draft' }).select().single()
    if (!error && sale) {
      await supabase.from('sale_items').insert(items.map(it => ({ ...it, sale_id: sale.id, batch_id: it.batch_id || null })))
    }
    setSaving(false); setShowModal(false)
    setForm(emptyForm); setItems([])
    load()
  }

  async function updateStatus(id: string, status: string) {
    const { data: user } = await supabase.auth.getUser()
    await supabase.from('sales').update({ status, approved_by: user.user?.id, updated_at: new Date().toISOString() }).eq('id', id)
    setSelectedSale(null)
    load()
  }

  const totalRevenue = sales.filter(s => s.status === 'approved').reduce((sum, s) => sum + (s.total_amount || 0) + (s.tax_amount || 0), 0)
  const pending = sales.filter(s => s.status === 'pending').length

  return (
    <div>
      <div className="page-header">
        <h2>💰 Ventes & Facturation</h2>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Nouvelle vente</button>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16, marginBottom: 24 }}>
          <div className="stat-card green">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>💵</div>
            <div className="stat-value" style={{ fontSize: '1.4rem' }}>{totalRevenue.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
            <div className="stat-label">FCFA — Chiffre d'affaires</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>⏳</div>
            <div className="stat-value">{pending}</div>
            <div className="stat-label">En attente de validation</div>
          </div>
          <div className="stat-card blue">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>📄</div>
            <div className="stat-value">{sales.filter(s => s.status === 'approved').length}</div>
            <div className="stat-label">Ventes approuvées</div>
          </div>
        </div>

        {/* Filtres */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {['all','draft','pending','approved','rejected'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
                borderColor: filterStatus === s ? 'var(--hub-green-mid)' : '#ddd',
                background: filterStatus === s ? 'var(--hub-green-mid)' : 'white',
                color: filterStatus === s ? 'white' : '#666' }}>
              {s === 'all' ? 'Toutes' : statusLabels[s]}
            </button>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
            <table className="hub-table">
              <thead><tr><th>Référence</th><th>Client</th><th>Montant HT</th><th>TVA</th><th>Total TTC</th><th>Statut</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>
                {sales.map(s => (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => openSaleDetail(s)}>
                    <td><strong style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{s.reference}</strong></td>
                    <td>{s.client?.name || <span style={{ color: '#999' }}>—</span>}</td>
                    <td>{Number(s.total_amount || 0).toLocaleString()} FCFA</td>
                    <td style={{ color: '#666', fontSize: '0.8rem' }}>{Number(s.tax_amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</td>
                    <td><strong>{(Number(s.total_amount || 0) + Number(s.tax_amount || 0)).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</strong></td>
                    <td><span className={`badge ${statusColors[s.status]}`}>{statusLabels[s.status]}</span></td>
                    <td style={{ fontSize: '0.8rem', color: '#666' }}>{new Date(s.created_at).toLocaleDateString('fr-FR')}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-primary" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => { openSaleDetail(s) }}>Voir</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {sales.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#999' }}>Aucune vente</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal Détail / Workflow */}
      {selectedSale && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setSelectedSale(null)}>
          <div className="modal-box" style={{ maxWidth: 680 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid var(--hub-amber)' }}>
              <div>
                <div className="modal-title" style={{ margin: 0, border: 'none', padding: 0 }}>🧾 {selectedSale.reference}</div>
                <span className={`badge ${statusColors[selectedSale.status]}`}>{statusLabels[selectedSale.status]}</span>
              </div>
              <button className="btn-primary" style={{ padding: '8px 14px', fontSize: '0.8rem' }} onClick={() => generateInvoicePDF(selectedSale, saleItems)}>🖨️ PDF</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, background: '#f8f5ee', padding: '12px 16px', borderRadius: 8 }}>
              <div><div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Client</div>
                <div style={{ fontWeight: 600 }}>{selectedSale.client?.name || '—'}</div></div>
              <div><div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Créé par</div>
                <div style={{ fontWeight: 600 }}>{selectedSale.created_by_profile?.full_name || '—'}</div></div>
              <div><div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Date</div>
                <div>{new Date(selectedSale.created_at).toLocaleDateString('fr-FR')}</div></div>
              <div><div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Échéance</div>
                <div>{selectedSale.due_date ? new Date(selectedSale.due_date).toLocaleDateString('fr-FR') : '—'}</div></div>
            </div>

            {/* Items */}
            <table className="hub-table" style={{ marginBottom: 16 }}>
              <thead><tr><th>Article</th><th>Qté</th><th>Prix unit.</th><th>Sous-total</th></tr></thead>
              <tbody>
                {saleItems.map(it => (
                  <tr key={it.id}>
                    <td>{it.description}<div style={{ fontSize: '0.72rem', color: '#999' }}>{it.product?.name}</div></td>
                    <td>{it.quantity}</td>
                    <td>{Number(it.unit_price).toLocaleString()} FCFA</td>
                    <td><strong>{Number(it.subtotal).toLocaleString()} FCFA</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totaux */}
            <div style={{ marginLeft: 'auto', width: 260, marginBottom: 20 }}>
              {[
                ['Sous-total HT', `${Number(selectedSale.total_amount || 0).toLocaleString()} FCFA`],
                [`TVA (${selectedSale.tax_rate}%)`, `${Number(selectedSale.tax_amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`],
                ['Total TTC', `${(Number(selectedSale.total_amount || 0) + Number(selectedSale.tax_amount || 0)).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`],
              ].map(([label, val], i) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < 2 ? '1px solid #f0ece4' : 'none', fontWeight: i === 2 ? 700 : 400, fontSize: i === 2 ? '1rem' : '0.875rem' }}>
                  <span>{label}</span><span style={{ color: 'var(--hub-green)' }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Actions workflow */}
            {selectedSale.notes && <div style={{ padding: '10px 14px', background: '#f8f5ee', borderRadius: 8, fontSize: '0.8rem', color: '#555', marginBottom: 16 }}>💬 {selectedSale.notes}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn-ghost" onClick={() => setSelectedSale(null)}>Fermer</button>
              {selectedSale.status === 'draft' && (
                <button className="btn-amber" onClick={() => updateStatus(selectedSale.id, 'pending')}>📤 Soumettre pour validation</button>
              )}
              {selectedSale.status === 'pending' && (
                <>
                  <button className="btn-danger" style={{ background: '#fee2e2', color: '#dc2626' }} onClick={() => updateStatus(selectedSale.id, 'rejected')}>❌ Rejeter</button>
                  <button className="btn-primary" onClick={() => updateStatus(selectedSale.id, 'approved')}>✅ Approuver — Décrémente stock</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Création */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 700 }}>
            <div className="modal-title">➕ Nouvelle vente / Facture</div>
            <form onSubmit={handleCreate}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div className="hub-form-group">
                  <label>Client</label>
                  <select className="hub-select" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                    <option value="">-- Sélectionner --</option>
                    {clients.filter(c => c.type === 'client').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Date d'échéance</label>
                  <input className="hub-input" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>TVA (%)</label>
                  <input className="hub-input" type="number" min={0} max={100} value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: Number(e.target.value) })} />
                </div>
                <div className="hub-form-group">
                  <label>Remise (FCFA)</label>
                  <input className="hub-input" type="number" min={0} value={form.discount} onChange={e => setForm({ ...form, discount: Number(e.target.value) })} />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Notes</label>
                  <textarea className="hub-input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ resize: 'vertical' }} />
                </div>
              </div>

              {/* Lignes articles */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--hub-green)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Articles</label>
                  <button type="button" className="btn-ghost" style={{ padding: '5px 12px', fontSize: '0.78rem' }} onClick={addItem}>+ Ajouter ligne</button>
                </div>
                {items.map((item, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'flex-end' }}>
                    <div>
                      <select className="hub-select" style={{ fontSize: '0.8rem' }} value={item.product_id} onChange={e => updateItem(i, 'product_id', e.target.value)}>
                        <option value="">-- Produit --</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name} (stock: {p.quantity} {p.unit})</option>)}
                      </select>
                    </div>
                    <div>
                      <input className="hub-input" style={{ fontSize: '0.8rem' }} placeholder="Désignation" value={item.description} onChange={e => updateItem(i, 'description', e.target.value)} />
                    </div>
                    <div>
                      <input className="hub-input" style={{ fontSize: '0.8rem' }} type="number" min={1} placeholder="Qté" value={item.quantity} onChange={e => updateItem(i, 'quantity', Number(e.target.value))} />
                    </div>
                    <div>
                      <input className="hub-input" style={{ fontSize: '0.8rem' }} type="number" min={0} placeholder="Prix" value={item.unit_price} onChange={e => updateItem(i, 'unit_price', Number(e.target.value))} />
                    </div>
                    <button type="button" className="btn-danger" style={{ padding: '8px 10px' }} onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                {items.length === 0 && <div style={{ textAlign: 'center', padding: '16px', color: '#999', fontSize: '0.875rem', background: '#f8f5ee', borderRadius: 8 }}>Aucun article — cliquez "+ Ajouter ligne"</div>}

                {items.length > 0 && (
                  <div style={{ textAlign: 'right', fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.95rem', marginTop: 8 }}>
                    Total HT : {(items.reduce((s, it) => s + it.quantity * it.unit_price, 0) - form.discount).toLocaleString()} FCFA
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Création...' : '💾 Créer la vente'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
