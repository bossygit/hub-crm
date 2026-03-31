import { createClient } from '@/lib/supabase/server'

export default async function ReportsPage() {
  const supabase = await createClient()

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [
    { data: salesData },
    { data: products },
    { data: batches },
    { data: movements },
    { count: totalEmployees },
    { data: pendingDocs },
    { count: pendingRequests },
  ] = await Promise.all([
    supabase.from('sales').select('status, total_amount, tax_amount, created_at, client:clients(name)'),
    supabase.from('products').select('id, name, quantity, threshold_alert, unit, price_per_unit'),
    supabase.from('product_batches').select('product_id, quantity, expiry_date, product:products(name)'),
    supabase.from('stock_movements').select('type, quantity, created_at').gte('created_at', startOfMonth),
    supabase.from('employees').select('*', { count: 'exact', head: true }).eq('status', 'actif'),
    supabase.from('documents').select('id, title, type, status, created_at').eq('status', 'pending'),
    supabase.from('document_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
  ])

  const approvedSales = (salesData || []).filter(s => s.status === 'approved')
  const pendingSales = (salesData || []).filter(s => s.status === 'pending')
  const totalCA = approvedSales.reduce((s, sale) => s + Number(sale.total_amount || 0), 0)
  const totalTVA = approvedSales.reduce((s, sale) => s + Number(sale.tax_amount || 0), 0)
  const monthSales = approvedSales.filter(s => s.created_at >= startOfMonth)
  const monthCA = monthSales.reduce((s, sale) => s + Number(sale.total_amount || 0) + Number(sale.tax_amount || 0), 0)

  const lowStock = (products || []).filter(p => p.quantity <= p.threshold_alert)
  const today = new Date().toISOString().split('T')[0]
  const expiredBatches = (batches || []).filter(b => b.expiry_date && b.expiry_date < today && b.quantity > 0)
  const soonExpiring = (batches || []).filter(b => {
    if (!b.expiry_date || b.quantity <= 0) return false
    const diff = (new Date(b.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    return diff >= 0 && diff <= 30
  })

  const stockValue = (products || []).reduce((s, p) => s + p.quantity * (p.price_per_unit || 0), 0)
  const monthIN = (movements || []).filter(m => m.type === 'IN').reduce((s, m) => s + Number(m.quantity), 0)
  const monthOUT = (movements || []).filter(m => m.type === 'OUT').reduce((s, m) => s + Number(m.quantity), 0)

  return (
    <div>
      <div className="page-header">
        <h2>📊 Rapports & Tableaux de bord</h2>
        <div style={{ fontSize: '0.8rem', color: '#666' }}>
          Période : {now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
        </div>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* KPIs principaux */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, marginBottom: 32 }}>
          <div className="stat-card green">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>💵</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{totalCA.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
            <div className="stat-label">FCFA — CA cumulé HT</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>📈</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{monthCA.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
            <div className="stat-label">FCFA — CA ce mois TTC</div>
          </div>
          <div className="stat-card blue">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>🏦</div>
            <div className="stat-value" style={{ fontSize: '1.3rem' }}>{totalTVA.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
            <div className="stat-label">FCFA — TVA collectée</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>⏳</div>
            <div className="stat-value">{pendingSales.length}</div>
            <div className="stat-label">Ventes en validation</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>📦</div>
            <div className="stat-value">{stockValue.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
            <div className="stat-label">FCFA — Valeur du stock</div>
          </div>
          <div className="stat-card red">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>⚠️</div>
            <div className="stat-value">{lowStock.length}</div>
            <div className="stat-label">Produits stock bas</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>👥</div>
            <div className="stat-value">{totalEmployees ?? 0}</div>
            <div className="stat-label">Employés actifs</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>📬</div>
            <div className="stat-value">{pendingRequests ?? 0}</div>
            <div className="stat-label">Demandes en attente</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Alertes stocks */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', background: '#fff7ed' }}>
              <h3 style={{ fontWeight: 700, color: '#92400e', fontSize: '0.9rem' }}>⚠️ Alertes Stock ({lowStock.length})</h3>
            </div>
            {lowStock.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>✅ Tous les stocks sont OK</div>
            ) : (
              <div>
                {lowStock.slice(0, 6).map(p => (
                  <div key={p.id} style={{ padding: '10px 20px', borderBottom: '1px solid #f8f6f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{p.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#92400e' }}>Seuil: {p.threshold_alert} {p.unit}</div>
                    </div>
                    <span className="badge badge-red">{p.quantity} {p.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Péremptions */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4', background: expiredBatches.length > 0 ? '#fef2f2' : '#fff7ed' }}>
              <h3 style={{ fontWeight: 700, color: expiredBatches.length > 0 ? '#991b1b' : '#92400e', fontSize: '0.9rem' }}>
                🕐 Péremptions — {expiredBatches.length} expirés, {soonExpiring.length} bientôt
              </h3>
            </div>
            {expiredBatches.length === 0 && soonExpiring.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>✅ Aucun lot proche de péremption</div>
            ) : (
              <div>
                {[...expiredBatches.map(b => ({ ...b, expired: true })), ...soonExpiring.map(b => ({ ...b, expired: false }))].slice(0, 6).map(b => {
                  const daysLeft = Math.ceil((new Date(b.expiry_date!).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  return (
                    <div key={b.id} style={{ padding: '10px 20px', borderBottom: '1px solid #f8f6f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{(b.product as any)?.name} — Lot {b.batch_number}</div>
                        <div style={{ fontSize: '0.75rem', color: '#666' }}>Exp: {new Date(b.expiry_date!).toLocaleDateString('fr-FR')} · {b.quantity} unités</div>
                      </div>
                      <span className={`badge ${b.expired ? 'badge-red' : 'badge-amber'}`}>{b.expired ? '❌ Expiré' : `J-${daysLeft}`}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Mouvements du mois */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4' }}>
              <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.9rem' }}>📦 Mouvements ce mois</h3>
            </div>
            <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ textAlign: 'center', background: '#ecfdf5', borderRadius: 10, padding: '20px' }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#065f46' }}>+{monthIN.toLocaleString()}</div>
                <div style={{ fontSize: '0.75rem', color: '#065f46', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>Unités entrées</div>
              </div>
              <div style={{ textAlign: 'center', background: '#fef2f2', borderRadius: 10, padding: '20px' }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#991b1b' }}>-{monthOUT.toLocaleString()}</div>
                <div style={{ fontSize: '0.75rem', color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>Unités sorties</div>
              </div>
            </div>
          </div>

          {/* Documents en attente */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0ece4' }}>
              <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.9rem' }}>📄 Documents en attente de validation ({(pendingDocs || []).length})</h3>
            </div>
            {(pendingDocs || []).length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>✅ Aucun document en attente</div>
            ) : (
              <div>
                {(pendingDocs || []).slice(0, 5).map(d => (
                  <div key={d.id} style={{ padding: '10px 20px', borderBottom: '1px solid #f8f6f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{d.title}</div>
                      <div style={{ fontSize: '0.75rem', color: '#666' }}>{d.type} · {new Date(d.created_at).toLocaleDateString('fr-FR')}</div>
                    </div>
                    <span className="badge badge-amber">En attente</span>
                  </div>
                ))}
                {(pendingDocs || []).length > 5 && (
                  <div style={{ padding: '10px 20px', textAlign: 'center', fontSize: '0.8rem', color: '#999' }}>
                    + {(pendingDocs || []).length - 5} autres <a href="/documents" style={{ color: 'var(--hub-green-mid)' }}>→ Voir tous</a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
