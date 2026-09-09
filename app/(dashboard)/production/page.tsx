'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import type { Product } from '@/types'
import { useToast } from '@/components/ui/Toast'
import { computeYieldPct, yieldBadgeClass, yieldLabel } from '@/lib/production/yield'

const statusConfig: Record<string, { label: string; badge: string; icon: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray', icon: '✏️' },
  pending: { label: 'Planifié', badge: 'badge-amber', icon: '⏳' },
  approved: { label: 'Produit', badge: 'badge-green', icon: '✅' },
  cancelled: { label: 'Annulé', badge: 'badge-red', icon: '❌' },
}

const emptyRecipeItem = () => ({ product_id: '', quantity: 1, unit: 'kg' })

export default function ProductionPage() {
  const [tab, setTab] = useState<'orders' | 'recipes'>('orders')
  const [orders, setOrders] = useState<any[]>([])
  const [recipes, setRecipes] = useState<any[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showRecipeModal, setShowRecipeModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [recipeForm, setRecipeForm] = useState({ name: '', product_id: '', output_quantity: 1, unit: 'kg', notes: '' })
  const [recipeItems, setRecipeItems] = useState([emptyRecipeItem()])
  const supabase = createClient()
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: o }, { data: r }, { data: p }] = await Promise.all([
      supabase.from('production_orders').select('*, product:products(name,unit), recipe:recipes(name)').order('created_at', { ascending: false }),
      supabase.from('recipes').select('*, product:products(name,unit), items:recipe_items(id, product_id, quantity, unit, product:products(name,unit))').order('name'),
      supabase.from('products').select('*').order('name'),
    ])
    setOrders(o || [])
    setRecipes(r || [])
    setProducts(p || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function saveRecipe(e: React.FormEvent) {
    e.preventDefault()
    const valid = recipeItems.filter(it => it.product_id && it.quantity > 0)
    if (!recipeForm.name.trim() || !recipeForm.product_id) { toast('warning', 'Nom et produit fini requis.'); return }
    if (valid.length === 0) { toast('warning', 'Ajoutez au moins une matière première.'); return }
    setSaving(true)
    const { data: rec, error } = await supabase.from('recipes').insert({
      name: recipeForm.name,
      product_id: recipeForm.product_id,
      output_quantity: recipeForm.output_quantity,
      unit: recipeForm.unit,
      notes: recipeForm.notes,
    }).select('id').single()
    if (error || !rec) { toast('error', error?.message || 'Erreur'); setSaving(false); return }
    await supabase.from('recipe_items').insert(valid.map((it, idx) => ({
      recipe_id: rec.id, product_id: it.product_id, quantity: it.quantity, unit: it.unit, sort_order: idx,
    })))
    setSaving(false)
    setShowRecipeModal(false)
    setRecipeForm({ name: '', product_id: '', output_quantity: 1, unit: 'kg', notes: '' })
    setRecipeItems([emptyRecipeItem()])
    toast('success', 'Recette enregistrée.')
    load()
  }

  async function deleteRecipe(id: string) {
    if (!confirm('Supprimer cette recette ?')) return
    const { error } = await supabase.from('recipes').delete().eq('id', id)
    if (error) toast('error', error.message)
    else load()
  }

  const summary = {
    total: orders.length,
    approved: orders.filter(o => o.status === 'approved').length,
    pending: orders.filter(o => o.status === 'pending' || o.status === 'draft').length,
    recipes: recipes.length,
  }

  return (
    <div>
      <div className="page-header">
        <h2>🏭 Production</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          {tab === 'recipes'
            ? <button className="btn-amber" onClick={() => setShowRecipeModal(true)}>+ Recette</button>
            : <Link href="/production/new" className="btn-primary" style={{ textDecoration: 'none' }}>+ Ordre de production</Link>}
        </div>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: '#f0ece4', borderRadius: 8, padding: 4, width: 'fit-content' }}>
          {([['orders', `Ordres (${orders.length})`], ['recipes', `Recettes (${recipes.length})`]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
              background: tab === key ? 'white' : 'transparent', color: tab === key ? 'var(--hub-green)' : '#666', boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'orders' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 14, marginBottom: 28 }}>
              <div className="stat-card green"><div className="stat-value">{summary.total}</div><div className="stat-label">Ordres</div></div>
              <div className="stat-card green"><div className="stat-value">{summary.approved}</div><div className="stat-label">Produits</div></div>
              <div className="stat-card amber"><div className="stat-value">{summary.pending}</div><div className="stat-label">En cours</div></div>
              <div className="stat-card"><div className="stat-value">{summary.recipes}</div><div className="stat-label">Recettes</div></div>
            </div>
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
                <table className="hub-table">
                  <thead><tr><th>N° ordre</th><th>Recette</th><th>Produit fini</th><th>Quantité</th><th>Statut</th><th>Rendement</th><th></th></tr></thead>
                  <tbody>
                    {orders.map(o => {
                      const cfg = statusConfig[o.status] || statusConfig.draft
                      const pct = o.actual_output_quantity != null
                        ? computeYieldPct(Number(o.actual_output_quantity), Number(o.quantity))
                        : null
                      return (
                        <tr key={o.id}>
                          <td><Link href={`/production/${o.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--hub-green-mid)', textDecoration: 'none' }}>{o.order_number}</Link></td>
                          <td>{o.recipe?.name || '—'}</td>
                          <td style={{ fontWeight: 600 }}>{o.product?.name || '—'}</td>
                          <td>{o.quantity} {o.product?.unit || ''}</td>
                          <td><span className={`badge ${cfg.badge}`}>{cfg.icon} {cfg.label}</span></td>
                          <td>{pct != null
                            ? <span className={`badge ${yieldBadgeClass(pct)}`} title={yieldLabel(pct)}>{pct} %</span>
                            : <span style={{ color: '#bbb' }}>—</span>}</td>
                          <td><Link href={`/production/${o.id}`} className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>Voir</Link></td>
                        </tr>
                      )
                    })}
                    {orders.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucun ordre — créez une recette puis lancez une production</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {tab === 'recipes' && (
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div> : (
              <table className="hub-table">
                <thead><tr><th>Recette</th><th>Produit fini</th><th>Pour</th><th>Ingrédients</th><th></th></tr></thead>
                <tbody>
                  {recipes.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 700 }}>{r.name}</td>
                      <td>{r.product?.name}</td>
                      <td>{r.output_quantity} {r.unit}</td>
                      <td style={{ fontSize: '0.85rem', color: '#555' }}>
                        {(r.items || []).map((it: any) => `${it.quantity} ${it.unit} ${it.product?.name || ''}`).join(' · ') || '—'}
                      </td>
                      <td><button className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => deleteRecipe(r.id)}>Supprimer</button></td>
                    </tr>
                  ))}
                  {recipes.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 48, color: '#999' }}>Aucune recette — décrivez la transformation MP → produit fini</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {showRecipeModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowRecipeModal(false)}>
          <div className="modal-box" style={{ maxWidth: 640 }}>
            <div className="modal-title">➕ Nouvelle recette</div>
            <form onSubmit={saveRecipe}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="hub-form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Nom *</label>
                  <input className="hub-input" required value={recipeForm.name} onChange={e => setRecipeForm({ ...recipeForm, name: e.target.value })} placeholder="Farine de manioc 10 kg" />
                </div>
                <div className="hub-form-group">
                  <label>Produit fini *</label>
                  <select className="hub-select" required value={recipeForm.product_id} onChange={e => {
                    const p = products.find(x => x.id === e.target.value)
                    setRecipeForm({ ...recipeForm, product_id: e.target.value, unit: p?.unit || 'kg' })
                  }}>
                    <option value="">— Produit —</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-group">
                  <label>Quantité produite</label>
                  <input className="hub-input" type="number" min={0.01} step="0.01" value={recipeForm.output_quantity} onChange={e => setRecipeForm({ ...recipeForm, output_quantity: parseFloat(e.target.value) || 1 })} />
                </div>
              </div>
              <div style={{ marginTop: 16, fontWeight: 700, fontSize: '0.8rem', color: 'var(--hub-green)', textTransform: 'uppercase' }}>Matières premières (pour cette quantité)</div>
              {recipeItems.map((it, idx) => (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, marginTop: 8 }}>
                  <select className="hub-select" value={it.product_id} onChange={e => {
                    const p = products.find(x => x.id === e.target.value)
                    setRecipeItems(prev => { const u = [...prev]; u[idx] = { ...u[idx], product_id: e.target.value, unit: p?.unit || u[idx].unit }; return u })
                  }}>
                    <option value="">— MP —</option>
                    {products.filter(p => p.id !== recipeForm.product_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input className="hub-input" type="number" min={0} step="0.01" value={it.quantity} onChange={e => setRecipeItems(prev => { const u = [...prev]; u[idx] = { ...u[idx], quantity: parseFloat(e.target.value) || 0 }; return u })} />
                  <select className="hub-select" value={it.unit} onChange={e => setRecipeItems(prev => { const u = [...prev]; u[idx] = { ...u[idx], unit: e.target.value }; return u })}>
                    {['kg', 'g', 'L', 'ml', 'pièce', 'sac'].map(u => <option key={u}>{u}</option>)}
                  </select>
                  <button type="button" onClick={() => recipeItems.length > 1 && setRecipeItems(prev => prev.filter((_, i) => i !== idx))} style={{ border: 'none', background: '#fee2e2', color: '#dc2626', borderRadius: 6, cursor: 'pointer' }}>✕</button>
                </div>
              ))}
              <button type="button" className="btn-ghost" style={{ marginTop: 10 }} onClick={() => setRecipeItems(prev => [...prev, emptyRecipeItem()])}>+ Ingrédient</button>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowRecipeModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? '...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
