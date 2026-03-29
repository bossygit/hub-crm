'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Product, StockMovement } from '@/types'

const emptyProduct = { name: '', category: 'Céréales transformées', quantity: 0, unit: 'kg', threshold_alert: 10, price_per_unit: 0, description: '' }
const categories = ['Céréales transformées', 'Huiles & graisses', 'Légumineuses', 'Boissons', 'Légumes transformés', 'Viandes & poissons', 'Autres']
const units = ['kg', 'g', 'L', 'ml', 'carton', 'sac', 'tonne', 'pièce']

export default function StockPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'products' | 'movements'>('products')
  const [showProductModal, setShowProductModal] = useState(false)
  const [showMovementModal, setShowMovementModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productForm, setProductForm] = useState(emptyProduct)
  const [movementForm, setMovementForm] = useState({ product_id: '', type: 'IN' as 'IN'|'OUT', quantity: 0, reason: '', date: new Date().toISOString().split('T')[0] })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  async function load() {
    setLoading(true)
    const [{ data: p }, { data: m }] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('stock_movements').select('*, product:products(name, unit)').order('created_at', { ascending: false }).limit(50)
    ])
    setProducts(p || [])
    setMovements(m || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNewProduct() { setEditingProduct(null); setProductForm(emptyProduct); setShowProductModal(true) }
  function openEditProduct(p: Product) {
    setEditingProduct(p)
    setProductForm({ name: p.name, category: p.category, quantity: p.quantity, unit: p.unit, threshold_alert: p.threshold_alert, price_per_unit: p.price_per_unit || 0, description: p.description || '' })
    setShowProductModal(true)
  }

  async function saveProduct(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    if (editingProduct) {
      await supabase.from('products').update(productForm).eq('id', editingProduct.id)
    } else {
      await supabase.from('products').insert(productForm)
    }
    setSaving(false); setShowProductModal(false); load()
  }

  async function saveMovement(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await supabase.from('stock_movements').insert(movementForm)
    setSaving(false); setShowMovementModal(false)
    setMovementForm({ product_id: '', type: 'IN', quantity: 0, reason: '', date: new Date().toISOString().split('T')[0] })
    load()
  }

  async function deleteProduct(id: string) {
    if (!confirm('Supprimer ce produit ?')) return
    await supabase.from('products').delete().eq('id', id)
    load()
  }

  const lowStock = products.filter(p => p.quantity <= p.threshold_alert)

  return (
    <div>
      <div className="page-header">
        <h2>📦 Gestion de Stock</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-ghost" onClick={() => { setMovementForm({...movementForm, type: 'OUT'}); setShowMovementModal(true) }}>↓ Sortie de stock</button>
          <button className="btn-primary" onClick={() => { setMovementForm({...movementForm, type: 'IN'}); setShowMovementModal(true) }}>↑ Entrée de stock</button>
          <button className="btn-amber" onClick={openNewProduct}>+ Nouveau produit</button>
        </div>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Alertes */}
        {lowStock.length > 0 && (
          <div className="alert alert-warning" style={{ marginBottom: 20 }}>
            ⚠️ <strong>{lowStock.length} produit(s)</strong> en stock bas : {lowStock.map(p => p.name).join(', ')}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: '#f0ece4', borderRadius: 8, padding: 4, width: 'fit-content' }}>
          {(['products', 'movements'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
                background: tab === t ? 'white' : 'transparent',
                color: tab === t ? 'var(--hub-green)' : '#666',
                boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
              {t === 'products' ? '📦 Produits' : '🔄 Mouvements'}
            </button>
          ))}
        </div>

        {/* Products table */}
        {tab === 'products' && (
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
              <table className="hub-table">
                <thead>
                  <tr><th>Produit</th><th>Catégorie</th><th>Quantité</th><th>Seuil alerte</th><th>Prix unitaire</th><th>Statut</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {products.map(p => {
                    const isLow = p.quantity <= p.threshold_alert
                    const pct = Math.min(100, (p.quantity / Math.max(p.threshold_alert * 2, 1)) * 100)
                    return (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong>{p.description && <div style={{ fontSize: '0.75rem', color: '#999' }}>{p.description}</div>}</td>
                        <td><span className="badge badge-gray">{p.category}</span></td>
                        <td>
                          <div style={{ fontWeight: 700, color: isLow ? '#dc2626' : 'var(--hub-green)' }}>{p.quantity} {p.unit}</div>
                          <div className="progress-bar" style={{ marginTop: 4, width: 80 }}>
                            <div className={`progress-fill ${isLow ? 'red' : 'amber'}`} style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td style={{ color: '#666' }}>{p.threshold_alert} {p.unit}</td>
                        <td style={{ color: '#666' }}>{p.price_per_unit ? `${p.price_per_unit.toLocaleString()} FCFA` : '—'}</td>
                        <td>{isLow ? <span className="badge badge-red">⚠️ Stock bas</span> : <span className="badge badge-green">✓ OK</span>}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem' }} onClick={() => openEditProduct(p)}>✏️</button>
                            <button className="btn-danger" onClick={() => deleteProduct(p.id)}>🗑️</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {products.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#999' }}>Aucun produit</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Movements table */}
        {tab === 'movements' && (
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <table className="hub-table">
              <thead>
                <tr><th>Date</th><th>Produit</th><th>Type</th><th>Quantité</th><th>Motif</th></tr>
              </thead>
              <tbody>
                {movements.map(m => (
                  <tr key={m.id}>
                    <td style={{ color: '#666', fontSize: '0.8rem' }}>{new Date(m.created_at).toLocaleDateString('fr-FR')}</td>
                    <td><strong>{m.product?.name}</strong></td>
                    <td><span className={`badge ${m.type === 'IN' ? 'badge-green' : 'badge-red'}`}>{m.type === 'IN' ? '↑ Entrée' : '↓ Sortie'}</span></td>
                    <td style={{ fontWeight: 700, color: m.type === 'IN' ? '#065f46' : '#991b1b' }}>
                      {m.type === 'IN' ? '+' : '-'}{m.quantity} {m.product?.unit}
                    </td>
                    <td style={{ color: '#666' }}>{m.reason || '—'}</td>
                  </tr>
                ))}
                {movements.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: '#999' }}>Aucun mouvement</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Produit */}
      {showProductModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowProductModal(false)}>
          <div className="modal-box">
            <div className="modal-title">{editingProduct ? '✏️ Modifier le produit' : '➕ Nouveau produit'}</div>
            <form onSubmit={saveProduct}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Nom du produit *</label>
                  <input className="hub-input" value={productForm.name} onChange={e => setProductForm({...productForm, name: e.target.value})} required placeholder="Ex: Farine de manioc" />
                </div>
                <div className="hub-form-group">
                  <label>Catégorie</label>
                  <select className="hub-select" value={productForm.category} onChange={e => setProductForm({...productForm, category: e.target.value})}>
                    {categories.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Unité</label>
                  <select className="hub-select" value={productForm.unit} onChange={e => setProductForm({...productForm, unit: e.target.value})}>
                    {units.map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Quantité initiale</label>
                  <input className="hub-input" type="number" min={0} value={productForm.quantity} onChange={e => setProductForm({...productForm, quantity: Number(e.target.value)})} />
                </div>
                <div className="hub-form-group">
                  <label>Seuil d&apos;alerte</label>
                  <input className="hub-input" type="number" min={0} value={productForm.threshold_alert} onChange={e => setProductForm({...productForm, threshold_alert: Number(e.target.value)})} />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Prix unitaire (FCFA)</label>
                  <input className="hub-input" type="number" min={0} value={productForm.price_per_unit} onChange={e => setProductForm({...productForm, price_per_unit: Number(e.target.value)})} placeholder="0" />
                </div>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Description</label>
                  <textarea className="hub-input" value={productForm.description} onChange={e => setProductForm({...productForm, description: e.target.value})} rows={2} style={{ resize: 'vertical' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowProductModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Mouvement */}
      {showMovementModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowMovementModal(false)}>
          <div className="modal-box">
            <div className="modal-title">{movementForm.type === 'IN' ? '↑ Entrée de stock' : '↓ Sortie de stock'}</div>
            <form onSubmit={saveMovement}>
              <div className="hub-form-group">
                <label>Type de mouvement</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['IN', 'OUT'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setMovementForm({...movementForm, type: t})}
                      style={{ flex: 1, padding: '10px', borderRadius: 8, border: '2px solid', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
                        borderColor: movementForm.type === t ? (t === 'IN' ? '#065f46' : '#991b1b') : '#ddd',
                        background: movementForm.type === t ? (t === 'IN' ? '#ecfdf5' : '#fef2f2') : 'white',
                        color: movementForm.type === t ? (t === 'IN' ? '#065f46' : '#991b1b') : '#666' }}>
                      {t === 'IN' ? '↑ Entrée' : '↓ Sortie'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="hub-form-group">
                <label>Produit *</label>
                <select className="hub-select" value={movementForm.product_id} onChange={e => setMovementForm({...movementForm, product_id: e.target.value})} required>
                  <option value="">-- Sélectionner --</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (stock: {p.quantity} {p.unit})</option>)}
                </select>
              </div>
              <div className="hub-form-group">
                <label>Quantité *</label>
                <input className="hub-input" type="number" min={1} value={movementForm.quantity || ''} onChange={e => setMovementForm({...movementForm, quantity: Number(e.target.value)})} required />
              </div>
              <div className="hub-form-group">
                <label>Date</label>
                <input className="hub-input" type="date" value={movementForm.date} onChange={e => setMovementForm({...movementForm, date: e.target.value})} />
              </div>
              <div className="hub-form-group">
                <label>Motif / Référence</label>
                <input className="hub-input" value={movementForm.reason} onChange={e => setMovementForm({...movementForm, reason: e.target.value})} placeholder="Ex: Commande #001, Vente client..." />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowMovementModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
