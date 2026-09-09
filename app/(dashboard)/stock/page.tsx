'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { isLotUsable, isLotReleased, QUALITY_LABELS } from '@/lib/quality/release'
import { validateTransfer, stockByWarehouse, totalsByWarehouse, summarizeWarehouses } from '@/lib/stock/warehouses'

const categories = ['Céréales transformées','Huiles & graisses','Légumineuses','Boissons','Légumes transformés','Viandes & poissons','Autres']
const units = ['kg','g','L','ml','carton','sac','tonne','pièce']
const emptyProduct = { name:'', category:'Céréales transformées', quantity:0, unit:'kg', threshold_alert:10, price_per_unit:0, description:'' }
const emptyBatch = { batch_number:'', quantity:0, expiry_date:'', production_date:'', supplier:'', cost_per_unit:0, notes:'', warehouse_id:'' }
const emptyTransfer = { product_id:'', batch_id:'', to_warehouse_id:'', qty:0 }

type TransferInfo = { ok: boolean; msg: string }

export default function StockPage() {
  const [products, setProducts] = useState<any[]>([])
  const [batches, setBatches] = useState<any[]>([])
  const [movements, setMovements] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'products'|'batches'|'movements'>('products')
  const [whFilter, setWhFilter] = useState('all')
  const [whProductFilter, setWhProductFilter] = useState('all')
  const [showProductModal, setShowProductModal] = useState(false)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [showMovModal, setShowMovModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [selectedProductId, setSelectedProductId] = useState('')
  const [productForm, setProductForm] = useState(emptyProduct)
  const [batchForm, setBatchForm] = useState(emptyBatch)
  const [movType, setMovType] = useState<'IN'|'OUT'>('IN')
  const [movForm, setMovForm] = useState({ product_id:'', batch_id:'', quantity:0, reason:'', date:new Date().toISOString().split('T')[0], warehouse_id:'' })
  const [transferForm, setTransferForm] = useState(emptyTransfer)
  const [saving, setSaving] = useState(false)
  const [productPacks, setProductPacks] = useState<{ unit: string; factor: number }[]>([])
  const [transferInfo, setTransferInfo] = useState<TransferInfo | null>(null)
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: p }, { data: b }, { data: m }, { data: w }] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('product_batches').select('*, product:products(name,unit)').order('expiry_date'),
      supabase.from('stock_movements').select('*, product:products(name,unit), batch:product_batches(batch_number)').order('created_at',{ascending:false}).limit(60),
      supabase.from('warehouses').select('*').order('name'),
    ])
    setProducts(p||[]); setBatches(b||[]); setMovements(m||[]); setWarehouses(w||[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const defaultWh = warehouses.find((w: any) => (w.code || '').toUpperCase() === 'PRINCIPAL') || warehouses[0] || null

  // Helpers entrepôt
  const whIdOf = (id?: string | null) => id || defaultWh?.id || null
  const whNameOf = (id?: string | null) => {
    const wid = whIdOf(id)
    if (!wid) return '—'
    return warehouses.find((w: any) => w.id === wid)?.name || '—'
  }
  const whOf = (id?: string | null) => {
    const wid = whIdOf(id)
    return wid ? warehouses.find((w: any) => w.id === wid) : null
  }

  // Résumé multi-entrepôt
  const whSummary = summarizeWarehouses(
    warehouses.map((w: any) => ({ id: w.id, name: w.name, code: w.code, location: w.location, is_cold: w.is_cold, notes: w.notes })),
    batches,
    defaultWh?.id,
  )
  const stockRows = stockByWarehouse(batches, warehouses.map((w: any) => ({ id: w.id, name: w.name })), defaultWh?.id)
  const filteredStockRows = whProductFilter === 'all' ? stockRows : stockRows.filter(r => r.product_id === whProductFilter)
  const warehouseTotals = totalsByWarehouse(filteredStockRows)

  async function saveProduct(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    let productId = editingProduct?.id
    if (editingProduct) await supabase.from('products').update(productForm).eq('id', editingProduct.id)
    else {
      const { data } = await supabase.from('products').insert(productForm).select('id').single()
      productId = data?.id
    }
    if (productId) {
      await supabase.from('product_units').delete().eq('product_id', productId)
      const validPacks = productPacks.filter(p => p.unit.trim() && Number(p.factor) > 0 && p.unit !== productForm.unit)
      if (validPacks.length > 0) {
        await supabase.from('product_units').insert(validPacks.map(p => ({
          product_id: productId, unit: p.unit.trim(), factor: Number(p.factor),
        })))
      }
    }
    setSaving(false); setShowProductModal(false); setProductPacks([]); load()
  }

  async function saveBatch(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const warehouseId = batchForm.warehouse_id || defaultWh?.id || null
    await supabase.from('product_batches').insert({
      ...batchForm, product_id: selectedProductId, warehouse_id: warehouseId,
      expiry_date: batchForm.expiry_date || null,
      production_date: batchForm.production_date || null
    })
    await supabase.from('stock_movements').insert({
      product_id: selectedProductId, type: 'IN', warehouse_id: warehouseId,
      quantity: batchForm.quantity, reason: `Réception lot ${batchForm.batch_number}`
    })
    setSaving(false); setShowBatchModal(false); setBatchForm(emptyBatch); load()
  }

  async function saveMov(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await supabase.from('stock_movements').insert({
      ...movForm, type: movType,
      batch_id: movForm.batch_id || null,
      warehouse_id: movForm.warehouse_id || null
    })
    setSaving(false); setShowMovModal(false)
    setMovForm({ product_id:'', batch_id:'', quantity:0, reason:'', date:new Date().toISOString().split('T')[0], warehouse_id:'' })
    load()
  }

  async function doTransfer(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setTransferInfo(null)
    const batch = batches.find((b: any) => b.id === transferForm.batch_id)
    const qty = Number(transferForm.qty) || 0
    if (!batch) {
      setTransferInfo({ ok: false, msg: 'Sélectionnez le lot source à transférer.' })
      setSaving(false); return
    }
    const err = validateTransfer({
      availableQty: Number(batch.quantity),
      qty,
      released: isLotReleased(batch.quality_status),
    })
    if (err) { setTransferInfo({ ok: false, msg: err }); setSaving(false); return }
    const { data: user } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('transfer_batch', {
      p_batch_id: batch.id,
      p_to_warehouse_id: transferForm.to_warehouse_id,
      p_qty: qty,
      p_user: user.user?.id || null,
    })
    setSaving(false)
    if (error) { setTransferInfo({ ok: false, msg: error.message }); return }
    const res = (data || {}) as { success?: boolean; message?: string }
    if (res.success) {
      setTransferInfo({ ok: true, msg: res.message || 'Transfert effectué.' })
      setShowTransferModal(false); setTransferForm(emptyTransfer); load()
    } else {
      setTransferInfo({ ok: false, msg: res.message || 'Transfert impossible.' })
    }
  }

  const today = new Date().toISOString().split('T')[0]
  const lowStock = products.filter(p => p.quantity <= p.threshold_alert)
  const expiredBatches = batches.filter(b => b.expiry_date && b.expiry_date < today && b.quantity > 0)
  const soonExp = batches.filter(b => {
    if (!b.expiry_date || b.quantity <= 0) return false
    const diff = (new Date(b.expiry_date).getTime() - Date.now()) / (1000*60*60*24)
    return diff >= 0 && diff <= 30
  })
  const productBatches = batches.filter(b =>
    b.product_id === movForm.product_id && (movType === 'OUT' ? isLotUsable(b) : b.quantity > 0)
  )

  // Lots affichés dans l'onglet Lots (filtre entrepôt)
  const filteredBatches = whFilter === 'all'
    ? batches
    : batches.filter((b: any) => whIdOf(b.warehouse_id) === whFilter)

  // Lots transférables : libérés par la qualité, quantité > 0, rattachés à un entrepôt
  const transferableBatches = batches.filter((b: any) =>
    b.product_id === transferForm.product_id && isLotReleased(b.quality_status) &&
    Number(b.quantity) > 0 && b.warehouse_id && b.warehouse_id !== ''
  )
  const transferBatch = transferableBatches.find((b: any) => b.id === transferForm.batch_id)
  const transferTargets = transferBatch
    ? warehouses.filter((w: any) => w.id !== whIdOf(transferBatch.warehouse_id))
    : []
  const transferError = validateTransfer({
    availableQty: transferBatch ? Number(transferBatch.quantity) : 0,
    qty: Number(transferForm.qty) || 0,
    released: transferBatch ? isLotReleased(transferBatch.quality_status) : true,
  })

  function printStockBon(m: any) {
    const isIn = m.type === 'IN'
    const typeName = isIn ? 'ENTRÉE' : m.type === 'OUT' ? 'SORTIE' : 'AJUSTEMENT'
    const prefix = isIn ? 'BSE' : 'BSS'
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Bon ${typeName} Stock</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:white}@page{margin:15mm 18mm;size:A4}
.header{display:flex;justify-content:space-between;padding:24px 32px 20px;background:${isIn ? '#1a3d2b' : '#7f1d1d'};color:white}
.company-name{font-size:1.4rem;font-weight:800;font-family:Georgia,serif}.company-sub{font-size:0.7rem;opacity:0.65;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px}
.badge-type{background:#d4a017;color:white;padding:5px 14px;border-radius:4px;font-weight:700;font-size:0.85rem}
.body{padding:28px 32px}
.meta-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px}
.meta-box{background:#f8f5ee;padding:14px 16px;border-radius:8px}.meta-label{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:4px}.meta-value{font-size:0.9rem;font-weight:600;color:#1a3d2b}
.amount-box{background:${isIn ? '#ecfdf5' : '#fef2f2'};border:2px solid ${isIn ? '#a7f3d0' : '#fecaca'};border-radius:12px;padding:24px;text-align:center;margin:24px 0}
.amount{font-family:Georgia,serif;font-size:2.2rem;font-weight:800;color:${isIn ? '#065f46' : '#991b1b'}}
.sig-area{border:1.5px dashed #ccc;border-radius:8px;height:60px;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:0.8rem;margin-top:8px}
.footer{padding:12px 32px;background:#0f1f17;color:rgba(255,255,255,0.5);font-size:0.7rem;display:flex;justify-content:space-between}
</style></head><body>
<div class="header"><div><div class="company-name">HUB Distribution</div><div class="company-sub">Transformation & Distribution Agricole</div></div>
<div style="text-align:right"><div class="badge-type">${isIn ? '📥' : '📤'} BON DE ${typeName}</div><div style="font-family:monospace;font-size:0.9rem;margin-top:6px;opacity:0.7">${prefix}-${m.id.slice(-8).toUpperCase()}</div></div></div>
<div class="body">
<div class="meta-grid">
<div class="meta-box"><div class="meta-label">Date</div><div class="meta-value">${new Date(m.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
<div class="meta-box"><div class="meta-label">Produit</div><div class="meta-value">${m.product?.name || '—'}</div></div>
<div class="meta-box"><div class="meta-label">Lot</div><div class="meta-value">${m.batch?.batch_number || '—'}</div></div>
</div>
<div class="amount-box"><div style="font-size:0.75rem;color:${isIn ? '#065f46' : '#991b1b'};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px">Quantité ${typeName.toLowerCase()}</div><div class="amount">${isIn ? '+' : '-'}${m.quantity} ${m.product?.unit || ''}</div></div>
${m.reason ? `<div style="padding:14px 18px;background:#f8f5ee;border-radius:8px;margin-bottom:20px"><div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;font-weight:700;margin-bottom:4px">Motif</div><div style="font-size:0.9rem;color:#555">${m.reason}</div></div>` : ''}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px;padding-top:20px;border-top:1px solid #ddd">
<div style="text-align:center"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase;margin-bottom:8px">Magasinier</div><div class="sig-area">Signature</div></div>
<div style="text-align:center"><div style="font-size:0.72rem;color:#888;font-weight:700;text-transform:uppercase;margin-bottom:8px">Responsable</div><div class="sig-area">Signature & cachet</div></div>
</div></div>
<div class="footer"><span>HUB Distribution — RCCM: BZV-XXXX-XX — NIF: XXXXXXXXXX — Brazzaville, Congo</span><span>Imprimé le ${new Date().toLocaleDateString('fr-FR')}</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 800) }
  }

  return (
    <div>
      <div className="page-header">
        <h2>📦 Gestion de Stock</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={() => { setMovType('OUT'); setMovForm({product_id:'',batch_id:'',quantity:0,reason:'',date:new Date().toISOString().split('T')[0],warehouse_id:defaultWh?.id||''}); setShowMovModal(true) }}>↓ Sortie</button>
          <Link href="/stock/inventory" className="btn-ghost" style={{ textDecoration: 'none' }}>📋 Inventaire</Link>
          <Link href="/stock/recall" className="btn-ghost" style={{ textDecoration: 'none' }}>🔎 Traçabilité</Link>
          <Link href="/stock/warehouses" className="btn-ghost" style={{ textDecoration: 'none' }}>🏭 Entrepôts</Link>
          <button className="btn-ghost" disabled={warehouses.length < 2} title={warehouses.length < 2 ? 'Créez au moins 2 entrepôts (page 🏭 Entrepôts)' : 'Transférer un lot entre entrepôts'}
            onClick={() => { setTransferForm(emptyTransfer); setTransferInfo(null); setShowTransferModal(true) }}>⇄ Transfert</button>
          <button className="btn-primary" onClick={() => { setMovType('IN'); setMovForm({product_id:'',batch_id:'',quantity:0,reason:'',date:new Date().toISOString().split('T')[0],warehouse_id:defaultWh?.id||''}); setShowMovModal(true) }}>↑ Entrée</button>
          <button className="btn-amber" onClick={() => { setEditingProduct(null); setProductForm(emptyProduct); setProductPacks([]); setShowProductModal(true) }}>+ Produit</button>
        </div>
      </div>

      <div style={{ padding:'24px 32px' }}>
        {(lowStock.length > 0 || expiredBatches.length > 0 || soonExp.length > 0) && (
          <div style={{ marginBottom:16, display:'flex', gap:10, flexWrap:'wrap' }}>
            {lowStock.length > 0 && <div className="alert alert-warning" style={{ flex:1, minWidth:240 }}>⚠️ <strong>{lowStock.length}</strong> produit(s) en stock bas</div>}
            {expiredBatches.length > 0 && <div className="alert alert-error" style={{ flex:1, minWidth:240 }}>🚨 <strong>{expiredBatches.length}</strong> lot(s) expiré(s)</div>}
            {soonExp.length > 0 && <div className="alert alert-warning" style={{ flex:1, minWidth:240 }}>🕐 <strong>{soonExp.length}</strong> lot(s) expirent dans 30j</div>}
          </div>
        )}

        {transferInfo && (
          <div style={{ marginBottom:16 }}>
            {transferInfo.ok
              ? <div className="alert alert-success">✅ {transferInfo.msg}</div>
              : <div className="alert alert-error">⚠️ {transferInfo.msg}</div>}
          </div>
        )}

        {/* Récapitulatif multi-entrepôt */}
        {!loading && whSummary.length > 0 && (
          <div style={{ marginBottom:16, display:'flex', gap:10, flexWrap:'wrap' }}>
            {whSummary.map(s => (
              <div key={s.id} title={`${s.batch_count} lot(s) · ${s.code}`}
                style={{ background:'white', border:'1px solid #e8e4db', borderRadius:10, padding:'8px 14px', fontSize:'0.8rem' }}>
                <span style={{ fontWeight:700 }}>{s.is_cold ? '❄️' : '📦'} {s.name}</span>
                <span style={{ marginLeft:8, color:'#666' }}>
                  {Number(s.stock_quantity).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} u. · {s.batch_count} lot(s)
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display:'flex', gap:0, marginBottom:20, background:'#f0ece4', borderRadius:8, padding:4, width:'fit-content' }}>
          {(['products','batches','movements'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding:'8px 18px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:600, fontSize:'0.875rem',
              background:tab===t?'white':'transparent', color:tab===t?'var(--hub-green)':'#666', boxShadow:tab===t?'0 1px 4px rgba(0,0,0,0.1)':'none' }}>
              {t==='products'?`📦 Produits (${products.length})`:t==='batches'?`🏷 Lots (${batches.length})`:`🔄 Mouvements`}
            </button>
          ))}
        </div>

        {tab === 'products' && (
          <>
            <div style={{ background:'white', borderRadius:12, border:'1px solid #e8e4db', overflow:'hidden', marginBottom:20 }}>
              {loading ? <div style={{ padding:40, textAlign:'center', color:'#999' }}>Chargement...</div> : (
                <table className="hub-table">
                  <thead>
                    <tr><th>Produit</th><th>Catégorie</th><th>Quantité</th><th>Seuil</th><th>Prix unit.</th><th>Valeur stock</th><th>Statut</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {products.map(p => {
                      const isLow = p.quantity <= p.threshold_alert
                      const pct = Math.min(100, (p.quantity/Math.max(p.threshold_alert*2,1))*100)
                      const stockVal = p.quantity * (p.price_per_unit||0)
                      return (
                        <tr key={p.id}>
                          <td><strong>{p.name}</strong>{p.description && <div style={{fontSize:'0.72rem',color:'#999'}}>{p.description}</div>}</td>
                          <td><span className="badge badge-gray">{p.category}</span></td>
                          <td>
                            <div style={{fontWeight:700,color:isLow?'#dc2626':'var(--hub-green)'}}>{p.quantity} {p.unit}</div>
                            <div className="progress-bar" style={{marginTop:4,width:80}}>
                              <div className={`progress-fill ${isLow?'red':'amber'}`} style={{width:`${pct}%`}} />
                            </div>
                          </td>
                          <td style={{color:'#666'}}>{p.threshold_alert} {p.unit}</td>
                          <td style={{color:'#666'}}>{p.price_per_unit ? `${Number(p.price_per_unit).toLocaleString()} FCFA` : '—'}</td>
                          <td style={{fontWeight:600,color:'var(--hub-green-mid)'}}>{stockVal > 0 ? `${stockVal.toLocaleString('fr-FR',{maximumFractionDigits:0})} FCFA` : '—'}</td>
                          <td>{isLow ? <span className="badge badge-red">⚠️ Bas</span> : <span className="badge badge-green">✓ OK</span>}</td>
                          <td>
                            <div style={{display:'flex',gap:6}}>
                              <button className="btn-ghost" style={{padding:'5px 10px',fontSize:'0.75rem'}} onClick={async () => {
                                setEditingProduct(p)
                                setProductForm({name:p.name,category:p.category,quantity:p.quantity,unit:p.unit,threshold_alert:p.threshold_alert,price_per_unit:p.price_per_unit||0,description:p.description||''})
                                const { data } = await supabase.from('product_units').select('unit, factor').eq('product_id', p.id)
                                setProductPacks((data || []).map(r => ({ unit: r.unit, factor: Number(r.factor) })))
                                setShowProductModal(true)
                              }}>✏️</button>
                              <button className="btn-amber" style={{padding:'5px 10px',fontSize:'0.75rem'}} onClick={() => {
                                setSelectedProductId(p.id); setBatchForm({...emptyBatch, warehouse_id: defaultWh?.id || ''}); setShowBatchModal(true)
                              }}>+ Lot</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {products.length === 0 && <tr><td colSpan={8} style={{textAlign:'center',padding:40,color:'#999'}}>Aucun produit</td></tr>}
                  </tbody>
                </table>
              )}
            </div>

            {/* Stock par entrepôt */}
            <div style={{ background:'white', borderRadius:12, border:'1px solid #e8e4db', overflow:'hidden' }}>
              <div style={{ padding:'14px 20px', borderBottom:'1px solid #f0ece4', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
                <strong style={{ fontSize:'0.95rem' }}>🏭 Stock par entrepôt</strong>
                <select className="hub-select" style={{ maxWidth: 260, padding:'6px 10px' }} value={whProductFilter}
                  onChange={e => setWhProductFilter(e.target.value)}>
                  <option value="all">— Tous les produits —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {warehouseTotals.length > 0 && (
                  <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginLeft:'auto' }}>
                    {warehouseTotals.map(t => (
                      <span key={t.warehouse_name} className="badge badge-green">
                        {t.warehouse_name}: {t.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} u.
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <table className="hub-table">
                <thead>
                  <tr><th>Produit</th><th>Entrepôt</th><th>Quantité en lots</th></tr>
                </thead>
                <tbody>
                  {filteredStockRows.map((r, i) => (
                    <tr key={`${r.product_id}-${r.warehouse_id}-${i}`}>
                      <td><strong>{r.product_name}</strong></td>
                      <td>
                        <span className={`badge ${r.warehouse_name === 'Sans entrepôt' ? 'badge-gray' : 'badge-blue'}`}>
                          {r.warehouse_name === 'Sans entrepôt' ? '🚫 Sans entrepôt' : `📦 ${r.warehouse_name}`}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700 }}>{r.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} u.</td>
                    </tr>
                  ))}
                  {filteredStockRows.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign:'center', padding:28, color:'#999' }}>
                      Aucun stock en lots pour {whProductFilter === 'all' ? 'le moment' : 'ce produit'} — les quantités apparaissent dès qu&apos;un lot est enregistré.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'batches' && (
          <div style={{ background:'white', borderRadius:12, border:'1px solid #e8e4db', overflow:'hidden' }}>
            {whSummary.length > 1 && (
              <div style={{ padding:'12px 20px', borderBottom:'1px solid #f0ece4', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                <span style={{ fontSize:'0.8rem', color:'#666', fontWeight:600 }}>Filtrer :</span>
                <button onClick={() => setWhFilter('all')} style={{ padding:'5px 12px', borderRadius:16, border:'1.5px solid', cursor:'pointer', fontSize:'0.75rem', fontWeight:600,
                  borderColor: whFilter==='all' ? 'var(--hub-green-mid)' : '#ddd', background: whFilter==='all' ? 'var(--hub-green-mid)' : 'white', color: whFilter==='all' ? 'white' : '#666' }}>
                  🏭 Tous
                </button>
                {whSummary.map(s => (
                  <button key={s.id} onClick={() => setWhFilter(s.id)} style={{ padding:'5px 12px', borderRadius:16, border:'1.5px solid', cursor:'pointer', fontSize:'0.75rem', fontWeight:600,
                    borderColor: whFilter===s.id ? 'var(--hub-green-mid)' : '#ddd', background: whFilter===s.id ? 'var(--hub-green-mid)' : 'white', color: whFilter===s.id ? 'white' : '#666' }}>
                    {s.is_cold ? '❄️' : '📦'} {s.name}
                  </button>
                ))}
              </div>
            )}
            <table className="hub-table">
              <thead>
                <tr><th>Produit</th><th>N° Lot</th><th>Quantité</th><th>Entrepôt</th><th>Production</th><th>Péremption</th><th>Fournisseur</th><th>Statut</th><th></th></tr>
              </thead>
              <tbody>
                {filteredBatches.map(b => {
                  const isExpired = b.expiry_date && b.expiry_date < today
                  const daysLeft = b.expiry_date ? Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / (1000*60*60*24)) : null
                  const isSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30
                  const wh = whOf(b.warehouse_id)
                  return (
                    <tr key={b.id}>
                      <td><strong>{b.product?.name}</strong></td>
                      <td style={{fontFamily:'monospace',fontSize:'0.85rem'}}>{b.batch_number}</td>
                      <td style={{fontWeight:700}}>{b.quantity} {b.product?.unit}</td>
                      <td>
                        <span className="badge badge-blue" style={{ whiteSpace:'nowrap' }}>
                          {wh?.is_cold ? '❄️ ' : '📦 '}{whNameOf(b.warehouse_id)}
                        </span>
                      </td>
                      <td style={{color:'#666',fontSize:'0.8rem'}}>{b.production_date ? new Date(b.production_date).toLocaleDateString('fr-FR') : '—'}</td>
                      <td style={{fontWeight:600,color:isExpired?'#dc2626':isSoon?'#92400e':'#555'}}>
                        {b.expiry_date ? new Date(b.expiry_date).toLocaleDateString('fr-FR') : '—'}
                        {daysLeft !== null && b.quantity > 0 && (
                          <span style={{fontSize:'0.72rem',display:'block'}}>
                            {isExpired ? '⛔ Expiré' : isSoon ? `⚠ J-${daysLeft}` : ''}
                          </span>
                        )}
                      </td>
                      <td style={{color:'#666'}}>{b.supplier || '—'}</td>
                      <td>
                        {b.quality_status === 'pending' || b.quality_status === 'rejected' ? (
                          <span className={`badge ${QUALITY_LABELS[b.quality_status].badge}`}>
                            {QUALITY_LABELS[b.quality_status].icon} {QUALITY_LABELS[b.quality_status].label}
                          </span>
                        ) : isExpired && b.quantity > 0 ? <span className="badge badge-red">⛔ Expiré</span>
                          : isSoon && b.quantity > 0 ? <span className="badge badge-amber">⚠ Bientôt</span>
                          : b.quantity <= 0 ? <span className="badge badge-gray">Vide</span>
                          : <span className="badge badge-green">✓ OK</span>}
                      </td>
                      <td>
                        <span style={{ display: 'flex', gap: 4 }}>
                          {b.quality_status === 'pending' && (
                            <Link href="/quality" className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.72rem', textDecoration: 'none' }}>🧪</Link>
                          )}
                          <Link href={`/stock/recall?id=${b.id}`} className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.72rem', textDecoration: 'none' }}>🔎</Link>
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {filteredBatches.length === 0 && <tr><td colSpan={9} style={{textAlign:'center',padding:40,color:'#999'}}>
                  {whFilter !== 'all' ? 'Aucun lot dans cet entrepôt.' : 'Aucun lot — ajoutez des lots depuis la liste des produits'}
                </td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'movements' && (
          <div style={{ background:'white', borderRadius:12, border:'1px solid #e8e4db', overflow:'hidden' }}>
            <table className="hub-table">
              <thead>
                <tr><th>Date</th><th>Produit</th><th>Lot</th><th>Entrepôt</th><th>Type</th><th>Quantité</th><th>Motif</th><th>Bon</th></tr>
              </thead>
              <tbody>
                {movements.map(m => (
                  <tr key={m.id}>
                    <td style={{color:'#666',fontSize:'0.8rem'}}>{new Date(m.created_at).toLocaleDateString('fr-FR')}</td>
                    <td><strong>{m.product?.name}</strong></td>
                    <td style={{fontFamily:'monospace',fontSize:'0.8rem',color:'#666'}}>{m.batch?.batch_number || '—'}</td>
                    <td>
                      <span className="badge badge-blue" style={{ whiteSpace:'nowrap' }}>
                        {whOf(m.warehouse_id)?.is_cold ? '❄️ ' : '📦 '}{whNameOf(m.warehouse_id)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${m.type==='IN'?'badge-green':m.type==='OUT'?'badge-red':'badge-blue'}`}>
                        {m.type==='IN'?'↑ Entrée':m.type==='OUT'?'↓ Sortie':'⟳ Ajust.'}
                      </span>
                    </td>
                    <td style={{fontWeight:700,color:m.type==='IN'?'#065f46':m.type==='OUT'?'#991b1b':'#1e40af'}}>
                      {m.type==='IN'?'+':m.type==='OUT'?'-':''}{m.quantity} {m.product?.unit}
                    </td>
                    <td style={{color:'#666',fontSize:'0.8rem'}}>
                      {m.reason || '—'}
                      {m.notes && <div style={{ color:'#aaa', fontSize:'0.72rem' }}>{m.notes}</div>}
                    </td>
                    <td>
                      {['IN','OUT'].includes(m.type) && (
                        <button className="btn-ghost" style={{padding:'4px 10px',fontSize:'0.72rem'}} onClick={() => printStockBon(m)}>🖨️</button>
                      )}
                    </td>
                  </tr>
                ))}
                {movements.length === 0 && <tr><td colSpan={8} style={{textAlign:'center',padding:40,color:'#999'}}>Aucun mouvement</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Produit */}
      {showProductModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowProductModal(false)}>
          <div className="modal-box">
            <div className="modal-title">{editingProduct ? '✏️ Modifier produit' : '➕ Nouveau produit'}</div>
            <form onSubmit={saveProduct}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div className="hub-form-group" style={{gridColumn:'1/-1'}}><label>Nom *</label><input className="hub-input" required value={productForm.name} onChange={e => setProductForm({...productForm,name:e.target.value})} placeholder="Farine de manioc" /></div>
                <div className="hub-form-group"><label>Catégorie</label><select className="hub-select" value={productForm.category} onChange={e => setProductForm({...productForm,category:e.target.value})}>{categories.map(c => <option key={c}>{c}</option>)}</select></div>
                <div className="hub-form-group"><label>Unité</label><select className="hub-select" value={productForm.unit} onChange={e => setProductForm({...productForm,unit:e.target.value})}>{units.map(u => <option key={u}>{u}</option>)}</select></div>
                <div className="hub-form-group"><label>Quantité initiale</label><input className="hub-input" type="number" min={0} value={productForm.quantity} onChange={e => setProductForm({...productForm,quantity:Number(e.target.value)})} /></div>
                <div className="hub-form-group"><label>Seuil d&apos;alerte</label><input className="hub-input" type="number" min={0} value={productForm.threshold_alert} onChange={e => setProductForm({...productForm,threshold_alert:Number(e.target.value)})} /></div>
                <div className="hub-form-group" style={{gridColumn:'1/-1'}}><label>Prix unitaire (FCFA)</label><input className="hub-input" type="number" min={0} value={productForm.price_per_unit} onChange={e => setProductForm({...productForm,price_per_unit:Number(e.target.value)})} /></div>
              </div>
              <div style={{ marginTop: 14, fontWeight: 700, fontSize: '0.75rem', color: 'var(--hub-green)', textTransform: 'uppercase' }}>Conditionnements (vers {productForm.unit})</div>
              {productPacks.map((pack, idx) => (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginTop: 8 }}>
                  <input className="hub-input" placeholder="sac, carton…" value={pack.unit} onChange={e => setProductPacks(prev => { const u = [...prev]; u[idx] = { ...u[idx], unit: e.target.value }; return u })} />
                  <input className="hub-input" type="number" min={0.0001} step="0.0001" placeholder={`1 unité = ? ${productForm.unit}`} value={pack.factor || ''} onChange={e => setProductPacks(prev => { const u = [...prev]; u[idx] = { ...u[idx], factor: Number(e.target.value) }; return u })} />
                  <button type="button" onClick={() => setProductPacks(prev => prev.filter((_, i) => i !== idx))} style={{ border: 'none', background: '#fee2e2', color: '#dc2626', borderRadius: 6, cursor: 'pointer' }}>✕</button>
                </div>
              ))}
              <button type="button" className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setProductPacks(prev => [...prev, { unit: 'sac', factor: 1 }])}>+ Conditionnement</button>
              <div style={{display:'flex',gap:12,justifyContent:'flex-end',marginTop:8}}>
                <button type="button" className="btn-ghost" onClick={() => setShowProductModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? '...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Lot */}
      {showBatchModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowBatchModal(false)}>
          <div className="modal-box">
            <div className="modal-title">🏷️ Nouveau lot — {products.find(p => p.id === selectedProductId)?.name}</div>
            <form onSubmit={saveBatch}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div className="hub-form-group"><label>N° de lot *</label><input className="hub-input" required value={batchForm.batch_number} onChange={e => setBatchForm({...batchForm,batch_number:e.target.value})} placeholder="LOT-2025-001" /></div>
                <div className="hub-form-group"><label>Quantité *</label><input className="hub-input" type="number" min={1} required value={batchForm.quantity || ''} onChange={e => setBatchForm({...batchForm,quantity:Number(e.target.value)})} /></div>
                <div className="hub-form-group" style={{gridColumn:'1/-1'}}>
                  <label>🏭 Entrepôt de réception *</label>
                  <select className="hub-select" value={batchForm.warehouse_id || ''} onChange={e => setBatchForm({...batchForm,warehouse_id:e.target.value})}>
                    {warehouses.length === 0 && <option value="">— Créez d&apos;abord un entrepôt —</option>}
                    {warehouses.map((w: any) => (
                      <option key={w.id} value={w.id}>{w.is_cold ? '❄️ ' : '📦 '}{w.name} ({w.code})</option>
                    ))}
                  </select>
                </div>
                <div className="hub-form-group"><label>Date de production</label><input className="hub-input" type="date" value={batchForm.production_date} onChange={e => setBatchForm({...batchForm,production_date:e.target.value})} /></div>
                <div className="hub-form-group"><label>⚠ Date de péremption</label><input className="hub-input" type="date" value={batchForm.expiry_date} onChange={e => setBatchForm({...batchForm,expiry_date:e.target.value})} /></div>
                <div className="hub-form-group"><label>Fournisseur</label><input className="hub-input" value={batchForm.supplier} onChange={e => setBatchForm({...batchForm,supplier:e.target.value})} /></div>
                <div className="hub-form-group"><label>Coût unitaire (FCFA)</label><input className="hub-input" type="number" min={0} value={batchForm.cost_per_unit} onChange={e => setBatchForm({...batchForm,cost_per_unit:Number(e.target.value)})} /></div>
              </div>
              <div className="alert alert-warning" style={{margin:'8px 0'}}>📌 Une entrée de stock sera automatiquement créée pour ce lot dans l&apos;entrepôt sélectionné.</div>
              <div style={{display:'flex',gap:12,justifyContent:'flex-end',marginTop:8}}>
                <button type="button" className="btn-ghost" onClick={() => setShowBatchModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving || warehouses.length === 0}>{saving ? '...' : 'Enregistrer le lot'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Mouvement */}
      {showMovModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowMovModal(false)}>
          <div className="modal-box">
            <div className="modal-title">{movType === 'IN' ? '↑ Entrée de stock' : '↓ Sortie de stock'}</div>
            <form onSubmit={saveMov}>
              <div className="hub-form-group"><label>Type</label>
                <div style={{display:'flex',gap:8}}>
                  {(['IN','OUT'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setMovType(t)}
                      style={{flex:1,padding:'10px',borderRadius:8,border:'2px solid',cursor:'pointer',fontWeight:600,
                        borderColor:movType===t?(t==='IN'?'#065f46':'#991b1b'):'#ddd',
                        background:movType===t?(t==='IN'?'#ecfdf5':'#fef2f2'):'white',
                        color:movType===t?(t==='IN'?'#065f46':'#991b1b'):'#666'}}>
                      {t === 'IN' ? '↑ Entrée' : '↓ Sortie'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="hub-form-group"><label>Produit *</label>
                <select className="hub-select" required value={movForm.product_id} onChange={e => setMovForm({...movForm,product_id:e.target.value,batch_id:'',warehouse_id:defaultWh?.id||''})}>
                  <option value="">-- Sélectionner --</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (stock: {p.quantity} {p.unit})</option>)}
                </select>
              </div>
              {movForm.product_id && productBatches.length > 0 && (
                <div className="hub-form-group"><label>Lot (optionnel)</label>
                  <select className="hub-select" value={movForm.batch_id} onChange={e => {
                    const bid = e.target.value
                    const b = batches.find((x: any) => x.id === bid)
                    setMovForm({...movForm,batch_id:bid,warehouse_id:(b?.warehouse_id || defaultWh?.id) || ''})
                  }}>
                    <option value="">-- Sans lot spécifique --</option>
                    {productBatches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.batch_number} — {b.quantity} unités — {whNameOf(b.warehouse_id)}{b.expiry_date ? ` (exp: ${new Date(b.expiry_date).toLocaleDateString('fr-FR')})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {warehouses.length > 0 && (
                <div className="hub-form-group"><label>🏭 Entrepôt {movForm.batch_id ? '(imposé par le lot)' : ''}</label>
                  <select className="hub-select" value={movForm.warehouse_id || ''} disabled={!!movForm.batch_id}
                    onChange={e => setMovForm({...movForm,warehouse_id:e.target.value})}>
                    <option value="">-- Aucun --</option>
                    {warehouses.map((w: any) => (
                      <option key={w.id} value={w.id}>{w.is_cold ? '❄️ ' : '📦 '}{w.name} ({w.code})</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="hub-form-group"><label>Quantité *</label><input className="hub-input" type="number" min={1} required value={movForm.quantity || ''} onChange={e => setMovForm({...movForm,quantity:Number(e.target.value)})} /></div>
              <div className="hub-form-group"><label>Date</label><input className="hub-input" type="date" value={movForm.date} onChange={e => setMovForm({...movForm,date:e.target.value})} /></div>
              <div className="hub-form-group"><label>Motif / Référence</label><input className="hub-input" value={movForm.reason} onChange={e => setMovForm({...movForm,reason:e.target.value})} placeholder="Commande #001, Livraison client..." /></div>
              <div style={{display:'flex',gap:12,justifyContent:'flex-end',marginTop:8}}>
                <button type="button" className="btn-ghost" onClick={() => setShowMovModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? '...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Transfert */}
      {showTransferModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowTransferModal(false)}>
          <div className="modal-box">
            <div className="modal-title">⇄ Transfert entre entrepôts</div>
            <form onSubmit={doTransfer}>
              {transferInfo && !transferInfo.ok && <div className="alert alert-error" style={{ marginBottom: 12 }}>⚠️ {transferInfo.msg}</div>}
              <div className="hub-form-group"><label>Produit *</label>
                <select className="hub-select" value={transferForm.product_id} onChange={e => setTransferForm({...emptyTransfer, product_id: e.target.value})}>
                  <option value="">-- Sélectionner --</option>
                  {products.map(p => {
                    const usable = batches.filter((b: any) => b.product_id === p.id && isLotReleased(b.quality_status) && Number(b.quantity) > 0 && b.warehouse_id)
                    return usable.length > 0 ? <option key={p.id} value={p.id}>{p.name}</option> : null
                  })}
                </select>
              </div>
              {transferForm.product_id && (
                <div className="hub-form-group"><label>Lot source *</label>
                  <select className="hub-select" required value={transferForm.batch_id} onChange={e => setTransferForm({...transferForm,batch_id:e.target.value,to_warehouse_id:''})}>
                    <option value="">-- Choisir le lot --</option>
                    {transferableBatches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.batch_number} — {b.quantity} {b.product?.unit} · {whNameOf(b.warehouse_id)}{b.expiry_date ? ` (exp: ${new Date(b.expiry_date).toLocaleDateString('fr-FR')})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {transferBatch && (
                <>
                  <div className="hub-form-group"><label>Entrepôt de destination *</label>
                    <select className="hub-select" required value={transferForm.to_warehouse_id} onChange={e => setTransferForm({...transferForm,to_warehouse_id:e.target.value})}>
                      <option value="">-- Choisir l&apos;entrepôt cible --</option>
                      {transferTargets.map((w: any) => (
                        <option key={w.id} value={w.id}>{w.is_cold ? '❄️ ' : '📦 '}{w.name} ({w.code})</option>
                      ))}
                    </select>
                  </div>
                  <div className="hub-form-group"><label>Quantité à transférer *</label>
                    <input className="hub-input" type="number" min={1} step="0.001" required value={transferForm.qty || ''} onChange={e => setTransferForm({...transferForm,qty:Number(e.target.value)})} />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 8 }}>
                    Source : <strong>{whNameOf(transferBatch.warehouse_id)}</strong> — disponible : <strong>{Number(transferBatch.quantity)} {transferBatch.product?.unit}</strong>
                    {transferBatch.quality_status === 'pending' && ' · ⏳ lot en quarantaine'}
                  </div>
                  {transferForm.to_warehouse_id && transferError && (
                    <div className="alert alert-error" style={{ marginBottom: 8 }}>⚠️ {transferError}</div>
                  )}
                  <div className="alert alert-warning" style={{ margin: '8px 0' }}>
                    📌 Le transfert crée une sortie (TRANSFERT SORTIE) depuis l&apos;entrepôt source et une entrée (TRANSFERT ENTREE) vers l&apos;entrepôt cible. Le lot est regroupé avec un lot identique s&apos;il en existe déjà sur place.
                  </div>
                </>
              )}
              <div style={{display:'flex',gap:12,justifyContent:'flex-end',marginTop:8}}>
                <button type="button" className="btn-ghost" onClick={() => setShowTransferModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving || !transferForm.batch_id || !transferForm.to_warehouse_id || !!transferError}>
                  {saving ? 'Transfert en cours...' : '⇄ Transférer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
