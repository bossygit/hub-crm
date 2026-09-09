'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Client, Product } from '@/types'
import { useToast } from '@/components/ui/Toast'
import { suggestPurchaseBatchNumber } from '@/lib/purchases/receipt'
import { lineInBaseUnit, packsForProduct, unitsForProduct, type ProductPack } from '@/lib/stock/units'

const UNITS = ['kg', 'g', 'L', 'ml', 'carton', 'sac', 'pièce', 'tonne']

interface LineItem {
  product_id: string | null
  name: string
  quantity: number
  unit: string
  unit_price: number
  batch_number: string
  expiry_date: string
  production_date: string
}

const emptyLine = (): LineItem => ({
  product_id: null, name: '', quantity: 1, unit: 'kg', unit_price: 0,
  batch_number: '', expiry_date: '', production_date: '',
})

export default function NewPurchasePage() {
  const router = useRouter()
  const [suppliers, setSuppliers] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [packRows, setPackRows] = useState<(ProductPack & { product_id: string })[]>([])
  const [supplierSearch, setSupplierSearch] = useState('')
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false)
  const [form, setForm] = useState({
    supplier_id: '',
    supplier_name: '',
    date: new Date().toISOString().split('T')[0],
    notes: '',
  })
  const [items, setItems] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    async function init() {
      const [{ data: c }, { data: p }, { data: u }] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        supabase.from('products').select('*').order('name'),
        supabase.from('product_units').select('product_id, unit, factor'),
      ])
      setSuppliers((c || []).filter((x: Client) => x.type === 'fournisseur'))
      setProducts(p || [])
      setPackRows((u || []) as (ProductPack & { product_id: string })[])
    }
    init()
  }, [])

  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0)

  async function handleSave(targetStatus: 'draft' | 'pending' | 'approved') {
    const validItems = items.filter(it => it.name.trim() && it.quantity > 0).map(it => {
      const p = products.find(x => x.id === it.product_id)
      const converted = lineInBaseUnit({ ...it, description: '' }, p?.unit, packsForProduct(it.product_id, packRows))
      return { ...it, quantity: converted.quantity, unit: converted.unit, unit_price: converted.unit_price }
    })
    if (validItems.length === 0) { toast('warning', 'Ajoutez au moins une ligne.'); return }
    if (targetStatus === 'approved' && validItems.every(it => !it.product_id)) {
      toast('warning', 'Liez au moins un produit catalogue pour réceptionner le stock.')
      return
    }
    setSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { data: numData } = await supabase.rpc('generate_purchase_number')
      const purchaseNumber = numData as string
      const { data: doc, error } = await supabase.from('purchases').insert({
        purchase_number: purchaseNumber,
        supplier_id: form.supplier_id || null,
        date: form.date,
        status: 'draft',
        subtotal,
        notes: form.notes,
        created_by: userData.user?.id,
      }).select('id').single()
      if (error || !doc) throw new Error(error?.message || 'Erreur')

      const { error: itemsError } = await supabase.from('purchase_items').insert(
        validItems.map((it, idx) => ({
          purchase_id: doc.id,
          product_id: it.product_id || null,
          name: it.name,
          quantity: it.quantity,
          unit: it.unit || 'kg',
          unit_price: it.unit_price,
          batch_number: it.batch_number?.trim() || suggestPurchaseBatchNumber(purchaseNumber, idx),
          expiry_date: it.expiry_date || null,
          production_date: it.production_date || null,
          sort_order: idx,
        }))
      )
      if (itemsError) throw new Error(itemsError.message)

      if (targetStatus !== 'draft') {
        const extra: Record<string, unknown> = { status: targetStatus, updated_at: new Date().toISOString() }
        if (targetStatus === 'approved') extra.received_by = userData.user?.id
        const { error: upError } = await supabase.from('purchases').update(extra).eq('id', doc.id)
        if (upError) throw new Error(upError.message)
      }

      toast('success', targetStatus === 'approved' ? 'Réception enregistrée, stock mis à jour.' : 'Achat enregistré.')
      router.push(`/purchases/${doc.id}`)
    } catch (err: unknown) {
      toast('error', 'Erreur: ' + (err instanceof Error ? err.message : String(err)))
    } finally { setSaving(false) }
  }

  function selectSupplier(c: Client) {
    setForm(f => ({ ...f, supplier_id: c.id, supplier_name: c.name }))
    setSupplierSearch(c.name)
    setShowSupplierDropdown(false)
  }

  function updateItem(idx: number, field: keyof LineItem, value: string | number | null) {
    setItems(prev => {
      const u = [...prev]
      u[idx] = { ...u[idx], [field]: value as never }
      if (field === 'product_id' && value) {
        const p = products.find(pr => pr.id === value)
        if (p) { u[idx].name = p.name; u[idx].unit_price = p.price_per_unit || 0; u[idx].unit = p.unit || 'kg' }
      }
      return u
    })
  }

  function addLine() { setItems(prev => [...prev, emptyLine()]) }
  function removeLine(idx: number) { if (items.length > 1) setItems(prev => prev.filter((_, i) => i !== idx)) }

  const filteredSuppliers = suppliers.filter(c => c.name.toLowerCase().includes(supplierSearch.toLowerCase()))

  return (
    <div className="invoice-page invoice-page--new">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>🛒 Nouvelle réception</h2>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" className="btn-ghost" onClick={() => handleSave('draft')} disabled={saving}>💾 Brouillon</button>
          <button type="button" className="btn-amber" onClick={() => handleSave('pending')} disabled={saving}>📤 Commandé</button>
          <button type="button" className="btn-primary" onClick={() => handleSave('approved')} disabled={saving}>✅ Réceptionner</button>
        </div>
      </div>

      <div className="invoice-page__body">
        <div className="invoice-form__layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>📋 Fournisseur</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 14 }}>
                <div style={{ position: 'relative' }}>
                  <input className="hub-input" placeholder="🔍 Rechercher un fournisseur..." value={supplierSearch}
                    onChange={e => { setSupplierSearch(e.target.value); setShowSupplierDropdown(true) }}
                    onFocus={() => setShowSupplierDropdown(true)} onBlur={() => setTimeout(() => setShowSupplierDropdown(false), 200)} />
                  {showSupplierDropdown && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid var(--hub-green-mid)', borderRadius: '0 0 10px 10px', zIndex: 50, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                      {filteredSuppliers.map(c => (
                        <div key={c.id} onMouseDown={() => selectSupplier(c)} style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #f0ece4' }}>
                          <div style={{ fontWeight: 600 }}>{c.name}</div>
                        </div>
                      ))}
                      {filteredSuppliers.length === 0 && (
                        <div style={{ padding: '12px 16px', fontSize: '0.85rem', color: '#666' }}>
                          Aucun fournisseur.{' '}
                          <Link href="/clients">Créer une fiche type Fournisseur</Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <input className="hub-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
              </div>
              {form.supplier_id && (
                <div style={{ marginTop: 10, padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>✅ <strong>{form.supplier_name}</strong></span>
                  <button type="button" onClick={() => { setForm(f => ({ ...f, supplier_id: '', supplier_name: '' })); setSupplierSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>✕</button>
                </div>
              )}
            </div>

            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>
                <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📦 Matières / produits reçus</div>
                <button type="button" className="btn-ghost" style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={addLine}>+ Ajouter</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {items.map((item, idx) => (
                  <div key={idx} style={{ background: '#fafaf7', borderRadius: 8, padding: '12px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 8 }}>
                    <div>
                      <select className="hub-select" value={item.product_id || ''} onChange={e => updateItem(idx, 'product_id', e.target.value || null)}>
                        <option value="">— Produit catalogue —</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
                      </select>
                      <input className="hub-input" style={{ marginTop: 4 }} placeholder="Désignation..." value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)} />
                      <input className="hub-input" style={{ marginTop: 4 }} placeholder="N° lot (auto si vide)" value={item.batch_number} onChange={e => updateItem(idx, 'batch_number', e.target.value)} />
                    </div>
                    <div>
                      <input className="hub-input" type="number" min={0} step="0.01" value={item.quantity} onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                      <select className="hub-select" style={{ marginTop: 4 }} value={item.unit} onChange={e => updateItem(idx, 'unit', e.target.value)}>
                        {(item.product_id
                          ? unitsForProduct(products.find(p => p.id === item.product_id)?.unit || 'kg', packsForProduct(item.product_id, packRows))
                          : UNITS
                        ).map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                    <input className="hub-input" type="number" min={0} value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} />
                    <div>
                      <input className="hub-input" type="date" value={item.expiry_date} onChange={e => updateItem(idx, 'expiry_date', e.target.value)} title="Péremption" />
                      <input className="hub-input" style={{ marginTop: 4 }} type="date" value={item.production_date} onChange={e => updateItem(idx, 'production_date', e.target.value)} title="Production" />
                    </div>
                    <button type="button" onClick={() => removeLine(idx)} disabled={items.length === 1}
                      style={{ background: items.length === 1 ? '#f0ece4' : '#fee2e2', border: 'none', color: items.length === 1 ? '#ccc' : '#dc2626', borderRadius: 6, padding: '6px 10px', cursor: items.length === 1 ? 'not-allowed' : 'pointer', height: 36 }}>✕</button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>💬 Notes</div>
              <textarea className="hub-input" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Bon de livraison fournisseur, camion, etc." style={{ resize: 'vertical' }} />
            </div>
          </div>

          <div style={{ position: 'sticky', top: 80 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Résumé</div>
              <div style={{ fontSize: '0.875rem', color: '#666', lineHeight: 2 }}>
                <div>{items.filter(it => it.name).length} ligne(s)</div>
                <div>Fournisseur: {form.supplier_name || '—'}</div>
                <div style={{ fontWeight: 800, color: 'var(--hub-green)', fontSize: '1.1rem' }}>{subtotal.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</div>
              </div>
            </div>
            <div style={{ marginTop: 12, padding: '8px 10px', background: '#f8f5ee', borderRadius: 6, fontSize: '0.72rem', color: '#666' }}>
              Réceptionner crée un lot et une entrée de stock. Le n° de lot est généré si vous le laissez vide.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
