'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Client, Product } from '@/types'

const UNITS = ['kg', 'g', 'L', 'ml', 'carton', 'sac', 'pièce', 'heure', 'forfait', 'unité']

interface LineItem {
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
    discount: 0,
    tax_rate: 18,
    notes: '',
    payment_terms: '30 jours',
  })
  const [items, setItems] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  // ── REFS : évitent les stale closures dans les callbacks async ──
  // draftIdRef est TOUJOURS à jour même si le state React ne l'est pas encore
  const draftIdRef = useRef<string | null>(null)
  // Verrou : bloque l'auto-save pendant qu'un handleSave manuel tourne
  const isOperationInProgress = useRef(false)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const supabase = createClient()

  // Calculs live
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0)
  const afterDiscount = subtotal - (form.discount || 0)
  const taxAmount = afterDiscount * form.tax_rate / 100
  const total = afterDiscount + taxAmount

  // ── INIT ──
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

      if (duplicateId) {
        const [{ data: orig }, { data: origItems }] = await Promise.all([
          supabase.from('invoices').select('*, client:clients(name)').eq('id', duplicateId).single(),
          supabase.from('invoice_items').select('*').eq('invoice_id', duplicateId).order('sort_order'),
        ])
        if (orig) {
          setForm(f => ({
            ...f,
            client_id: orig.client_id || '',
            client_name: (orig.client as any)?.name || '',
            discount: orig.discount || 0,
            tax_rate: orig.tax_rate || 18,
            notes: orig.notes || '',
            payment_terms: orig.payment_terms || '30 jours',
          }))
          setClientSearch((orig.client as any)?.name || '')
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
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [duplicateId])

  // ── AUTO-SAVE debounce 3s ──
  // Écoute des champs individuels (pas `form` entier) pour éviter les boucles
  useEffect(() => {
    if (!form.invoice_number) return
    if (!form.client_id && items.every(it => !it.name)) return

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      if (!isOperationInProgress.current) performAutoSave()
    }, 3000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [form.client_id, form.date, form.due_date, form.discount, form.tax_rate, form.notes, items])

  async function performAutoSave() {
    if (!form.invoice_number || isOperationInProgress.current) return
    setAutoSaveStatus('saving')

    const { data: userData } = await supabase.auth.getUser()
    const s = items.reduce((acc, it) => acc + it.quantity * it.unit_price, 0)
    const ad = s - (form.discount || 0)
    const ta = ad * form.tax_rate / 100

    const invoicePayload = {
      client_id: form.client_id || null,
      date: form.date,
      due_date: form.due_date || null,
      status: 'draft',
      subtotal: s, discount: form.discount,
      tax_rate: form.tax_rate, tax_amount: ta, total: ad + ta,
      notes: form.notes, payment_terms: form.payment_terms,
      updated_at: new Date().toISOString(),
    }
    const validItems = items.filter(it => it.name.trim() && it.quantity > 0)

    try {
      if (draftIdRef.current) {
        // UPDATE uniquement (pas d'INSERT facture, pas de conflit invoice_number)
        await supabase.from('invoices').update(invoicePayload).eq('id', draftIdRef.current)
        await supabase.from('invoice_items').delete().eq('invoice_id', draftIdRef.current)
        if (validItems.length > 0) {
          await supabase.from('invoice_items').insert(
            validItems.map((it, idx) => ({ ...it, invoice_id: draftIdRef.current!, sort_order: idx }))
          )
        }
      } else {
        // Première sauvegarde : INSERT la facture
        const { data: newDraft, error } = await supabase
          .from('invoices')
          .insert({ ...invoicePayload, invoice_number: form.invoice_number, created_by: userData.user?.id })
          .select('id').single()
        if (error) { setAutoSaveStatus('idle'); return }
        if (newDraft) {
          draftIdRef.current = newDraft.id // ← mis à jour IMMÉDIATEMENT
          if (validItems.length > 0) {
            await supabase.from('invoice_items').insert(
              validItems.map((it, idx) => ({ ...it, invoice_id: newDraft.id, sort_order: idx }))
            )
          }
        }
      }
      setAutoSaveStatus('saved')
      setTimeout(() => setAutoSaveStatus('idle'), 3000)
    } catch {
      setAutoSaveStatus('idle')
    }
  }

  // ── SAUVEGARDE PRINCIPALE (boutons) ──
  async function handleSave(targetStatus: 'draft' | 'pending' | 'paid') {
    if (!form.invoice_number) return
    const validItems = items.filter(it => it.name.trim() && it.quantity > 0 && it.unit_price >= 0)
    if (validItems.length === 0) { alert('Ajoutez au moins une ligne avec un nom et une quantité.'); return }

    // Annuler l'auto-save en attente + poser le verrou
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    isOperationInProgress.current = true
    setSaving(true)

    try {
      const { data: userData } = await supabase.auth.getUser()
      const s = validItems.reduce((acc, it) => acc + it.quantity * it.unit_price, 0)
      const ad = s - (form.discount || 0)
      const ta = ad * form.tax_rate / 100

      const invoicePayload = {
        invoice_number: form.invoice_number,
        client_id: form.client_id || null,
        date: form.date,
        due_date: form.due_date || null,
        status: targetStatus,
        subtotal: s, discount: form.discount,
        tax_rate: form.tax_rate, tax_amount: ta, total: ad + ta,
        notes: form.notes, payment_terms: form.payment_terms,
        created_by: userData.user?.id,
        ...(targetStatus === 'paid' ? { validated_by: userData.user?.id } : {}),
        updated_at: new Date().toISOString(),
      }

      let invoiceId = draftIdRef.current

      if (invoiceId) {
        // ── Facture déjà en base → UPDATE ──
        await supabase.from('invoices').update(invoicePayload).eq('id', invoiceId)

        // Supprimer les anciennes lignes et ATTENDRE la confirmation
        const { error: delError } = await supabase
          .from('invoice_items').delete().eq('invoice_id', invoiceId)
        if (delError) throw new Error('Erreur suppression lignes : ' + delError.message)

      } else {
        // ── Pas encore en base → INSERT ──
        const { data: newInv, error: insError } = await supabase
          .from('invoices').insert(invoicePayload).select('id').single()
        if (insError || !newInv) throw new Error('Erreur création facture : ' + (insError?.message || ''))
        invoiceId = newInv.id
        draftIdRef.current = invoiceId
      }

      // ── Insérer les lignes (après DELETE confirmé OU sur nouvelle facture vide) ──
      const { error: itemsError } = await supabase
        .from('invoice_items')
        .insert(validItems.map((it, idx) => ({ ...it, invoice_id: invoiceId!, sort_order: idx })))
      if (itemsError) throw new Error('Erreur insertion lignes : ' + itemsError.message)

      router.push(`/invoices/${invoiceId}`)

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('handleSave error:', msg)
      alert('Erreur lors de la sauvegarde : ' + msg)
    } finally {
      setSaving(false)
      isOperationInProgress.current = false
    }
  }

  // ── HELPERS ──
  function selectClient(client: Client) {
    setForm(f => ({ ...f, client_id: client.id, client_name: client.name }))
    setClientSearch(client.name)
    setShowClientDropdown(false)
  }

  function updateItem(idx: number, field: keyof LineItem, value: string | number | null) {
    setItems(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], [field]: value }
      if (field === 'product_id' && value) {
        const p = products.find(pr => pr.id === value)
        if (p) {
          updated[idx].name = p.name
          updated[idx].unit_price = p.price_per_unit || 0
          updated[idx].unit = p.unit || 'kg'
        }
      }
      return updated
    })
  }

  function addLine() { setItems(prev => [...prev, emptyLine()]) }
  function removeLine(idx: number) {
    if (items.length > 1) setItems(prev => prev.filter((_, i) => i !== idx))
  }

  const filteredClients = clients.filter(c =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase())
  )

  return (
    <div className="invoice-page invoice-page--new">
      <div className="page-header invoice-page__toolbar invoice-form__header-toolbar">
        <div className="invoice-form__header-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="invoice-btn invoice-btn--back" onClick={() => router.back()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>🧾 Nouvelle Facture</h2>
          {duplicateId && <span className="badge badge-blue">📋 Duplication</span>}
        </div>
        <div className="invoice-form__header-actions" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {autoSaveStatus === 'saving' && <span className="invoice-form__autosave invoice-form__autosave--saving" style={{ fontSize: '0.78rem', color: '#999' }}>💾 Sauvegarde...</span>}
          {autoSaveStatus === 'saved'  && <span className="invoice-form__autosave invoice-form__autosave--saved" style={{ fontSize: '0.78rem', color: '#065f46' }}>✓ Sauvegardé</span>}
          <button type="button" className="btn-ghost invoice-btn invoice-btn--save-draft" onClick={() => handleSave('draft')}   disabled={saving}>💾 Brouillon</button>
          <button type="button" className="btn-amber invoice-btn invoice-btn--save-pending" onClick={() => handleSave('pending')} disabled={saving}>📤 Soumettre</button>
          <button type="button" className="btn-primary invoice-btn invoice-btn--save-paid" onClick={() => handleSave('paid')}    disabled={saving}>✅ Valider & Payer</button>
        </div>
      </div>

      <div className="invoice-page__body">
        <div className="invoice-page__layout invoice-form__layout">

          {/* ── Colonne principale ── */}
          <div className="invoice-page__main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Infos facture */}
            <div className="invoice-form__section invoice-form__section--invoice-meta" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div className="invoice-form__section-title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>
                📋 Informations Facture
              </div>
              <div className="invoice-form__grid invoice-form__grid--cols-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="hub-form-group">
                  <label className="invoice-field__label">N° Facture</label>
                  <input className="hub-input invoice-field invoice-field--invoice-number" value={form.invoice_number} readOnly
                    style={{ background: '#f8f5ee', fontFamily: 'monospace', fontWeight: 700, color: 'var(--hub-green)' }} />
                </div>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Statut</label>
                  <div className="invoice-form__status-placeholder" style={{ padding: '10px 14px', background: '#f8f5ee', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, color: 'var(--hub-green-mid)' }}>
                    ✏️ Brouillon — sera défini à la sauvegarde
                  </div>
                </div>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Date de facturation</label>
                  <input className="hub-input invoice-field invoice-field--date" type="date" value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Date d&apos;échéance</label>
                  <input className="hub-input invoice-field invoice-field--due-date" type="date" value={form.due_date}
                    onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Client */}
            <div className="invoice-form__section invoice-form__section--client" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div className="invoice-form__section-title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>
                👥 Client
              </div>
              <div className="invoice-form__client-search" style={{ position: 'relative' }}>
                <input className="hub-input invoice-field invoice-field--client-search" placeholder="🔍 Rechercher un client..."
                  value={clientSearch}
                  onChange={e => { setClientSearch(e.target.value); setShowClientDropdown(true) }}
                  onFocus={() => setShowClientDropdown(true)}
                  onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                />
                {showClientDropdown && filteredClients.length > 0 && (
                  <div className="invoice-form__client-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid var(--hub-green-mid)', borderRadius: '0 0 10px 10px', zIndex: 50, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                    {filteredClients.map(c => (
                      <div key={c.id} className="invoice-form__client-option" onMouseDown={() => selectClient(c)}
                        style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #f0ece4' }}
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
                <div className="invoice-form__client-chip" style={{ marginTop: 10, padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>✅ <strong>{form.client_name}</strong> sélectionné</span>
                  <button type="button" className="invoice-btn invoice-btn--clear-client" onClick={() => { setForm(f => ({ ...f, client_id: '', client_name: '' })); setClientSearch('') }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: '0.9rem' }}>✕</button>
                </div>
              )}
            </div>

            {/* Lignes */}
            <div className="invoice-form__section invoice-form__section--line-items" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div className="invoice-line-items__toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>
                <div className="invoice-form__section-title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 0, paddingBottom: 0, borderBottom: 'none' }}>
                  📦 Lignes de Facture
                </div>
                <button type="button" className="btn-ghost invoice-btn invoice-btn--add-line" style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={addLine}>+ Ajouter ligne</button>
              </div>

              <div className="invoice-line-items__header-row" style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 8, padding: '0 4px' }}>
                {['Produit / Service', 'Désignation', 'Qté', 'Prix unit.', 'Total', ''].map(h => (
                  <div key={h} className="invoice-line-items__header-cell" style={{ fontSize: '0.7rem', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</div>
                ))}
              </div>

              <div className="invoice-line-items__list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((item, idx) => (
                  <div key={idx} className="invoice-line-item" style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'flex-start', background: '#fafaf7', borderRadius: 8, padding: '10px' }}>
                    <div className="invoice-line-item__product">
                      <select className="hub-select invoice-field invoice-field--product"
                        value={item.product_id || ''}
                        onChange={e => updateItem(idx, 'product_id', e.target.value || null)}>
                        <option value="">— Produit catalogue —</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.unit}) — {Number(p.price_per_unit || 0).toLocaleString()} FCFA
                          </option>
                        ))}
                      </select>
                      <input className="hub-input invoice-field invoice-field--line-name" style={{ marginTop: 4 }}
                        placeholder="Nom du produit / service..."
                        value={item.name}
                        onChange={e => updateItem(idx, 'name', e.target.value)} />
                    </div>
                    <input className="hub-input invoice-field invoice-field--line-description"
                      placeholder="Description..."
                      value={item.description}
                      onChange={e => updateItem(idx, 'description', e.target.value)} />
                    <div className="invoice-line-item__qty">
                      <input className="hub-input invoice-field invoice-field--quantity" type="number" min={0} step="0.01"
                        value={item.quantity}
                        onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                      <select className="hub-select invoice-field invoice-field--unit" style={{ marginTop: 4 }}
                        value={item.unit}
                        onChange={e => updateItem(idx, 'unit', e.target.value)}>
                        {UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="invoice-line-item__price">
                      <input className="hub-input invoice-field invoice-field--unit-price" type="number" min={0}
                        value={item.unit_price}
                        onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} />
                      <div style={{ fontSize: '0.7rem', color: '#999', marginTop: 2, textAlign: 'right' }}>FCFA</div>
                    </div>
                    <div className="invoice-line-item__total" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--hub-green)', paddingTop: 8, fontSize: '0.9rem' }}>
                      {(item.quantity * item.unit_price).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
                      <div style={{ fontSize: '0.7rem', color: '#999', fontWeight: 400 }}>FCFA</div>
                    </div>
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
            <div className="invoice-form__section invoice-form__section--notes" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div className="invoice-form__section-title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, paddingBottom: 0, borderBottom: 'none' }}>
                💬 Notes & Conditions
              </div>
              <div className="invoice-form__grid invoice-form__grid--cols-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Conditions de paiement</label>
                  <select className="hub-select invoice-field invoice-field--payment-terms" value={form.payment_terms}
                    onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))}>
                    {['Immédiat', '7 jours', '15 jours', '30 jours', '45 jours', '60 jours'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Notes internes</label>
                  <textarea className="hub-input invoice-field invoice-field--notes" rows={2} value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Informations complémentaires..."
                    style={{ resize: 'vertical' }} />
                </div>
              </div>
            </div>
          </div>

          {/* ── Colonne droite : Résumé ── */}
          <div className="invoice-page__aside" style={{ position: 'sticky', top: 80 }}>
            <div className="invoice-form__section invoice-form__section--summary" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div className="invoice-form__summary-banner" style={{ background: 'var(--hub-green)', color: 'white', padding: '16px 20px' }}>
                <div style={{ fontSize: '0.75rem', opacity: 0.7, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Résumé</div>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 700 }}>{form.invoice_number || '—'}</div>
              </div>
              <div className="invoice-form__summary-body" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', paddingBottom: 8, borderBottom: '1px solid #f0ece4' }}>
                    <span style={{ color: '#666' }}>Sous-total HT</span>
                    <span style={{ fontWeight: 600 }}>{subtotal.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', paddingBottom: 8, borderBottom: '1px solid #f0ece4' }}>
                    <span style={{ color: '#666' }}>Remise</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input className="hub-input invoice-field invoice-field--discount" type="number" min={0} value={form.discount}
                        onChange={e => setForm(f => ({ ...f, discount: parseFloat(e.target.value) || 0 }))}
                        style={{ width: 96, textAlign: 'right' }} />
                      <span style={{ fontSize: '0.75rem', color: '#999' }}>FCFA</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', paddingBottom: 8, borderBottom: '1px solid #f0ece4' }}>
                    <span style={{ color: '#666' }}>TVA</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input className="hub-input invoice-field invoice-field--tax-rate" type="number" min={0} max={100} value={form.tax_rate}
                        onChange={e => setForm(f => ({ ...f, tax_rate: parseFloat(e.target.value) || 0 }))}
                        style={{ width: 58, textAlign: 'center' }} />
                      <span style={{ color: '#666', fontSize: '0.875rem' }}>% = {taxAmount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA</span>
                    </div>
                  </div>
                  <div className="invoice-form__summary-total" style={{ background: 'var(--hub-green)', color: 'white', borderRadius: 8, padding: '14px 16px', marginTop: 4 }}>
                    <div style={{ fontSize: '0.7rem', opacity: 0.7, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Total TTC</div>
                    <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.6rem', fontWeight: 800 }}>
                      {total.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
                    </div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>FCFA</div>
                  </div>
                </div>
                <div className="invoice-form__summary-footer" style={{ marginTop: 14, fontSize: '0.8rem', color: '#666', textAlign: 'center' }}>
                  {items.filter(it => it.name).length} ligne(s) · {form.client_name || 'Pas de client'}
                </div>
              </div>
            </div>

            <div className="invoice-form__section invoice-form__section--sidebar-actions" style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '20px', marginTop: 16 }}>
              <div className="invoice-form__section-title" style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, paddingBottom: 0, borderBottom: 'none' }}>Actions</div>
              <div className="invoice-form__sidebar-actions" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button type="button" className="btn-ghost invoice-btn invoice-btn--save-draft-aside" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => handleSave('draft')} disabled={saving}>
                  {saving ? '⏳ Sauvegarde...' : '💾 Enregistrer en brouillon'}
                </button>
                <button type="button" className="btn-amber invoice-btn invoice-btn--save-pending-aside" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => handleSave('pending')} disabled={saving}>
                  {saving ? '⏳ Sauvegarde...' : '📤 Soumettre pour validation'}
                </button>
                <button type="button" className="btn-primary invoice-btn invoice-btn--save-paid-aside" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => handleSave('paid')} disabled={saving}>
                  {saving ? '⏳ Sauvegarde...' : '✅ Valider & Marquer Payée'}
                </button>
              </div>
              <div className="invoice-form__sidebar-hint" style={{ marginTop: 12, padding: '8px 10px', background: '#f8f5ee', borderRadius: 6, fontSize: '0.72rem', color: '#666' }}>
                ⚠️ La validation décrémente le stock automatiquement et génère la facture définitive.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
