'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Product, ProductBatch } from '@/types'
import { useToast } from '@/components/ui/Toast'
import { explodeRecipe, suggestProductionBatchNumber } from '@/lib/production/bom'
import { computeYieldPct, validateActualOutput, yieldLabel } from '@/lib/production/yield'

export default function NewProductionOrderPage() {
  const router = useRouter()
  const [recipes, setRecipes] = useState<any[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [batches, setBatches] = useState<ProductBatch[]>([])
  const [recipeId, setRecipeId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')
  const [actualQty, setActualQty] = useState('')
  const [yieldNotes, setYieldNotes] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [saving, setSaving] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    async function init() {
      const [{ data: r }, { data: p }, { data: b }] = await Promise.all([
        supabase.from('recipes').select('*, product:products(name,unit), items:recipe_items(product_id, quantity, unit, product:products(name,unit))').order('name'),
        supabase.from('products').select('*').order('name'),
        supabase.from('product_batches').select('*').order('expiry_date'),
      ])
      setRecipes(r || [])
      setProducts(p || [])
      setBatches((b || []) as ProductBatch[])
    }
    init()
  }, [])

  const recipe = recipes.find(r => r.id === recipeId)
  const exploded = useMemo(() => {
    if (!recipe) return { lines: [], shortfalls: [] }
    const ingredients = (recipe.items || []).map((it: any) => ({
      product_id: it.product_id,
      name: it.product?.name || 'MP',
      quantity: Number(it.quantity),
      unit: it.unit || 'kg',
    }))
    return explodeRecipe(ingredients, Number(recipe.output_quantity) || 1, quantity, batches)
  }, [recipe, quantity, batches])

  useEffect(() => {
    if (recipe) setQuantity(Number(recipe.output_quantity) || 1)
  }, [recipeId])

  // Saisie du rendement : « 9,5 » comme « 9.5 » (champ vide → null = identique au planifié).
  function toNumberOrNull(raw: string): number | null {
    const t = raw.trim().replace(',', '.')
    if (t === '') return null
    return Number(t)
  }

  async function handleSave(targetStatus: 'draft' | 'approved') {
    if (!recipe) { toast('warning', 'Choisissez une recette.'); return }
    if (quantity <= 0) { toast('warning', 'Quantité à produire invalide.'); return }
    if (targetStatus === 'approved' && exploded.shortfalls.length > 0) {
      toast('warning', 'Stock de matières premières insuffisant (FEFO).')
      return
    }
    if (targetStatus === 'approved' && exploded.lines.some(l => !l.batch_id)) {
      toast('warning', 'Chaque matière doit avoir un lot.')
      return
    }
    if (targetStatus === 'approved') {
      const actualError = validateActualOutput(toNumberOrNull(actualQty), quantity)
      if (actualError) { toast('warning', actualError); return }
    }
    setSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const { data: numData } = await supabase.rpc('generate_production_number')
      const orderNumber = numData as string
      const { data: doc, error } = await supabase.from('production_orders').insert({
        order_number: orderNumber,
        recipe_id: recipe.id,
        product_id: recipe.product_id,
        quantity,
        status: 'draft',
        batch_number: suggestProductionBatchNumber(orderNumber),
        production_date: new Date().toISOString().split('T')[0],
        expiry_date: expiryDate || null,
        notes,
        created_by: userData.user?.id,
      }).select('id').single()
      if (error || !doc) throw new Error(error?.message || 'Erreur')
      if (exploded.lines.length > 0) {
        const { error: itemsError } = await supabase.from('production_order_items').insert(
          exploded.lines.map((it, idx) => ({
            order_id: doc.id,
            product_id: it.product_id,
            batch_id: it.batch_id,
            name: it.name,
            quantity: it.quantity,
            unit: it.unit,
            sort_order: idx,
          }))
        )
        if (itemsError) throw new Error(itemsError.message)
      }
      if (targetStatus === 'approved') {
        const { error: upError } = await supabase.from('production_orders').update({
          status: 'approved',
          actual_output_quantity: toNumberOrNull(actualQty),
          yield_notes: yieldNotes.trim() || null,
          completed_by: userData.user?.id,
          updated_at: new Date().toISOString(),
        }).eq('id', doc.id)
        if (upError) throw new Error(upError.message)
      }
      toast('success', targetStatus === 'approved' ? 'Production enregistrée, stock mis à jour.' : 'Ordre enregistré.')
      router.push(`/production/${doc.id}`)
    } catch (err: unknown) {
      toast('error', 'Erreur: ' + (err instanceof Error ? err.message : String(err)))
    } finally { setSaving(false) }
  }

  const pfName = recipe?.product?.name || products.find(p => p.id === recipe?.product_id)?.name
  const pfUnit = recipe?.product?.unit || products.find(p => p.id === recipe?.product_id)?.unit || ''

  return (
    <div className="invoice-page invoice-page--new">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--hub-green)' }}>←</button>
          <h2>🏭 Nouvel ordre de production</h2>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" className="btn-ghost" onClick={() => handleSave('draft')} disabled={saving}>💾 Brouillon</button>
          <button type="button" className="btn-primary" onClick={() => handleSave('approved')} disabled={saving}>✅ Produire</button>
        </div>
      </div>

      <div className="invoice-page__body">
        <div className="invoice-form__layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--hub-amber)' }}>Recette</div>
              {recipes.length === 0 ? (
                <p style={{ color: '#666', fontSize: '0.9rem' }}>Aucune recette. <Link href="/production">Créer une recette</Link> d’abord.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
                  <select className="hub-select" value={recipeId} onChange={e => setRecipeId(e.target.value)}>
                    <option value="">— Choisir une recette —</option>
                    {recipes.map(r => <option key={r.id} value={r.id}>{r.name} → {r.product?.name}</option>)}
                  </select>
                  <input className="hub-input" type="number" min={0.01} step="0.01" value={quantity} onChange={e => setQuantity(parseFloat(e.target.value) || 0)} />
                  <input className="hub-input" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} title="Péremption PF" />
                </div>
              )}
              {recipe && <div style={{ marginTop: 10, fontSize: '0.85rem', color: '#666' }}>Produit fini : <strong>{pfName}</strong> · recette pour {recipe.output_quantity} {recipe.unit}</div>}
            </div>

            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Matières consommées (FEFO)</div>
              {exploded.shortfalls.length > 0 && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  Stock insuffisant : {exploded.shortfalls.map(s => {
                    const name = exploded.lines.find(l => l.product_id === s.product_id)?.name || s.product_id
                    return `${name} (manque ${s.missing})`
                  }).join(', ')}
                </div>
              )}
              <table className="hub-table">
                <thead><tr><th>Matière</th><th>Lot</th><th>Qté</th></tr></thead>
                <tbody>
                  {exploded.lines.map((l, i) => {
                    const batch = batches.find(b => b.id === l.batch_id)
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{l.name}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{batch?.batch_number || '—'}</td>
                        <td>{l.quantity} {l.unit}</td>
                      </tr>
                    )
                  })}
                  {exploded.lines.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 32, color: '#999' }}>Choisissez une recette</td></tr>}
                </tbody>
              </table>
            </div>

            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', padding: '24px' }}>
              <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>📊 Rendement (optionnel)</div>
              <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: 14 }}>
                Quantité réellement obtenue sur le terrain. Laissez vide si identique au planifié ({quantity} {pfUnit}). Saisie prise en compte lors de la validation « ✅ Produire » : le lot produit fini et l'entrée en stock sont alors créés au réel.
              </div>
              <div className="hub-form-group">
                <label>Quantité réellement obtenue{pfUnit ? ` (${pfUnit})` : ''}</label>
                <input className="hub-input" type="number" min={0.01} step="0.01" value={actualQty} onChange={e => setActualQty(e.target.value)} placeholder={quantity > 0 ? String(quantity) : '0'} />
              </div>
              {(() => {
                const a = toNumberOrNull(actualQty)
                if (a != null && a > 0) {
                  const pct = computeYieldPct(a, quantity)
                  if (pct != null) return <div style={{ fontSize: '0.85rem', marginTop: 6 }}>Rendement estimé : <strong>{pct} %</strong> — {yieldLabel(pct)}</div>
                }
                return null
              })()}
              <div className="hub-form-group" style={{ marginTop: 12 }}>
                <label>Notes de production (pertes, incidents)</label>
                <textarea className="hub-input" rows={2} value={yieldNotes} onChange={e => setYieldNotes(e.target.value)} placeholder="Ex : 1,2 kg de pertes au séchage, arrêt machine 10 min..." style={{ resize: 'vertical' }} />
              </div>
            </div>

            <textarea className="hub-input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes atelier..." style={{ resize: 'vertical' }} />
          </div>
        </div>
      </div>
    </div>
  )
}
