'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Client, Product, ProductBatch } from '@/types'
import { useToast } from '@/components/ui/Toast'
import { suggestFefoBatch } from '@/lib/stock/traceability'
import { isLotUsable } from '@/lib/quality/release'
import { lineInBaseUnit, packsForProduct, unitsForProduct, type ProductPack } from '@/lib/stock/units'

const UNITS = ['kg', 'g', 'L', 'ml', 'carton', 'sac', 'pièce', 'heure', 'forfait', 'unité']
const todayISO = () => new Date().toISOString().slice(0, 10)
const in30Days = () => new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)

interface LineItem {
  product_id: string | null
  batch_id: string | null
  name: string
  description: string
  quantity: number
  unit: string
  unit_price: number
}

const emptyLine = (): LineItem => ({
  product_id: null, batch_id: null, name: '', description: '',
  quantity: 1, unit: 'kg', unit_price: 0,
})

export default function NewQuotePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('edit')?.trim() || null

  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [batches, setBatches] = useState<ProductBatch[]>([])
  const [packRows, setPackRows] = useState<(ProductPack & { product_id: string })[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)

  const [form, setForm] = useState({
    title: '', client_id: '', client_name: '',
    date: todayISO(),
    due_date: in30Days(),
    discount: 0, tax_rate: 18, notes: '', payment_terms: '30 jours',
  })
  const [items, setItems] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [docNumber, setDocNumber] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(!!editId)
  const supabase = createClient()
  const { toast } = useToast()

  // Totaux live
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0)
  const afterDiscount = subtotal - (form.discount || 0)
  const taxAmount = afterDiscount * form.tax_rate / 100
  const total = afterDiscount + taxAmount

  function toBaseItems(list: LineItem[]): LineItem[] {
    return list.map(it => {
      const p = products.find(x => x.id === it.product_id)
      return lineInBaseUnit(it, p?.unit, packsForProduct(it.product_id, packRows))
    })
  }

  // ── INIT (création ou édition d'un brouillon) ──
  useEffect(() => {
    let active = true
    async function init() {
      setLoading(true)
      const [{ data: c }, { data: p }, { data: b }, { data: pu }] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        supabase.from('products').select('*').order('name'),
        supabase.from('product_batches').select('*').order('expiry_date'),
        supabase.from('product_units').select('product_id, unit, factor'),
      ])
      if (!active) return
      setClients(c || [])
      setProducts(p || [])
      setBatches(b || [])
      setPackRows((pu || []) as (ProductPack & { product_id: string })[])

      if (editId) {
        const [{ data: d }, { data: ditems }] = await Promise.all([
          supabase.from('documents').select('*, client:clients(name)').eq('id', editId).single(),
          supabase.from('document_items').select('*').eq('document_id', editId).order('sort_order'),
        ])
        if (!active) return
        if (!d || d.type !== 'devis') { setLoadError('Devis introuvable.'); setLoading(false); return }
        if (d.status !== 'draft') {
          setLoadError('Seul un devis brouillon peut être modifié.')
          setLoading(false)
          return
        }
        const content = (d.content || {}) as { notes?: string; client_name?: string; document_date?: string }
        const clientName = (d.client as any)?.name || content.client_name || ''
        setForm(f => ({
          ...f,
          title: d.title || '',
          client_id: d.client_id || '',
          client_name: clientName,
          date: content.document_date || new Date(d.created_at).toISOString().slice(0, 10),
          due_date: d.due_date || in30Days(),
          discount: Number(d.discount || 0),
          tax_rate: Number(d.tax_rate || 18),
          notes: content.notes || '',
          payment_terms: d.payment_terms || '30 jours',
        }))
        setClientSearch(clientName)
        setDocNumber(d.document_number || '')
        if (ditems && ditems.length > 0) {
          setItems(ditems.map((it: any) => ({
            product_id: it.product_id || null,
            batch_id: it.batch_id || null,
            name: it.name,
            description: it.description || '',
            quantity: Number(it.quantity) || 0,
            unit: it.unit || 'kg',
            unit_price: Number(it.unit_price) || 0,
          })))
        }
        setEditingId(editId)
      }
      setLoading(false)
    }
    init()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  async function handleSave(targetStatus: 'draft' | 'pending') {
    if (saving) return
    const validItems = items.filter(it => it.name.trim() && it.quantity > 0 && it.unit_price >= 0)
    if (validItems.length === 0) { toast('warning', 'Ajoutez au moins une ligne avec un nom et une quantité.'); return }
    if (targetStatus === 'pending' && !form.client_id) { toast('warning', 'Sélectionnez un client avant de soumettre le devis.'); return }
    if (targetStatus === 'pending' && form.due_date && form.due_date < todayISO()) { toast('warning', 'La date de validité est déjà passée : corrigez-la avant de soumettre.'); return }

    setSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()

      // Conversion unités → unité de base (lots FEFO conservés sur chaque ligne)
      const baseItems = toBaseItems(validItems)
      const s = baseItems.reduce((acc, it) => acc + it.quantity * it.unit_price, 0)
      const ad = s - (form.discount || 0)
      const ta = ad * form.tax_rate / 100
      const t = ad + ta

      const clientName = form.client_name || clients.find(cl => cl.id === form.client_id)?.name || ''
      const content = { notes: form.notes || '', client_name: clientName, document_date: form.date }
      const payload = {
        title: form.title || (clientName ? `Devis ${clientName}` : 'Devis'),
        client_id: form.client_id || null,
        due_date: form.due_date || null,
        total_amount: t,
        discount: form.discount || 0,
        tax_rate: form.tax_rate || 18,
        tax_amount: ta,
        payment_terms: form.payment_terms,
        content,
      }

      let docId: string
      let num: string

      if (editingId) {
        // ── Brouillon existant → UPDATE (pas de nouveau numéro) ──
        docId = editingId
        num = docNumber
        const { error: upErr } = await supabase
          .from('documents')
          .update({
            ...payload,
            ...(targetStatus === 'pending' ? { status: 'pending', rejection_reason: null } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', docId).eq('status', 'draft')
        if (upErr) throw new Error(upErr.message)

        const { error: delErr } = await supabase.from('document_items').delete().eq('document_id', docId)
        if (delErr) throw new Error('Erreur suppression lignes : ' + delErr.message)

        if (baseItems.length > 0) {
          const { error: insErr } = await supabase.from('document_items').insert(
            baseItems.map((it, idx) => ({ document_id: docId, product_id: it.product_id, batch_id: it.batch_id || null, name: it.name, description: it.description || '', quantity: it.quantity, unit: it.unit || 'unité', unit_price: it.unit_price, sort_order: idx }))
          )
          if (insErr) throw new Error('Erreur insertion lignes : ' + insErr.message)
        }
      } else {
        // ── Nouveau devis → INSERT ──
        const { data: numData, error: numErr } = await supabase.rpc('generate_document_number', { p_type: 'devis' })
        if (numErr) throw new Error(numErr.message)
        num = numData as string

        const { data: doc, error: docErr } = await supabase.from('documents').insert({
          ...payload,
          document_number: num,
          type: 'devis',
          status: targetStatus,
          created_by: userData.user?.id,
        }).select('id').single()
        if (docErr || !doc) throw new Error(docErr?.message || 'Erreur création du devis')
        docId = doc.id

        const { error: insErr } = await supabase.from('document_items').insert(
          baseItems.map((it, idx) => ({ document_id: docId, product_id: it.product_id, batch_id: it.batch_id || null, name: it.name, description: it.description || '', quantity: it.quantity, unit: it.unit || 'unité', unit_price: it.unit_price, sort_order: idx }))
        )
        if (insErr) throw new Error('Erreur insertion lignes : ' + insErr.message)
      }

      if (targetStatus === 'pending') {
        try {
          await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'quote_pending',
              title: `Devis ${num} en attente`,
              message: `Devis ${form.title || num} pour ${clientName || 'client non défini'} — ${t.toLocaleString('fr-FR')} FCFA`,
              referenceId: docId,
              referenceType: 'quote',
              link: `/quotes/${docId}`,
            }),
          })
        } catch { /* best-effort */ }
      }

      toast('success', targetStatus === 'pending' ? 'Devis soumis pour validation.' : 'Brouillon enregistré.')
      router.push(`/quotes/${docId}`)
    } catch (err: unknown) {
      toast('error', 'Erreur : ' + (err instanceof Error ? err.message : String(err)))
    } finally { setSaving(false) }
  }

  function selectClient(c: Client) {
    setForm(f => ({ ...f, client_id: c.id, client_name: c.name }))
    setClientSearch(c.name)
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
        // Suggestion FEFO (lots libérés uniquement) — reste modifiable / désactivable
        updated[idx].batch_id = suggestFefoBatch(batches, String(value))
      }
      if (field === 'product_id' && !value) updated[idx].batch_id = null
      return updated
    })
  }

  function addLine() { setItems(prev => [...prev, emptyLine()]) }
  function removeLine(idx: number) { if (items.length > 1) setItems(prev => prev.filter((_, i) => i !== idx)) }

  const filteredClients = clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
  const canSubmit = !saving && (form.client_id !== '') && items.some(it => it.name.trim() && it.quantity > 0)

  return (
    <div className="invoice-page invoice-page--new">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>{editingId ? `✏️ Modifier ${docNumber || 'le devis'}` : '📝 Nouveau Devis'}</h2>
          {editingId && <span className="badge badge-gray">✏️ Brouillon</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="btn-ghost" onClick={() => handleSave('draft')} disabled={saving}>💾 Brouillon</button>
          <button type="button" className="btn-amber" onClick={() => handleSave('pending')} disabled={saving || !form.client_id}>📤 Soumettre</button>
        </div>
      </div>

      {loading && <div style={{ padding: 60, textAlign: 'center', color: '#999' }}>Chargement...</div>}
      {loadError && !loading && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ color: '#991b1b', marginBottom: 16 }}>⚠️ {loadError}</div>
          <button type="button" className="btn-primary" onClick={() => router.push('/quotes')}>← Retour aux devis</button>
        </div>
      )}

      {!loading && !loadError && (
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
                  <label className="invoice-field__label">Date du devis</label>
                  <input className="hub-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div className="hub-form-group">
                  <label className="invoice-field__label">Validité (jusqu'au) *</label>
                  <input className="hub-input" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
                  <div style={{ fontSize: '0.7rem', color: '#999', marginTop: 3 }}>Par défaut : 30 jours. Passée cette date, le devis est expiré.</div>
                </div>
              </div>
            </div>

            {/* Client */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>👥 Client <span style={{ color: '#dc2626' }}>*</span></div>
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
              {!form.client_id && (
                <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#92400e' }}>⚠️ Requis pour soumettre le devis.</div>
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
                {items.map((item, idx) => {
                  const currentProduct = products.find(p => p.id === item.product_id)
                  return (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'flex-start', background: '#fafaf7', borderRadius: 8, padding: '10px' }}>
                    <div>
                      <select className="hub-select" value={item.product_id || ''} onChange={e => updateItem(idx, 'product_id', e.target.value || null)}>
                        <option value="">— Produit catalogue —</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit}) — {Number(p.price_per_unit || 0).toLocaleString()} FCFA</option>)}
                      </select>
                      <input className="hub-input" style={{ marginTop: 4 }} placeholder="Nom..." value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)} />
                      {item.product_id && (
                        <select className="hub-select" style={{ marginTop: 4 }} value={item.batch_id || ''} onChange={e => updateItem(idx, 'batch_id', e.target.value || null)}>
                          <option value="">— Lot (optionnel) —</option>
                          {batches.filter(b => b.product_id === item.product_id && isLotUsable(b)).map(b => (
                            <option key={b.id} value={b.id}>
                              {b.batch_number} · {Number(b.quantity).toLocaleString('fr-FR')} {item.unit}
                              {b.expiry_date ? ` · exp. ${new Date(b.expiry_date + 'T00:00:00').toLocaleDateString('fr-FR')}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <input className="hub-input" placeholder="Description..." value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                    <div>
                      <input className="hub-input" type="number" min={0} step="0.01" value={item.quantity} onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                      <select className="hub-select" style={{ marginTop: 4 }} value={item.unit} onChange={e => updateItem(idx, 'unit', e.target.value)}>
                        {(item.product_id
                          ? unitsForProduct(currentProduct?.unit || 'kg', packsForProduct(item.product_id, packRows))
                          : UNITS
                        ).map(u => <option key={u}>{u}</option>)}
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
                  )
                })}
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input className="hub-input" type="number" min={0} value={form.discount} onChange={e => setForm(f => ({ ...f, discount: parseFloat(e.target.value) || 0 }))} style={{ width: 96, textAlign: 'right' }} />
                      <span style={{ color: '#999', fontSize: '0.75rem' }}>FCFA</span>
                    </div>
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
                <button type="button" className="btn-amber" style={{ justifyContent: 'center', padding: '11px' }} onClick={() => handleSave('pending')} disabled={!canSubmit}>
                  {saving ? '⏳ Sauvegarde...' : '📤 Soumettre au client'}
                </button>
              </div>
              {!form.client_id && (
                <div style={{ marginTop: 12, padding: '8px 10px', background: '#fef3c7', borderRadius: 6, fontSize: '0.72rem', color: '#92400e' }}>
                  ⚠️ Un client est requis pour soumettre.
                </div>
              )}
              <div style={{ marginTop: 12, padding: '8px 10px', background: '#f8f5ee', borderRadius: 6, fontSize: '0.72rem', color: '#666' }}>
                ℹ️ Un devis accepté pourra être converti en facture en un clic. Les quantités sont converties dans l'unité de base du produit.
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
