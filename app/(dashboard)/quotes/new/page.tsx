'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Client, Product } from '@/types'
import { useToast } from '@/components/ui/Toast'

const UNITS = ['kg', 'g', 'L', 'ml', 'carton', 'sac', 'pièce', 'heure', 'forfait', 'unité']

interface LineItem { product_id: string | null; name: string; description: string; quantity: number; unit: string; unit_price: number }
const emptyLine = (): LineItem => ({ product_id: null, name: '', description: '', quantity: 1, unit: 'kg', unit_price: 0 })

export default function NewQuotePage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const [form, setForm] = useState({
    title: '', client_id: '', client_name: '',
    date: new Date().toISOString().split('T')[0],
    due_date: new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0],
    discount: 0, tax_rate: 18, notes: '', payment_terms: '30 jours',
  })
  const [items, setItems] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0)
  const afterDiscount = subtotal - (form.discount || 0)
  const taxAmount = afterDiscount * form.tax_rate / 100
  const total = afterDiscount + taxAmount

  useEffect(() => {
    async function init() {
      const [{ data: c }, { data: p }] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        supabase.from('products').select('*').order('name'),
      ])
      setClients(c || [])
      setProducts(p || [])
    }
    init()
  }, [])

  async function handleSave(targetStatus: 'draft' | 'pending') {
    const validItems = items.filter(it => it.name.trim() && it.quantity > 0)
    if (validItems.length === 0) { toast('warning', 'Ajoutez au moins une ligne.'); return }
    setSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { data: numData } = await supabase.rpc('generate_document_number', { p_type: 'devis' })

      const { data: doc, error } = await supabase.from('documents').insert({
        document_number: numData,
        title: form.title || `Devis ${numData}`,
        type: 'devis',
        status: targetStatus,
        client_id: form.client_id || null,
        due_date: form.due_date || null,
        total_amount: total, discount: form.discount, tax_rate: form.tax_rate, tax_amount: taxAmount,
        payment_terms: form.payment_terms, content: { notes: form.notes },
        created_by: userData.user?.id,
      }).select('id').single()
      if (error || !doc) throw new Error(error?.message || 'Erreur création')

      await supabase.from('document_items').insert(
        validItems.map((it, idx) => ({ ...it, document_id: doc.id, sort_order: idx }))
      )

      if (targetStatus === 'pending') {
        try {
          await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'quote_pending',
              title: `Devis ${numData} en attente`,
              message: `Devis ${form.title || numData} pour ${form.client_name || 'client non defini'} — ${total.toLocaleString('fr-FR')} FCFA`,
              referenceId: doc.id,
              referenceType: 'quote',
              link: `/quotes/${doc.id}`,
            }),
          })
        } catch { /* best-effort */ }
      }

      router.push(`/quotes/${doc.id}`)
    } catch (err: unknown) {
      toast('error', 'Erreur: ' + (err instanceof Error ? err.message : String(err)))
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
          <h2>📝 Nouveau Devis</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="btn-ghost" onClick={() => handleSave('draft')} disabled={saving}>💾 Brouillon</button>
          <button type="button" className="btn-amber" onClick={() => handleSave('pending')} disabled={saving}>📤 Soumettre</button>
        </div>
      </div>

      <div className="invoice-page__body">
        <div className="invoice-form__layout">
          {/* Colonne principale */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Infos devis */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>📋 Informations Devis</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Titre du devis</label>
                  <input className="hub-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Devis fourniture céréales" />
                </div>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Conditions de paiement</label>
                  <select className="hub-select" value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))}>
                    {['Immédiat', '7 jours', '15 jours', '30 jours', '45 jours', '60 jours'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Date</label>
                  <input className="hub-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Validité (échéance)</label>
                  <input className="hub-input" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Client */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>👥 Client</div>
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
                        {c.email && <div style={{ fontSize: '0.75rem', color: '#666' }}>{c.email}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {form.client_id && (
                <div style={{ marginTop: 10, padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>✅ <strong>{form.client_name}</strong></span>
                  <button type="button" onClick={() => { setForm(f => ({ ...f, client_id: '', client_name: '' })); setClientSearch('') }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>✕</button>
                </div>
              )}
            </div>

            {/* Lignes */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>
                <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📦 Lignes du Devis</div>
                <button type="button" className="btn-ghost" style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={addLine}>+ Ajouter ligne</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 8, padding: '0 4px' }}>
                {['Produit / Service', 'Désignation', 'Qté', 'Prix unit.', 'Total', ''].map(h => (
                  <div key={h} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</div>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((item, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'flex-start', background: '#fafaf7', borderRadius: 8, padding: '10px' }}>
                    <div>
                      <select className="hub-select" value={item.product_id || ''} onChange={e => updateItem(idx, 'product_id', e.target.value || null)}>
                        <option value="">— Produit catalogue —</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit}) — {Number(p.price_per_unit || 0).toLocaleString()} FCFA</option>)}
                      </select>
                      <input className="hub-input" style={{ marginTop: 4 }} placeholder="Nom..." value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)} />
                    </div>
                    <input className="hub-input" placeholder="Description..." value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                    <div>
                      <input className="hub-input" type="number" min={0} step="0.01" value={item.quantity} onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                      <select className="hub-select" style={{ marginTop: 4 }} value={item.unit} onChange={e => updateItem(idx, 'unit', e.target.value)}>
                        {UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <input className="hub-input" type="number" min={0} value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} />
                      <div style={{ fontSize: '0.7rem', color: '#999', marginTop: 2, textAlign: 'right' }}>FCFA</div>
                    </div>
                    <div style={{ textAlign: 'right', fontWeight: 700, color: 'var(--hub-green)', paddingTop: 8, fontSize: '0.9rem' }}>
                      {(item.quantity * item.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
                      <div style={{ fontSize: '0.7rem', color: '#999', fontWeight: 400 }}>FCFA</div>
                    </div>
                    <button type="button" onClick={() => removeLine(idx)} disabled={items.length === 1}
                      style={{ background: items.length === 1 ? '#f0ece4' : '#fee2e2', border: 'none', color: items.length === 1 ? '#ccc' : '#dc2626', borderRadius: 6, padding: '6px 10px', cursor: items.length === 1 ? 'not-allowed' : 'pointer', fontSize: '0.85rem', marginTop: 4 }}>✕</button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-ghost" style={{ width: '100%', marginTop: 12, padding: '10px', justifyContent: 'center' }} onClick={addLine}>+ Ajouter une ligne</button>
            </div>

            {/* Notes */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>💬 Notes</div>
              <textarea className="hub-input" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Conditions particulières..." style={{ resize: 'vertical' }} />
            </div>
          </div>

          {/* Colonne résumé */}
          <div style={{ position: 'sticky', top: 80 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div style={{ background: 'var(--hub-green)', color: 'white', padding: '16px 20px' }}>
                <div style={{ fontSize: '0.75rem', opacity: 0.7, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Résumé Devis</div>
              </div>
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', paddingBottom: 8, borderBottom: '1px solid #f0ece4' }}>
                    <span style={{ color: '#666' }}>Sous-total HT</span>
                    <span style={{ fontWeight: 600 }}>{subtotal.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', paddingBottom: 8, borderBottom: '1px solid #f0ece4' }}>
                    <span style={{ color: '#666' }}>Remise</span>
                    <input className="hub-input" type="number" min={0} value={form.discount} onChange={e => setForm(f => ({ ...f, discount: parseFloat(e.target.value) || 0 }))} style={{ width: 96, textAlign: 'right' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', paddingBottom: 8, borderBottom: '1px solid #f0ece4' }}>
                    <span style={{ color: '#666' }}>TVA</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input className="hub-input" type="number" min={0} max={100} value={form.tax_rate} onChange={e => setForm(f => ({ ...f, tax_rate: parseFloat(e.target.value) || 0 }))} style={{ width: 58, textAlign: 'center' }} />
                      <span style={{ color: '#666', fontSize: '0.875rem' }}>%</span>
                    </div>
                  </div>
                  <div style={{ background: 'var(--hub-green)', color: 'white', borderRadius: 8, padding: '14px 16px', marginTop: 4 }}>
                    <div style={{ fontSize: '0.7rem', opacity: 0.7, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Total TTC</div>
                    <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.6rem', fontWeight: 800 }}>{total.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>FCFA</div>
                  </div>
                </div>
                <div style={{ marginTop: 14, fontSize: '0.8rem', color: '#666', textAlign: 'center' }}>
                  {items.filter(it => it.name).length} ligne(s) · {form.client_name || 'Pas de client'}
                </div>
              </div>
            </div>

            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px', marginTop: 16 }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Actions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button type="button" className="btn-ghost" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => handleSave('draft')} disabled={saving}>
                  {saving ? '⏳ Sauvegarde...' : '💾 Enregistrer en brouillon'}
                </button>
                <button type="button" className="btn-amber" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => handleSave('pending')} disabled={saving}>
                  {saving ? '⏳ Sauvegarde...' : '📤 Soumettre au client'}
                </button>
              </div>
              <div style={{ marginTop: 12, padding: '8px 10px', background: '#f8f5ee', borderRadius: 6, fontSize: '0.72rem', color: '#666' }}>
                ℹ️ Un devis accepté pourra être converti en facture en un clic.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
