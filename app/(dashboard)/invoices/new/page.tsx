'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Client, Product } from '@/types'

const UNITS = ['kg', 'g', 'L', 'ml', 'carton', 'sac', 'pièce', 'heure', 'forfait', 'unité']

interface LineItem {
  id?: string
  product_id: string | null
  name: string
  description: string
  quantity: number
  unit: string
  unit_price: number
  tax_rate: number
}

const emptyLine = (): LineItem => ({
  product_id: null, name: '', description: '',
  quantity: 1, unit: 'kg', unit_price: 0, tax_rate: 18
})

export default function NewInvoicePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const duplicateId = searchParams.get('duplicate')

  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)

  const [form, setForm] = useState({
    invoice_number: '',
    client_id: '',
    client_name: '',
    date: new Date().toISOString().split('T')[0],
    due_date: new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0],
    status: 'draft' as const,
    discount: 0,
    tax_rate: 18,
    notes: '',
    payment_terms: '30 jours',
  })
  const [items, setItems] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [draftId, setDraftId] = useState<string | null>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSaving = useRef(false)
  const autoSaveAbort = useRef(false)
  const supabase = createClient()

  // Calculs live
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0)
  const afterDiscount = subtotal - (form.discount || 0)
  const taxAmount = afterDiscount * form.tax_rate / 100
  const total = afterDiscount + taxAmount

  // Charger données init
  useEffect(() => {
    async function init() {
      const [{ data: c }, { data: p }, { data: numData }] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        supabase.from('products').select('*').order('name'),
        supabase.rpc('generate_invoice_number'),
      ])
      setClients(c || [])
      setProducts(p || [])
      if (numData) setForm(f => ({ ...f, invoice_number: numData }))

      // Duplication
      if (duplicateId) {
        const [{ data: orig }, { data: origItems }] = await Promise.all([
          supabase.from('invoices').select('*, client:clients(name)').eq('id', duplicateId).single(),
          supabase.from('invoice_items').select('*').eq('invoice_id', duplicateId).order('sort_order'),
        ])
        if (orig) {
          setForm(f => ({
            ...f,
            client_id: orig.client_id || '',
            client_name: orig.client?.name || '',
            discount: orig.discount || 0,
            tax_rate: orig.tax_rate || 18,
            notes: orig.notes || '',
            payment_terms: orig.payment_terms || '30 jours',
          }))
          setClientSearch(orig.client?.name || '')
          if (origItems && origItems.length > 0) {
            setItems(origItems.map((it: any) => ({
              product_id: it.product_id || null,
              name: it.name,
              description: it.description || '',
              quantity: it.quantity,
              unit: it.unit || 'kg',
              unit_price: it.unit_price,
              tax_rate: it.tax_rate || 18,
            })))
          }
        }
      }
    }
    init()
  }, [duplicateId])

  // Auto-save debounced
  useEffect(() => {
    if (!form.client_id && items.every(it => !it.name)) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      autoSave()
    }, 2000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [form, items])

  async function autoSave() {
    if (isSaving.current) return
    if (!form.invoice_number) return
    autoSaveAbort.current = false
    setAutoSaveStatus('saving')
    const { data: userData } = await supabase.auth.getUser()
    const payload = {
      invoice_number: form.invoice_number,
      client_id: form.client_id || null,
      date: form.date,
      due_date: form.due_date || null,
      status: 'draft',
      subtotal, discount: form.discount, tax_rate: form.tax_rate,
      tax_amount: taxAmount, total,
      notes: form.notes, payment_terms: form.payment_terms,
      created_by: userData.user?.id,
    }
    if (draftId) {
      await supabase.from('invoices').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', draftId)
      // Sync items
      await supabase.from('invoice_items').delete().eq('invoice_id', draftId)
      const validItems = items.filter(it => it.name && it.quantity > 0)
      if (validItems.length > 0) {
        if (autoSaveAbort.current) return
        await supabase.from('invoice_items').insert(
          validItems.map((it, idx) => ({ ...it, invoice_id: draftId, sort_order: idx }))
        )
      }
    } else {
      const { data: newDraft } = await supabase.from('invoices').insert(payload).select().single()
      if (newDraft) {
        setDraftId(newDraft.id)
        const validItems = items.filter(it => it.name && it.quantity > 0)
        if (validItems.length > 0) {
          if (autoSaveAbort.current) return
          await supabase.from('invoice_items').insert(
            validItems.map((it, idx) => ({ ...it, invoice_id: newDraft.id, sort_order: idx }))
          )
        }
      }
    }
    setAutoSaveStatus('saved')
    setTimeout(() => setAutoSaveStatus('idle'), 3000)
  }

  function selectClient(client: Client) {
    setForm(f => ({ ...f, client_id: client.id, client_name: client.name }))
    setClientSearch(client.name)
    setShowClientDropdown(false)
  }

  function updateItem(idx: number, field: keyof LineItem, value: string | number | null) {
    const updated = [...items]
    updated[idx] = { ...updated[idx], [field]: value }
    // Auto-remplissage depuis le produit sélectionné
    if (field === 'product_id' && value) {
      const p = products.find(p => p.id === value)
      if (p) {
        updated[idx].name = p.name
        updated[idx].unit_price = p.price_per_unit || 0
        updated[idx].unit = p.unit || 'kg'
      }
    }
    setItems(updated)
  }

  function addLine() { setItems([...items, emptyLine()]) }
  function removeLine(idx: number) { if (items.length > 1) setItems(items.filter((_, i) => i !== idx)) }

  async function handleSave(targetStatus: 'draft' | 'pending' | 'paid') {
    if (isSaving.current) return
    if (!form.invoice_number) return
    const validItems = items.filter(it => it.name && it.quantity > 0 && it.unit_price >= 0)
    if (validItems.length === 0) { alert('Ajoutez au moins une ligne valide'); return }

    autoSaveAbort.current = true
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    isSaving.current = true
    setSaving(true)
    const { data: userData } = await supabase.auth.getUser()
    const payload = {
      invoice_number: form.invoice_number,
      client_id: form.client_id || null,
      date: form.date,
      due_date: form.due_date || null,
      status: targetStatus,
      subtotal, discount: form.discount, tax_rate: form.tax_rate,
      tax_amount: taxAmount, total,
      notes: form.notes, payment_terms: form.payment_terms,
      created_by: userData.user?.id,
      ...(targetStatus === 'paid' ? { validated_by: userData.user?.id } : {}),
    }
    let invoiceId = draftId
    if (invoiceId) {
      await supabase.from('invoices').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', invoiceId)
      await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId)
    } else {
      const { data: newInv } = await supabase.from('invoices').insert(payload).select().single()
      if (!newInv) { setSaving(false); return }
      invoiceId = newInv.id
    }
    await supabase.from('invoice_items').insert(
      validItems.map((it, idx) => ({ ...it, invoice_id: invoiceId!, sort_order: idx }))
    )
    setSaving(false)
    isSaving.current = false
    router.push(`/invoices/${invoiceId}`)
  }

  const filteredClients = clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))

  return (
    <div className="invoice-page invoice-page--create">
      <div className="page-header invoice-page__toolbar">
        <div className="invoice-page__header-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="invoice-btn invoice-btn--back" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>🧾 Nouvelle Facture</h2>
          {duplicateId && <span className="badge badge-blue">📋 Duplication</span>}
        </div>
        <div className="invoice-page__header-actions" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {autoSaveStatus === 'saving' && <span className="invoice-autosave-status invoice-autosave-status--saving" style={{ fontSize: '0.78rem', color: '#999' }}>💾 Sauvegarde...</span>}
          {autoSaveStatus === 'saved' && <span className="invoice-autosave-status invoice-autosave-status--saved" style={{ fontSize: '0.78rem', color: '#065f46' }}>✓ Sauvegardé</span>}
          <button type="button" className="btn-ghost invoice-btn invoice-btn--save-draft" onClick={() => handleSave('draft')} disabled={saving}>💾 Brouillon</button>
          <button type="button" className="btn-amber invoice-btn invoice-btn--submit" onClick={() => handleSave('pending')} disabled={saving}>📤 Soumettre</button>
          <button type="button" className="btn-primary invoice-btn invoice-btn--validate-paid" onClick={() => handleSave('paid')} disabled={saving}>✅ Valider & Payer</button>
        </div>
      </div>

      <div className="invoice-page__body" style={{ padding: '24px 32px', maxWidth: 1000, margin: '0 auto' }}>
        <div className="invoice-page__layout" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>

          {/* Colonne principale */}
          <div className="invoice-page__main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* En-tête facture */}
            <div className="invoice-section invoice-section--meta" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div className="invoice-section__header">
                <div className="invoice-section__title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>
                  📋 Informations Facture
                </div>
              </div>
              <div className="invoice-section__body invoice-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="hub-form-group">
                  <label>N° Facture</label>
                  <input className="hub-input invoice-field invoice-field--readonly invoice-field--invoice-number" value={form.invoice_number} readOnly
                    style={{ background: '#f8f5ee', fontFamily: 'monospace', fontWeight: 700, color: 'var(--hub-green)' }} />
                </div>
                <div className="hub-form-group">
                  <label>Statut</label>
                  <div className="invoice-field-hint" style={{ padding: '10px 14px', background: '#f8f5ee', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, color: 'var(--hub-green-mid)' }}>
                    ✏️ Brouillon — sera défini à la sauvegarde
                  </div>
                </div>
                <div className="hub-form-group">
                  <label>Date de facturation</label>
                  <input className="hub-input invoice-field invoice-field--date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="hub-form-group">
                  <label>Date d'échéance</label>
                  <input className="hub-input invoice-field invoice-field--due-date" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Sélection client */}
            <div className="invoice-section invoice-section--client" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div className="invoice-section__header">
                <div className="invoice-section__title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>
                  👥 Client
                </div>
              </div>
              <div className="invoice-client-picker" style={{ position: 'relative' }}>
                <input className="hub-input invoice-field invoice-field--search-client" placeholder="🔍 Rechercher un client..."
                  value={clientSearch}
                  onChange={e => { setClientSearch(e.target.value); setShowClientDropdown(true) }}
                  onFocus={() => setShowClientDropdown(true)}
                  onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                />
                {showClientDropdown && filteredClients.length > 0 && (
                  <div className="invoice-client-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid var(--hub-green-mid)', borderRadius: '0 0 10px 10px', zIndex: 50, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                    {filteredClients.map(c => (
                      <div key={c.id} className="invoice-client-option" role="option" onMouseDown={() => selectClient(c)}
                        style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #f0ece4', transition: 'background 0.1s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f0f9f5')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        {c.email && <div style={{ fontSize: '0.75rem', color: '#666' }}>{c.email}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {form.client_id && (
                <div className="invoice-client-selected" style={{ marginTop: 10, padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>✅ <strong>{form.client_name}</strong> sélectionné</span>
                  <button type="button" className="invoice-btn invoice-btn--clear-client" onClick={() => { setForm(f => ({ ...f, client_id: '', client_name: '' })); setClientSearch('') }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: '0.8rem' }}>✕</button>
                </div>
              )}
            </div>

            {/* Lignes de facture */}
            <div className="invoice-section invoice-section--lines" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div className="invoice-section__header invoice-line-items__toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>
                <div className="invoice-section__title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  📦 Lignes de Facture
                </div>
                <button type="button" className="btn-ghost invoice-btn invoice-btn--add-line" style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={addLine}>+ Ajouter ligne</button>
              </div>

              {/* En-tête colonnes */}
              <div className="invoice-line-items__head invoice-form-grid invoice-form-grid--lines" style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 8, padding: '0 4px' }}>
                {['Produit / Service', 'Désignation', 'Qté', 'Prix unit.', 'Total', ''].map(h => (
                  <div key={h} className="invoice-line-items__col-label" style={{ fontSize: '0.7rem', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</div>
                ))}
              </div>

              <div className="invoice-line-items" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((item, idx) => (
                  <div key={idx} className="invoice-line-item invoice-form-grid invoice-form-grid--lines" style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'flex-start', background: '#fafaf7', borderRadius: 8, padding: '10px' }}>
                    {/* Sélecteur produit */}
                    <div className="invoice-line-item__product">
                      <select className="hub-select invoice-field invoice-field--product" style={{ fontSize: '0.82rem' }}
                        value={item.product_id || ''}
                        onChange={e => updateItem(idx, 'product_id', e.target.value || null)}>
                        <option value="">— Produit catalogue —</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.unit}) — {Number(p.price_per_unit || 0).toLocaleString()} FCFA</option>
                        ))}
                      </select>
                      <input className="hub-input invoice-field invoice-field--line-name" style={{ marginTop: 4, fontSize: '0.82rem' }}
                        placeholder="Nom libre..."
                        value={item.name}
                        onChange={e => updateItem(idx, 'name', e.target.value)} />
                    </div>

                    {/* Description */}
                    <input className="hub-input invoice-field invoice-field--description" style={{ fontSize: '0.82rem' }}
                      placeholder="Description..."
                      value={item.description}
                      onChange={e => updateItem(idx, 'description', e.target.value)} />

                    {/* Quantité + unité */}
                    <div className="invoice-line-item__qty">
                      <input className="hub-input invoice-field invoice-field--quantity" type="number" min={0} step="0.01" style={{ fontSize: '0.82rem' }}
                        value={item.quantity}
                        onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                      <select className="hub-select invoice-field invoice-field--unit" style={{ marginTop: 4, fontSize: '0.78rem' }}
                        value={item.unit}
                        onChange={e => updateItem(idx, 'unit', e.target.value)}>
                        {UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>

                    {/* Prix unitaire */}
                    <div className="invoice-line-item__unit-price">
                      <input className="hub-input invoice-field invoice-field--unit-price" type="number" min={0} style={{ fontSize: '0.82rem' }}
                        value={item.unit_price}
                        onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} />
                      <div style={{ fontSize: '0.7rem', color: '#999', marginTop: 2, textAlign: 'right' }}>FCFA</div>
                    </div>

                    {/* Sous-total calculé */}
                    <div className="invoice-line-item__line-total" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--hub-green)', paddingTop: 8, fontSize: '0.9rem' }}>
                      {(item.quantity * item.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
                      <div style={{ fontSize: '0.7rem', color: '#999', fontWeight: 400 }}>FCFA</div>
                    </div>

                    {/* Supprimer */}
                    <button type="button" className="invoice-btn invoice-btn--remove-line" onClick={() => removeLine(idx)} disabled={items.length === 1}
                      style={{ background: items.length === 1 ? '#f0ece4' : '#fee2e2', border: 'none', color: items.length === 1 ? '#ccc' : '#dc2626', borderRadius: 6, padding: '6px 10px', cursor: items.length === 1 ? 'not-allowed' : 'pointer', fontSize: '0.85rem', marginTop: 4 }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <button type="button" className="btn-ghost invoice-btn invoice-btn--add-line-full" style={{ width: '100%', marginTop: 12, padding: '10px', justifyContent: 'center', fontSize: '0.875rem' }} onClick={addLine}>
                + Ajouter une ligne
              </button>
            </div>

            {/* Notes */}
            <div className="invoice-section invoice-section--notes" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div className="invoice-section__title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>💬 Notes & Conditions</div>
              <div className="invoice-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="hub-form-group">
                  <label>Conditions de paiement</label>
                  <select className="hub-select invoice-field invoice-field--payment-terms" value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })}>
                    {['Immédiat', '7 jours', '15 jours', '30 jours', '45 jours', '60 jours'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Notes internes</label>
                  <textarea className="hub-input invoice-field invoice-field--notes" rows={2} value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    placeholder="Informations complémentaires..."
                    style={{ resize: 'vertical' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Colonne droite — Résumé */}
          <div className="invoice-page__aside" style={{ position: 'sticky', top: 80 }}>
            <div className="invoice-section invoice-section--summary-card" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div className="invoice-summary-card__header" style={{ background: 'var(--hub-green)', color: 'white', padding: '16px 20px' }}>
                <div style={{ fontSize: '0.75rem', opacity: 0.7, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Résumé</div>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 700 }}>{form.invoice_number || '—'}</div>
              </div>
              <div className="invoice-summary-card__body" style={{ padding: '20px' }}>
                {/* Lignes résumé */}
                <div className="invoice-summary-rows" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', paddingBottom: 8, borderBottom: '1px solid #f0ece4' }}>
                    <span style={{ color: '#666' }}>Sous-total HT</span>
                    <span style={{ fontWeight: 600 }}>{subtotal.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span>
                  </div>

                  {/* Remise */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', paddingBottom: 8, borderBottom: '1px solid #f0ece4' }}>
                    <span style={{ color: '#666' }}>Remise</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input className="invoice-field invoice-field--discount" type="number" min={0} value={form.discount}
                        onChange={e => setForm({ ...form, discount: parseFloat(e.target.value) || 0 })}
                        style={{ width: 80, padding: '4px 8px', border: '1.5px solid #ddd', borderRadius: 6, fontSize: '0.82rem', textAlign: 'right' }} />
                      <span style={{ fontSize: '0.75rem', color: '#999' }}>FCFA</span>
                    </div>
                  </div>

                  {/* TVA */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', paddingBottom: 8, borderBottom: '1px solid #f0ece4' }}>
                    <span style={{ color: '#666' }}>TVA</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input className="invoice-field invoice-field--tax-rate" type="number" min={0} max={100} value={form.tax_rate}
                        onChange={e => setForm({ ...form, tax_rate: parseFloat(e.target.value) || 0 })}
                        style={{ width: 50, padding: '4px 6px', border: '1.5px solid #ddd', borderRadius: 6, fontSize: '0.82rem', textAlign: 'center' }} />
                      <span style={{ color: '#666', fontSize: '0.82rem' }}>% = {taxAmount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span>
                    </div>
                  </div>

                  {/* Total TTC */}
                  <div style={{ background: 'var(--hub-green)', color: 'white', borderRadius: 8, padding: '14px 16px', marginTop: 4 }}>
                    <div style={{ fontSize: '0.7rem', opacity: 0.7, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Total TTC</div>
                    <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.6rem', fontWeight: 800 }}>
                      {total.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
                    </div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>FCFA</div>
                  </div>
                </div>

                {/* Lignes count */}
                <div className="invoice-summary-footer" style={{ marginTop: 14, fontSize: '0.8rem', color: '#666', textAlign: 'center' }}>
                  {items.filter(it => it.name).length} ligne(s) · {form.client_name || 'Pas de client'}
                </div>
              </div>
            </div>

            {/* Actions carte */}
            <div className="invoice-section invoice-section--actions-aside" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px', marginTop: 16 }}>
              <div className="invoice-section__title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Actions</div>
              <div className="invoice-aside-actions" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button type="button" className="btn-ghost invoice-btn invoice-btn--save-draft-aside" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => handleSave('draft')} disabled={saving}>
                  💾 Enregistrer en brouillon
                </button>
                <button type="button" className="btn-amber invoice-btn invoice-btn--submit-aside" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => handleSave('pending')} disabled={saving}>
                  📤 Soumettre pour validation
                </button>
                <button type="button" className="btn-primary invoice-btn invoice-btn--validate-paid-aside" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => handleSave('paid')} disabled={saving}>
                  ✅ Valider & Marquer Payée
                </button>
              </div>
              <div className="invoice-aside-hint" style={{ marginTop: 12, padding: '8px 10px', background: '#f8f5ee', borderRadius: 6, fontSize: '0.72rem', color: '#666' }}>
                ⚠️ La validation décrémente le stock automatiquement et génère la facture définitive.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
