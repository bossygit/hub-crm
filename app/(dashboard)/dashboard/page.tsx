import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()

  const [
    { count: totalClients },
    { data: products },
    { count: totalDocuments },
    { count: openJobs },
    { count: pendingRequests },
    { data: recentMovements },
    { data: recentRequests },
  ] = await Promise.all([
    supabase.from('clients').select('*', { count: 'exact', head: true }),
    supabase.from('products').select('id, name, quantity, threshold_alert, unit'),
    supabase.from('documents').select('*', { count: 'exact', head: true }),
    supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('document_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('stock_movements').select('*, product:products(name)').order('created_at', { ascending: false }).limit(5),
    supabase.from('document_requests').select('*').order('created_at', { ascending: false }).limit(4),
  ])

  const lowStock = (products || []).filter(p => p.quantity <= p.threshold_alert)

  return (
    <div>
      <div className="page-header">
        <h2>Tableau de bord</h2>
        <div style={{ fontSize: '0.8rem', color: '#666' }}>
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      <div style={{ padding: '32px' }}>
        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          <div className="stat-card green">
            <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>👥</div>
            <div className="stat-value">{totalClients ?? 0}</div>
            <div className="stat-label">Clients & Partenaires</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>📦</div>
            <div className="stat-value">{(products || []).length}</div>
            <div className="stat-label">Produits en stock</div>
          </div>
          <div className="stat-card red">
            <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>⚠️</div>
            <div className="stat-value">{lowStock.length}</div>
            <div className="stat-label">Alertes stock bas</div>
          </div>
          <div className="stat-card blue">
            <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>📄</div>
            <div className="stat-value">{totalDocuments ?? 0}</div>
            <div className="stat-label">Documents générés</div>
          </div>
          <div className="stat-card green">
            <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>💼</div>
            <div className="stat-value">{openJobs ?? 0}</div>
            <div className="stat-label">Postes ouverts</div>
          </div>
          <div className="stat-card amber">
            <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>📬</div>
            <div className="stat-value">{pendingRequests ?? 0}</div>
            <div className="stat-label">Demandes en attente</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Alertes stock */}
          {lowStock.length > 0 && (
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0ece4', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.95rem' }}>⚠️ Alertes Stock Bas</h3>
                <a href="/stock" style={{ fontSize: '0.8rem', color: 'var(--hub-green-mid)', fontWeight: 600 }}>Voir tout →</a>
              </div>
              {lowStock.map(p => (
                <div key={p.id} className="stock-alert" style={{ margin: '12px', borderRadius: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{p.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#92400e' }}>
                      Stock: <strong>{p.quantity} {p.unit}</strong> / Seuil: {p.threshold_alert} {p.unit}
                    </div>
                    <div className="progress-bar" style={{ marginTop: 6 }}>
                      <div className="progress-fill red" style={{ width: `${Math.min(100, (p.quantity / p.threshold_alert) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Mouvements récents */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0ece4', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.95rem' }}>📦 Derniers Mouvements</h3>
              <a href="/stock" style={{ fontSize: '0.8rem', color: 'var(--hub-green-mid)', fontWeight: 600 }}>Voir tout →</a>
            </div>
            <div>
              {(recentMovements || []).map((m: any) => (
                <div key={m.id} style={{ padding: '12px 20px', borderBottom: '1px solid #f8f6f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span className={`badge ${m.type === 'IN' ? 'badge-green' : 'badge-red'}`} style={{ marginRight: 8 }}>
                      {m.type === 'IN' ? '↑ Entrée' : '↓ Sortie'}
                    </span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{m.product?.name}</span>
                  </div>
                  <span style={{ fontWeight: 700, color: m.type === 'IN' ? '#065f46' : '#991b1b' }}>
                    {m.type === 'IN' ? '+' : '-'}{m.quantity}
                  </span>
                </div>
              ))}
              {(recentMovements || []).length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>
                  Aucun mouvement récent
                </div>
              )}
            </div>
          </div>

          {/* Demandes récentes */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0ece4', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.95rem' }}>📬 Demandes Externes</h3>
              <a href="/requests" style={{ fontSize: '0.8rem', color: 'var(--hub-green-mid)', fontWeight: 600 }}>Voir tout →</a>
            </div>
            {(recentRequests || []).map((r: any) => (
              <div key={r.id} style={{ padding: '12px 20px', borderBottom: '1px solid #f8f6f2' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{r.requester_name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>{r.organization} · {r.document_type}</div>
                  </div>
                  <span className={`badge ${r.status === 'pending' ? 'badge-amber' : r.status === 'approved' ? 'badge-green' : 'badge-gray'}`}>
                    {r.status === 'pending' ? 'En attente' : r.status === 'processing' ? 'En cours' : r.status === 'approved' ? 'Approuvé' : 'Rejeté'}
                  </span>
                </div>
              </div>
            ))}
            {(recentRequests || []).length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>
                Aucune demande récente
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
