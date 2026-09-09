'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  cartTotals,
  formatFCFA,
  validateOrderForm,
  type PortalCartLine,
  type PortalOrderFormErrors,
} from '@/lib/portal/catalog'

const documentTypes = [
  'Attestation fiscale', 'Extrait RCCM', 'Attestation de bonne exécution',
  'Bilan comptable', 'Statuts de la société', 'Contrat-cadre',
  'Certificat d\'origine', 'Fiche produit', 'Rapport d\'activité', 'Autre'
]

const jobs_public_types = ['cdi', 'cdd', 'stage', 'freelance'] as const

const CART_STORAGE_KEY = 'hub-portal-cart'

interface PortalProduct {
  id: string
  name: string
  category: string
  unit: string | null
  catalog_unit: string | null
  price_per_unit: number | null
  quantity: number
  description?: string | null
}

const emptyOrderForm = {
  customer_name: '', customer_phone: '', customer_email: '',
  organization: '', delivery_address: '', notes: ''
}

export default function PortalPage() {
  const [activeSection, setActiveSection] = useState<'requests' | 'jobs' | 'apply' | 'catalog'>('requests')
  const [jobs, setJobs] = useState<any[]>([])
  const [jobsLoaded, setJobsLoaded] = useState(false)
  const [requestForm, setRequestForm] = useState({
    requester_name: '', organization: '', email: '', phone: '',
    document_type: '', description: ''
  })
  const [applyForm, setApplyForm] = useState({
    job_id: '', name: '', email: '', phone: '', cover_letter: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [requestSuccess, setRequestSuccess] = useState(false)
  const [applySuccess, setApplySuccess] = useState(false)
  const [trackId, setTrackId] = useState('')
  const [trackResult, setTrackResult] = useState<any>(null)
  const [trackError, setTrackError] = useState('')

  // ── Catalogue & commande ──
  const [products, setProducts] = useState<PortalProduct[]>([])
  const [productsLoaded, setProductsLoaded] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [productsError, setProductsError] = useState('')
  const [cart, setCart] = useState<PortalCartLine[]>([])
  const [cartReady, setCartReady] = useState(false)
  const [productQtys, setProductQtys] = useState<Record<string, number>>({})
  const [orderForm, setOrderForm] = useState(emptyOrderForm)
  const [formErrors, setFormErrors] = useState<PortalOrderFormErrors>({})
  const [placingOrder, setPlacingOrder] = useState(false)
  const [orderResult, setOrderResult] = useState<{ order_number: string; phone: string } | null>(null)
  const [orderError, setOrderError] = useState('')

  const supabase = createClient()

  async function loadJobs() {
    if (jobsLoaded) return
    const { data } = await supabase.from('jobs').select('*').eq('status', 'open').order('created_at', { ascending: false })
    setJobs(data || [])
    setJobsLoaded(true)
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true)
    await supabase.from('document_requests').insert(requestForm)
    setSubmitting(false)
    setRequestSuccess(true)
    setRequestForm({ requester_name: '', organization: '', email: '', phone: '', document_type: '', description: '' })
  }

  async function submitApplication(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true)
    await supabase.from('candidates').insert({ ...applyForm, status: 'nouveau' })
    setSubmitting(false)
    setApplySuccess(true)
    setApplyForm({ job_id: '', name: '', email: '', phone: '', cover_letter: '' })
  }

  async function trackRequest() {
    setTrackError('')
    setTrackResult(null)
    if (!trackId.trim()) return
    const { data } = await supabase.from('document_requests').select('*').ilike('id', `%${trackId.trim()}%`).single()
    if (data) setTrackResult(data)
    else setTrackError('Aucune demande trouvée avec cette référence.')
  }

  // ── Catalogue & commande : données ──
  async function loadProducts() {
    if (productsLoaded || loadingProducts) return
    setLoadingProducts(true)
    setProductsError('')
    const { data, error } = await supabase
      .from('products')
      .select('id, name, category, unit, catalog_unit, price_per_unit, quantity, description')
      .eq('is_catalog', true)
      .gt('quantity', 0)
      .order('category', { ascending: true })
      .order('name', { ascending: true })
    if (error) {
      setProductsError('Impossible de charger le catalogue pour le moment. Veuillez réessayer dans quelques instants.')
    } else {
      setProducts((data || []) as PortalProduct[])
    }
    setProductsLoaded(true)
    setLoadingProducts(false)
  }

  // Restauration du panier depuis le localStorage (JSON parsé de façon sécurisée).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setCart(parsed.filter((l: any) =>
            l && typeof l.product_id === 'string' && Number(l.quantity) > 0 && Number(l.unit_price) >= 0
          ).map((l: any) => ({
            product_id: l.product_id,
            name: typeof l.name === 'string' ? l.name : 'Produit',
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
            unit: typeof l.unit === 'string' ? l.unit : null,
          })))
        }
      }
    } catch { /* panier corrompu : ignoré */ }
    setCartReady(true)
  }, [])

  useEffect(() => {
    if (!cartReady) return
    try { window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)) } catch { /* stockage indisponible */ }
  }, [cart, cartReady])

  const cartQtyOf = (productId: string) =>
    cart.reduce((sum, l) => (l.product_id === productId ? sum + l.quantity : sum), 0)

  const displayUnitOf = (p: PortalProduct) => p.catalog_unit?.trim() || p.unit || ''

  const remainingOf = (p: PortalProduct) => Math.max(0, Number(p.quantity) - cartQtyOf(p.id))

  function addToCart(product: PortalProduct, qty: number) {
    const q = Math.min(Math.max(1, Math.floor(qty || 1)), remainingOf(product))
    if (q <= 0) return
    const unitPrice = Number(product.price_per_unit) || 0
    setCart(prev => {
      const idx = prev.findIndex(l => l.product_id === product.id)
      if (idx === -1) {
        return [...prev, { product_id: product.id, name: product.name, quantity: q, unit_price: unitPrice, unit: displayUnitOf(product) }]
      }
      const next = prev.slice()
      next[idx] = {
        ...next[idx],
        quantity: Math.min(next[idx].quantity + q, Number(product.quantity)),
        name: product.name,
        unit_price: unitPrice,
        unit: displayUnitOf(product),
      }
      return next
    })
  }

  function setLineQty(productId: string, qty: number) {
    const product = products.find(p => p.id === productId)
    const cap = product ? Math.max(1, Number(product.quantity)) : 999999
    setCart(prev => prev.map(l =>
      l.product_id === productId ? { ...l, quantity: Math.max(1, Math.min(Math.floor(qty) || 1, cap)) } : l
    ))
  }

  function removeLine(productId: string) {
    setCart(prev => prev.filter(l => l.product_id !== productId))
  }

  function nudgeQty(productId: string, delta: number) {
    const current = cart.find(l => l.product_id === productId)
    if (current) setLineQty(productId, current.quantity + delta)
  }

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault()
    const errors = validateOrderForm({
      customer_name: orderForm.customer_name,
      customer_phone: orderForm.customer_phone,
      lines: cart,
    })
    setFormErrors(errors)
    if (Object.keys(errors).length > 0 || cart.length === 0) return

    setPlacingOrder(true)
    setOrderError('')
    const { subtotal } = cartTotals(cart)
    try {
      const customerPhone = orderForm.customer_phone.trim()
      const { data: order, error: orderErrorRow } = await supabase
        .from('portal_orders')
        .insert({
          customer_name: orderForm.customer_name.trim(),
          customer_phone: customerPhone,
          customer_email: orderForm.customer_email.trim() || null,
          organization: orderForm.organization.trim() || null,
          delivery_address: orderForm.delivery_address.trim() || null,
          notes: orderForm.notes.trim() || null,
          total_amount: subtotal,
        })
        .select('id, order_number')
        .single()

      if (orderErrorRow || !order) {
        throw new Error(orderErrorRow?.message || 'insert_order_failed')
      }

      const items = cart.map(l => ({
        order_id: order.id,
        product_id: l.product_id,
        name: l.name,
        unit: l.unit || null,
        quantity: l.quantity,
        unit_price: l.unit_price,
        subtotal: Math.round(l.quantity * l.unit_price * 100) / 100,
      }))

      const { error: itemsError } = await supabase.from('portal_order_items').insert(items)
      if (itemsError) {
        throw new Error(itemsError.message || 'insert_items_failed')
      }

      setCart([])
      setProductQtys({})
      setOrderForm(emptyOrderForm)
      setOrderResult({ order_number: order.order_number, phone: customerPhone })
    } catch (err) {
      console.error('Erreur commande portail :', err)
      setOrderError('Une erreur est survenue lors de l\'envoi de votre commande. Veuillez réessayer ou nous appeler directement.')
    } finally {
      setPlacingOrder(false)
    }
  }

  const statusLabels: Record<string, string> = {
    pending: '⏳ En attente de traitement',
    processing: '⚙️ En cours de traitement',
    approved: '✅ Approuvée — Document disponible',
    rejected: '❌ Rejetée'
  }

  const cartTotal = cartTotals(cart).subtotal
  const categories = Array.from(new Set(products.map(p => p.category)))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--hub-cream)' }}>
      {/* Hero */}
      <div className="portal-hero">
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🌿</div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '2.2rem', fontWeight: 800, marginBottom: 8 }}>
            Portail HUB Distribution
          </h1>
          <p style={{ opacity: 0.8, fontSize: '1rem', maxWidth: 560 }}>
            Plateforme dédiée aux partenaires, institutions et candidats.
            Commandez nos produits, soumettez vos demandes de documents ou postulez à nos offres d&apos;emploi.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
            {[
              { key: 'catalog', icon: '🛒', label: 'Catalogue & commande' },
              { key: 'requests', icon: '📋', label: 'Demande de document' },
              { key: 'jobs', icon: '💼', label: 'Offres d\'emploi' },
              { key: 'apply', icon: '👤', label: 'Postuler' },
            ].map(s => (
              <button key={s.key} onClick={() => { setActiveSection(s.key as any); if (s.key === 'jobs' || s.key === 'apply') loadJobs(); if (s.key === 'catalog') loadProducts() }}
                style={{ padding: '12px 22px', borderRadius: 10, border: '2px solid', cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem', transition: 'all 0.15s',
                  borderColor: activeSection === s.key ? 'var(--hub-amber-light)' : 'rgba(255,255,255,0.3)',
                  background: activeSection === s.key ? 'var(--hub-amber)' : 'rgba(255,255,255,0.1)',
                  color: 'white' }}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px' }}>

        {/* Section: Catalogue & commande */}
        {activeSection === 'catalog' && (
          <div>
            <h2 style={{ fontFamily: 'Georgia, serif', color: 'var(--hub-green)', marginBottom: 8, fontSize: '1.5rem' }}>
              🛒 Catalogue & commande
            </h2>
            <p style={{ color: '#666', marginBottom: 24, fontSize: '0.875rem', maxWidth: 720 }}>
              Commandez en ligne nos produits HUB Distribution. Un conseiller vous recontactera pour
              confirmer la disponibilité, le paiement et la livraison (Brazzaville et alentours).
            </p>

            {productsError && (
              <div className="alert alert-error" style={{ marginBottom: 20 }}>{productsError}</div>
            )}

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 28, flexWrap: 'wrap' }}>
              {/* Produits */}
              <div style={{ flex: '1 1 480px', minWidth: 0 }}>
                {loadingProducts && !productsLoaded && (
                  <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Chargement du catalogue…</div>
                )}

                {productsLoaded && !loadingProducts && products.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 60, color: '#999', background: 'white', borderRadius: 12, border: '1px solid #e8e4db' }}>
                    <div style={{ fontSize: '2rem', marginBottom: 8 }}>📦</div>
                    Aucun produit disponible pour le moment.<br />
                    Revenez bientôt : notre catalogue s&apos;étoffe régulièrement.
                  </div>
                )}

                {categories.map(cat => {
                  const catProducts = products.filter(pp => pp.category === cat)
                  return (
                    <div key={cat}>
                      <h3 style={{ fontWeight: 700, color: 'var(--hub-green-mid)', fontSize: '0.95rem', margin: '28px 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {cat}
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
                        {catProducts.map(prod => {
                        const remaining = remainingOf(prod)
                        const inCart = cartQtyOf(prod.id) > 0
                        return (
                          <div key={prod.id} style={{ background: 'white', borderRadius: 14, border: inCart ? '1.5px solid var(--hub-green-mid)' : '1px solid #e8e4db', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div>
                              <div style={{ fontWeight: 700, color: '#222', fontSize: '0.9rem', lineHeight: 1.35 }}>{prod.name}</div>
                              {prod.description && <div style={{ fontSize: '0.75rem', color: '#888', marginTop: 4 }}>{prod.description}</div>}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 6 }}>
                              <div style={{ fontWeight: 800, color: 'var(--hub-green)', fontSize: '1.05rem' }}>
                                {formatFCFA(prod.price_per_unit)}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#999' }}>
                                {remaining > 0 ? `Dispo : ${remaining} ${displayUnitOf(prod)}` : 'Indisponible'}
                              </div>
                            </div>
                            {remaining > 0 ? (
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                                <button
                                  onClick={() => setProductQtys(prev => ({ ...prev, [prod.id]: Math.max(1, (prev[prod.id] || 1) - 1) }))}
                                  style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e8e4db', background: '#faf7f0', cursor: 'pointer', fontWeight: 700 }}>−</button>
                                <input
                                  type="number" min={1} max={Math.max(1, remaining)} value={productQtys[prod.id] || 1}
                                  onChange={e => setProductQtys(prev => ({ ...prev, [prod.id]: Math.max(1, Math.min(Math.floor(Number(e.target.value)) || 1, remaining)) }))}
                                  style={{ width: 52, textAlign: 'center', borderRadius: 8, border: '1px solid #e8e4db', padding: '6px 4px', fontSize: '0.875rem' }} />
                                <button
                                  onClick={() => setProductQtys(prev => ({ ...prev, [prod.id]: Math.min(remaining, (prev[prod.id] || 1) + 1) }))}
                                  style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e8e4db', background: '#faf7f0', cursor: 'pointer', fontWeight: 700 }}>+</button>
                                <button
                                  onClick={() => { addToCart(prod, productQtys[prod.id] || 1); setProductQtys(prev => ({ ...prev, [prod.id]: 1 })) }}
                                  className="btn-primary"
                                  style={{ flex: 1, padding: '8px 12px', fontSize: '0.8rem', justifyContent: 'center' }}>
                                  {inCart ? '+ Ajouter' : 'Ajouter'}
                                </button>
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.75rem', color: '#b45309', background: '#fef3c7', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                                ✓ Dans votre panier
                              </div>
                            )}
                          </div>
                        )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Panier (collant) */}
              <div style={{ flex: '0 0 360px', maxWidth: '100%', position: 'sticky', top: 16 }}>
                {orderResult ? (
                  <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e8e4db', padding: 28, textAlign: 'center' }}>
                    <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>🎉</div>
                    <h3 style={{ fontFamily: 'Georgia, serif', color: 'var(--hub-green)', fontSize: '1.3rem', marginBottom: 10 }}>
                      Commande envoyée !
                    </h3>
                    <div style={{ background: '#f8f5ee', borderRadius: 10, padding: '12px', margin: '14px 0' }}>
                      <div style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Référence</div>
                      <div style={{ fontWeight: 800, fontFamily: 'monospace', color: 'var(--hub-green)', fontSize: '1.15rem' }}>
                        {orderResult.order_number}
                      </div>
                    </div>
                    <p style={{ fontSize: '0.875rem', color: '#555', lineHeight: 1.6, margin: 0 }}>
                      Un conseiller vous contactera au <strong>{orderResult.phone || 'numéro indiqué'}</strong>{' '}
                      pour confirmer votre commande. Conservez bien votre référence.
                    </p>
                    <button className="btn-ghost" style={{ marginTop: 18, width: '100%', justifyContent: 'center' }}
                      onClick={() => { setOrderResult(null); setOrderError('') }}>
                      Passer une nouvelle commande
                    </button>
                  </div>
                ) : (
                  <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e8e4db', overflow: 'hidden' }}>
                    <div style={{ background: 'var(--hub-green)', color: 'white', padding: '14px 18px', fontWeight: 700, fontSize: '0.95rem' }}>
                      🧺 Votre commande
                      {cart.length > 0 && (
                        <span style={{ float: 'right', opacity: 0.85, fontSize: '0.8rem' }}>
                          {cart.reduce((n, l) => n + l.quantity, 0)} art.
                        </span>
                      )}
                    </div>

                    {cart.length === 0 ? (
                      <div style={{ padding: 28, textAlign: 'center', color: '#aaa', fontSize: '0.85rem', lineHeight: 1.7 }}>
                        Votre panier est vide.<br />
                        Ajoutez des produits du catalogue 👈
                      </div>
                    ) : (
                      <>
                        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0ede4', maxHeight: 280, overflowY: 'auto' }}>
                          {cart.map(line => {
                            const product = products.find(p => p.id === line.product_id)
                            const cap = product ? Math.max(1, Number(product.quantity)) : 999999
                            return (
                              <div key={line.product_id} style={{ padding: '10px 0', borderBottom: '1px dashed #eee8dc' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#333', flex: 1, lineHeight: 1.35 }}>{line.name}</div>
                                  <button onClick={() => removeLine(line.product_id)} title="Retirer"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '0.9rem', padding: '0 2px' }}>✕</button>
                                </div>
                                <div style={{ fontSize: '0.72rem', color: '#999', margin: '2px 0 6px' }}>
                                  {formatFCFA(line.unit_price)} / {line.unit || 'unité'}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <button onClick={() => nudgeQty(line.product_id, -1)} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #e8e4db', background: '#faf7f0', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>−</button>
                                    <input type="number" min={1} max={cap} value={line.quantity}
                                      onChange={e => setLineQty(line.product_id, Number(e.target.value))}
                                      style={{ width: 48, textAlign: 'center', borderRadius: 6, border: '1px solid #e8e4db', padding: '4px 2px', fontSize: '0.8rem' }} />
                                    <button onClick={() => nudgeQty(line.product_id, 1)} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #e8e4db', background: '#faf7f0', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>+</button>
                                  </div>
                                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--hub-green-mid)' }}>
                                    {formatFCFA(line.quantity * line.unit_price)}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0ede4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#555' }}>Total estimé</span>
                          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--hub-green)' }}>{formatFCFA(cartTotal)}</span>
                        </div>

                        <form onSubmit={submitOrder} style={{ padding: '14px 18px' }}>
                          <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.85rem', marginBottom: 10 }}>Vos coordonnées</div>
                          <div className="hub-form-group">
                            <label>Nom complet *</label>
                            <input className="hub-input" value={orderForm.customer_name}
                              onChange={e => setOrderForm({ ...orderForm, customer_name: e.target.value })}
                              placeholder="Prénom et Nom" />
                            {formErrors.customer_name && <div style={{ color: '#dc2626', fontSize: '0.72rem', marginTop: 3 }}>{formErrors.customer_name}</div>}
                          </div>
                          <div className="hub-form-group">
                            <label>Téléphone *</label>
                            <input className="hub-input" value={orderForm.customer_phone}
                              onChange={e => setOrderForm({ ...orderForm, customer_phone: e.target.value })}
                              placeholder="+242 06 ..." />
                            {formErrors.customer_phone && <div style={{ color: '#dc2626', fontSize: '0.72rem', marginTop: 3 }}>{formErrors.customer_phone}</div>}
                          </div>
                          <div className="hub-form-group">
                            <label>Email</label>
                            <input className="hub-input" type="email" value={orderForm.customer_email}
                              onChange={e => setOrderForm({ ...orderForm, customer_email: e.target.value })}
                              placeholder="votre@email.com" />
                          </div>
                          <div className="hub-form-group">
                            <label>Organisation / Institution</label>
                            <input className="hub-input" value={orderForm.organization}
                              onChange={e => setOrderForm({ ...orderForm, organization: e.target.value })}
                              placeholder="Optionnel" />
                          </div>
                          <div className="hub-form-group">
                            <label>Adresse de livraison</label>
                            <input className="hub-input" value={orderForm.delivery_address}
                              onChange={e => setOrderForm({ ...orderForm, delivery_address: e.target.value })}
                              placeholder="Quartier, ville..." />
                          </div>
                          <div className="hub-form-group">
                            <label>Notes / précisions</label>
                            <textarea className="hub-input" rows={2} value={orderForm.notes}
                              onChange={e => setOrderForm({ ...orderForm, notes: e.target.value })}
                              placeholder="Livraison souhaitée, conditions particulières..." style={{ resize: 'vertical' }} />
                          </div>
                          {formErrors.lines && <div style={{ color: '#dc2626', fontSize: '0.75rem', margin: '6px 0' }}>{formErrors.lines}</div>}
                          {orderError && <div className="alert alert-error" style={{ margin: '8px 0' }}>{orderError}</div>}
                          <button type="submit" className="btn-primary"
                            style={{ width: '100%', justifyContent: 'center', padding: '13px' }}
                            disabled={placingOrder || cart.length === 0}>
                            {placingOrder ? 'Envoi en cours…' : `📤 Passer la commande — ${formatFCFA(cartTotal)}`}
                          </button>
                          <div style={{ fontSize: '0.7rem', color: '#aaa', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
                            Aucun paiement en ligne : un conseiller vous appellera pour confirmer.
                          </div>
                        </form>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Sections classiques (demande / offres / candidature) */}
        {activeSection !== 'catalog' && (
          <div style={{ maxWidth: 800, margin: '0 auto' }}>

            {/* Section: Demande de document */}
            {activeSection === 'requests' && (
              <div>
                <h2 style={{ fontFamily: 'Georgia, serif', color: 'var(--hub-green)', marginBottom: 8, fontSize: '1.5rem' }}>
                  📋 Demande de document officiel
                </h2>
                <p style={{ color: '#666', marginBottom: 24, fontSize: '0.875rem' }}>
                  Pour les institutions (DGI, assurances, douanes, etc.) et partenaires souhaitant obtenir un document officiel de HUB Distribution.
                </p>

                {requestSuccess ? (
                  <div className="alert alert-success" style={{ fontSize: '1rem', padding: '20px' }}>
                    ✅ <strong>Demande envoyée avec succès !</strong> Notre équipe vous contactera sous 48h à l&apos;adresse indiquée. Conservez votre email de confirmation.
                    <button className="btn-ghost" style={{ marginTop: 12, display: 'block' }} onClick={() => setRequestSuccess(false)}>
                      Nouvelle demande
                    </button>
                  </div>
                ) : (
                  <div style={{ background: 'white', borderRadius: 16, padding: 32, border: '1px solid #e8e4db' }}>
                    <form onSubmit={submitRequest}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <div className="hub-form-group">
                          <label>Votre nom *</label>
                          <input className="hub-input" required value={requestForm.requester_name}
                            onChange={e => setRequestForm({...requestForm, requester_name: e.target.value})}
                            placeholder="Prénom et Nom" />
                        </div>
                        <div className="hub-form-group">
                          <label>Organisation / Institution *</label>
                          <input className="hub-input" required value={requestForm.organization}
                            onChange={e => setRequestForm({...requestForm, organization: e.target.value})}
                            placeholder="Ex: Direction des Impôts" />
                        </div>
                        <div className="hub-form-group">
                          <label>Email *</label>
                          <input className="hub-input" type="email" required value={requestForm.email}
                            onChange={e => setRequestForm({...requestForm, email: e.target.value})}
                            placeholder="contact@institution.cg" />
                        </div>
                        <div className="hub-form-group">
                          <label>Téléphone</label>
                          <input className="hub-input" value={requestForm.phone}
                            onChange={e => setRequestForm({...requestForm, phone: e.target.value})}
                            placeholder="+242 06 ..." />
                        </div>
                        <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                          <label>Type de document souhaité *</label>
                          <select className="hub-select" required value={requestForm.document_type}
                            onChange={e => setRequestForm({...requestForm, document_type: e.target.value})}>
                            <option value="">-- Sélectionner le document --</option>
                            {documentTypes.map(d => <option key={d}>{d}</option>)}
                          </select>
                        </div>
                        <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                          <label>Motif / Précisions</label>
                          <textarea className="hub-input" value={requestForm.description}
                            onChange={e => setRequestForm({...requestForm, description: e.target.value})}
                            rows={3} style={{ resize: 'vertical' }}
                            placeholder="Expliquez le contexte ou l'utilisation prévue du document..." />
                        </div>
                      </div>
                      <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '14px', marginTop: 8 }} disabled={submitting}>
                        {submitting ? 'Envoi en cours...' : '📤 Soumettre la demande'}
                      </button>
                    </form>
                  </div>
                )}

                {/* Tracking */}
                <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e8e4db', marginTop: 24 }}>
                  <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', marginBottom: 12, fontSize: '0.95rem' }}>🔍 Suivre une demande existante</h3>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <input className="hub-input" placeholder="Référence (ex: A1B2C3D4)" value={trackId}
                      onChange={e => setTrackId(e.target.value)} style={{ flex: 1 }} />
                    <button className="btn-primary" onClick={trackRequest}>Suivre</button>
                  </div>
                  {trackError && <div className="alert alert-error" style={{ marginTop: 12 }}>{trackError}</div>}
                  {trackResult && (
                    <div className="alert alert-success" style={{ marginTop: 12 }}>
                      <div>
                        <strong>{trackResult.requester_name}</strong> — {trackResult.document_type}<br />
                        <span style={{ fontWeight: 700 }}>{statusLabels[trackResult.status]}</span>
                        {trackResult.response_notes && <div style={{ marginTop: 4, fontSize: '0.8rem' }}>📝 {trackResult.response_notes}</div>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Section: Offres d'emploi */}
            {activeSection === 'jobs' && (
              <div>
                <h2 style={{ fontFamily: 'Georgia, serif', color: 'var(--hub-green)', marginBottom: 8, fontSize: '1.5rem' }}>
                  💼 Nos offres d&apos;emploi
                </h2>
                <p style={{ color: '#666', marginBottom: 24, fontSize: '0.875rem' }}>
                  Rejoignez l&apos;équipe HUB Distribution et participez à la transformation agricole en République du Congo.
                </p>
                <div style={{ display: 'grid', gap: 16 }}>
                  {jobs.map(j => (
                    <div key={j.id} style={{ background: 'white', borderRadius: 12, padding: '24px', border: '1px solid #e8e4db' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                        <div>
                          <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '1.1rem', margin: '0 0 4px' }}>{j.title}</h3>
                          <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 8 }}>🏢 {j.department} · 📍 {j.location}</div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <span className="badge badge-green">{j.type.toUpperCase()}</span>
                            {j.deadline && <span className="badge badge-amber">⏰ Avant le {new Date(j.deadline).toLocaleDateString('fr-FR')}</span>}
                          </div>
                        </div>
                        <button className="btn-primary"
                          onClick={() => { setApplyForm({...applyForm, job_id: j.id}); setActiveSection('apply') }}>
                          Postuler →
                        </button>
                      </div>
                      <p style={{ color: '#555', fontSize: '0.875rem', marginTop: 14, lineHeight: 1.6 }}>{j.description}</p>
                      {j.requirements && (
                        <div style={{ marginTop: 12, background: '#f8f5ee', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem', color: '#555' }}>
                          <strong>Profil recherché :</strong> {j.requirements}
                        </div>
                      )}
                    </div>
                  ))}
                  {jobs.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 60, color: '#999', background: 'white', borderRadius: 12, border: '1px solid #e8e4db' }}>
                      Aucune offre d&apos;emploi disponible pour le moment.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Section: Candidature */}
            {activeSection === 'apply' && (
              <div>
                <h2 style={{ fontFamily: 'Georgia, serif', color: 'var(--hub-green)', marginBottom: 8, fontSize: '1.5rem' }}>
                  👤 Soumettre une candidature
                </h2>
                {applySuccess ? (
                  <div className="alert alert-success" style={{ fontSize: '1rem', padding: '20px' }}>
                    ✅ <strong>Candidature envoyée !</strong> Nous avons bien reçu votre dossier. Nous vous contacterons si votre profil correspond à nos besoins.
                    <button className="btn-ghost" style={{ marginTop: 12, display: 'block' }} onClick={() => setApplySuccess(false)}>
                      Nouvelle candidature
                    </button>
                  </div>
                ) : (
                  <div style={{ background: 'white', borderRadius: 16, padding: 32, border: '1px solid #e8e4db' }}>
                    <form onSubmit={submitApplication}>
                      <div className="hub-form-group">
                        <label>Poste visé *</label>
                        <select className="hub-select" required value={applyForm.job_id}
                          onChange={e => setApplyForm({...applyForm, job_id: e.target.value})}>
                          <option value="">-- Sélectionner un poste --</option>
                          {jobs.map(j => <option key={j.id} value={j.id}>{j.title} ({j.department})</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <div className="hub-form-group">
                          <label>Nom complet *</label>
                          <input className="hub-input" required value={applyForm.name}
                            onChange={e => setApplyForm({...applyForm, name: e.target.value})} placeholder="Prénom et Nom" />
                        </div>
                        <div className="hub-form-group">
                          <label>Email *</label>
                          <input className="hub-input" type="email" required value={applyForm.email}
                            onChange={e => setApplyForm({...applyForm, email: e.target.value})} placeholder="votre@email.com" />
                        </div>
                        <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                          <label>Téléphone</label>
                          <input className="hub-input" value={applyForm.phone}
                            onChange={e => setApplyForm({...applyForm, phone: e.target.value})} placeholder="+242 06 ..." />
                        </div>
                      </div>
                      <div className="hub-form-group">
                        <label>Lettre de motivation</label>
                        <textarea className="hub-input" value={applyForm.cover_letter}
                          onChange={e => setApplyForm({...applyForm, cover_letter: e.target.value})}
                          rows={5} style={{ resize: 'vertical' }}
                          placeholder="Présentez-vous et expliquez votre motivation..." />
                      </div>
                      <button type="submit" className="btn-primary"
                        style={{ width: '100%', justifyContent: 'center', padding: '14px', marginTop: 8 }} disabled={submitting}>
                        {submitting ? 'Envoi...' : '📤 Envoyer ma candidature'}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ background: 'var(--hub-green)', color: 'rgba(255,255,255,0.6)', textAlign: 'center', padding: '24px 20px', fontSize: '0.8rem' }}>
        🌿 HUB Distribution — Transformation & Distribution Agricole — Brazzaville, République du Congo
        <div style={{ marginTop: 8 }}>
          <a href="/login" style={{ color: 'var(--hub-amber-light)', textDecoration: 'none' }}>Accès espace interne →</a>
        </div>
      </div>
    </div>
  )
}
