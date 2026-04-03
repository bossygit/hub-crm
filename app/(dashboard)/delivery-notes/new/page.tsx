'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Client, Product } from '@/types'

const UNITS = ['kg', 'g', 'L', 'ml', 'carton', 'sac', 'pièce', 'heure', 'forfait', 'unité']
interface LineItem { product_id: string | null; name: string; description: string; quantity: number; unit: string; unit_price: number }
const emptyLine = (): LineItem => ({ product_id: null, name: '', description: '', quantity: 1, unit: 'kg', unit_price: 0 })

export default function NewDeliveryNotePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const invoiceId = searchParams.get('invoice_id')

  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const [form, setForm] = useState({ title: '', client_id: '', client_name: '', invoice_id: invoiceId || '', invoice_number: '', notes: '' })
  const [items, setItems] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    async function init() {
      const [{ data: c }, { data: p }] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        supabase.from('products').select('*').order('name'),
      ])
      setClients(c || [])
      setProducts(p || [])

      if (invoiceId) {
        const [{ data: inv }, { data: invItems }] = await Promise.all([
          supabase.from('invoices').select('*, client:clients(name)').eq('id', invoiceId).single(),
          supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId).order('sort_order'),
        ])
        if (inv) {
          setForm(f => ({ ...f, client_id: inv.client_id || '', client_name: (inv.client as any)?.name || '', invoice_id: inv.id, invoice_number: inv.invoice_number, title: `BL — ${inv.invoice_number}` }))
          setClientSearch((inv.client as any)?.name || '')
          if (invItems && invItems.length > 0) {
            setItems(invItems.map((it: any) => ({ product_id: it.product_id || null, name: it.name, description: it.description || '', quantity: it.quantity, unit: it.unit || 'kg', unit_price: it.unit_price })))
          }
        }
      }
    }
    init()
  }, [invoiceId])

  async function handleSave(targetStatus: 'draft' | 'pending') {
    const validItems = items.filter(it => it.name.trim() && it.quantity > 0)
    if (validItems.length === 0) { alert('Ajoutez au moins une ligne.'); return }
    setSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { data: numData } = await supabase.rpc('generate_document_number', { p_type: 'bon_livraison' })
      const { data: doc, error } = await supabase.from('documents').insert({
        document_number: numData,
        title: form.title || `Bon de livraison ${numData}`,
        type: 'bon_livraison',
        status: targetStatus,
        client_id: form.client_id || null,
        invoice_id: form.invoice_id || null,
        content: { notes: form.notes },
        created_by: userData.user?.id,
      }).select('id').single()
      if (error || !doc) throw new Error(error?.message || 'Erreur')
      await supabase.from('document_items').insert(
        validItems.map((it, idx) => ({ ...it, document_id: doc.id, sort_order: idx }))
      )

      if (targetStatus === 'pending') {
        try {
          await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'bl_pending',
              title: `BL ${numData} en attente`,
              message: `Bon de livraison ${form.title || numData} pour ${form.client_name || 'client non defini'}`,
              referenceId: doc.id,
              referenceType: 'delivery_note',
              link: `/delivery-notes/${doc.id}`,
            }),
          })
        } catch { /* best-effort */ }
      }

      router.push(`/delivery-notes/${doc.id}`)
    } catch (err: unknown) {
      alert('Erreur: ' + (err instanceof Error ? err.message : String(err)))
    } finally { setSaving(false) }
  }

  function selectClient(c: Client) { setForm(f => ({ ...f, client_id: c.id, client_name: c.name })); setClientSearch(c.name); setShowClientDropdown(false) }
  function updateItem(idx: number, field: keyof LineItem, value: string | number | null) {
    setItems(prev => {
      const u = [...prev]; u[idx] = { ...u[idx], [field]: value }
      if (field === 'product_id' && value) { const p = products.find(pr => pr.id === value); if (p) { u[idx].name = p.name; u[idx].unit_price = p.price_per_unit || 0; u[idx].unit = p.unit || 'kg' } }
      return u
    })
  }
  function addLine() { setItems(prev => [...prev, emptyLine()]) }
  function removeLine(idx: number) { if (items.length > 1) setItems(prev => prev.filter((_, i) => i !== idx)) }
  const filteredClients = clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))

  return (
    <div className="invoice-page invoice-page--new">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>🚚 Nouveau Bon de Livraison</h2>
          {form.invoice_number && <span className="badge badge-blue">📎 {form.invoice_number}</span>}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" className="btn-ghost" onClick={() => handleSave('draft')} disabled={saving}>💾 Brouillon</button>
          <button type="button" className="btn-amber" onClick={() => handleSave('pending')} disabled={saving}>📤 Préparer livraison</button>
        </div>
      </div>

      <div className="invoice-page__body">
        <div className="invoice-form__layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Infos BL */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>📋 Informations</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Titre</label>
                  <input className="hub-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Livraison Restaurant Le Palmier" />
                </div>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Facture liée</label>
                  <input className="hub-input" value={form.invoice_number} readOnly style={{ background: '#f8f5ee', fontFamily: 'monospace' }} placeholder="Aucune" />
                </div>
              </div>
            </div>

            {/* Client */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>👥 Client / Destinataire</div>
              <div style={{ position: 'relative' }}>
                <input className="hub-input" placeholder="🔍 Rechercher un client..." value={clientSearch}
                  onChange={e => { setClientSearch(e.target.value); setShowClientDropdown(true) }}
                  onFocus={() => setShowClientDropdown(true)} onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)} />
                {showClientDropdown && filteredClients.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid var(--hub-green-mid)', borderRadius: '0 0 10px 10px', zIndex: 50, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                    {filteredClients.map(c => (
                      <div key={c.id} onMouseDown={() => selectClient(c)} style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #f0ece4' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#f0f9f5' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'white' }}>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {form.client_id && (
                <div style={{ marginTop: 10, padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>✅ <strong>{form.client_name}</strong></span>
                  <button type="button" onClick={() => { setForm(f => ({ ...f, client_id: '', client_name: '' })); setClientSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>✕</button>
                </div>
              )}
            </div>

            {/* Lignes */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>
                <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📦 Articles à livrer</div>
                <button type="button" className="btn-ghost" style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={addLine}>+ Ajouter</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr auto', gap: 8, marginBottom: 8 }}>
                {['Produit', 'Description', 'Qté', 'Unité', ''].map(h => <div key={h} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#999', textTransform: 'uppercase' }}>{h}</div>)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((item, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr auto', gap: 8, background: '#fafaf7', borderRadius: 8, padding: '10px', alignItems: 'flex-start' }}>
                    <div>
                      <select className="hub-select" value={item.product_id || ''} onChange={e => updateItem(idx, 'product_id', e.target.value || null)}>
                        <option value="">— Produit —</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
                      </select>
                      <input className="hub-input" style={{ marginTop: 4 }} placeholder="Nom..." value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)} />
                    </div>
                    <input className="hub-input" placeholder="Description..." value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                    <input className="hub-input" type="number" min={0} step="0.01" value={item.quantity} onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                    <select className="hub-select" value={item.unit} onChange={e => updateItem(idx, 'unit', e.target.value)}>
                      {UNITS.map(u => <option key={u}>{u}</option>)}
                    </select>
                    <button type="button" onClick={() => removeLine(idx)} disabled={items.length === 1}
                      style={{ background: items.length === 1 ? '#f0ece4' : '#fee2e2', border: 'none', color: items.length === 1 ? '#ccc' : '#dc2626', borderRadius: 6, padding: '6px 10px', cursor: items.length === 1 ? 'not-allowed' : 'pointer' }}>✕</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>💬 Notes livraison</div>
              <textarea className="hub-input" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Adresse de livraison, instructions..." style={{ resize: 'vertical' }} />
            </div>
          </div>

          {/* Sidebar */}
          <div style={{ position: 'sticky', top: 80 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Résumé</div>
              <div style={{ fontSize: '0.875rem', color: '#666', lineHeight: 2 }}>
                <div>{items.filter(it => it.name).length} article(s)</div>
                <div>Client: {form.client_name || '—'}</div>
                {form.invoice_number && <div>Facture: {form.invoice_number}</div>}
              </div>
            </div>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px', marginTop: 16 }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Actions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button type="button" className="btn-ghost" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => handleSave('draft')} disabled={saving}>{saving ? '⏳...' : '💾 Brouillon'}</button>
                <button type="button" className="btn-amber" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => handleSave('pending')} disabled={saving}>{saving ? '⏳...' : '📤 Préparer livraison'}</button>
              </div>
              <div style={{ marginTop: 12, padding: '8px 10px', background: '#f8f5ee', borderRadius: 6, fontSize: '0.72rem', color: '#666' }}>
                ℹ️ La validation du BL (livraison confirmée) décrémentera automatiquement le stock.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
