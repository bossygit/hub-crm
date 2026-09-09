import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { ReactNode } from 'react'
import PendingValidationsBlock from './PendingValidationsBlock'

const MANAGER_ROLES = ['ceo', 'manager', 'admin']

const MOV_TYPE: Record<string, { badge: string; label: string; arrow: string; color: string }> = {
  IN: { badge: 'badge-green', label: 'Entrée', arrow: '↑', color: '#065f46' },
  OUT: { badge: 'badge-red', label: 'Sortie', arrow: '↓', color: '#991b1b' },
  ADJUST: { badge: 'badge-blue', label: 'Ajustement', arrow: '↔', color: '#1e40af' },
}

const INV_STATUS: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Brouillon', badge: 'badge-gray' },
  pending: { label: 'En attente', badge: 'badge-amber' },
  approved: { label: 'Validée', badge: 'badge-green' },
  partial: { label: 'Partielle', badge: 'badge-blue' },
  paid: { label: 'Payée', badge: 'badge-green' },
  cancelled: { label: 'Annulée', badge: 'badge-red' },
}

const REQ_LABEL: Record<string, string> = {
  pending: 'En attente',
  processing: 'En cours',
  approved: 'Approuvée',
  rejected: 'Rejetée',
}
const REQ_BADGE: Record<string, string> = {
  pending: 'badge-amber',
  processing: 'badge-blue',
  approved: 'badge-green',
  rejected: 'badge-red',
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function fmtYMD(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function fmtDate(v?: string | null) {
  if (!v) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (!m) return v
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(dt.getTime())) return v
  return dt.toLocaleDateString('fr-FR')
}
function fmtAmount(n: number) {
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`
}
function fmtQty(n: number) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}
function daysFromToday(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr)
  if (!m) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Math.round((dt.getTime() - today.getTime()) / 86400000)
}

function StatCard({ icon, value, label, tone, href }: { icon: string; value: number | string; label: string; tone: string; href: string }) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div className={`stat-card ${tone}`}>
        <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>{icon}</div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </Link>
  )
}

function Panel({ title, to, linkLabel = 'Voir tout →', span = false, children }: { title: string; to: string; linkLabel?: string; span?: boolean; children: ReactNode }) {
  return (
    <section style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden', display: 'flex', flexDirection: 'column', ...(span ? { gridColumn: '1 / -1' } : {}) }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0ece4', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.95rem', margin: 0 }}>{title}</h3>
        <Link href={to} style={{ fontSize: '0.8rem', color: 'var(--hub-green-mid)', fontWeight: 600, whiteSpace: 'nowrap' }}>{linkLabel}</Link>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </section>
  )
}

function EmptyState({ message, actionLabel, href }: { message: string; actionLabel: string; href: string }) {
  return (
    <div style={{ padding: '30px 20px', textAlign: 'center' }}>
      <div style={{ color: '#666', fontSize: '0.875rem', lineHeight: 1.5, marginBottom: 14 }}>{message}</div>
      <Link href={href} className="btn-primary" style={{ textDecoration: 'none', padding: '8px 16px', fontSize: '0.8rem' }}>{actionLabel}</Link>
    </div>
  )
}

function RowDivider({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '10px 20px', borderBottom: '1px solid #f0ece4', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {children}
    </div>
  )
}

interface PulseTile {
  icon: string
  label: string
  value: string
  sub?: string
  href: string
}

function PulseRow({ tiles }: { tiles: PulseTile[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
      {tiles.map(t => (
        <Link key={t.label} href={t.href} style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'white', border: '1px solid #e8e4db', borderRadius: 12, padding: '14px 16px',
            display: 'flex', flexDirection: 'column', gap: 2, transition: 'box-shadow 0.15s, transform 0.15s',
          }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.08)'; el.style.transform = 'translateY(-1px)' }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = 'none'; el.style.transform = 'none' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: '1.2rem' }}>{t.icon}</span>
              <span style={{ color: '#bbb', fontSize: '0.8rem' }}>→</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--hub-green)', fontFamily: 'Georgia, serif', lineHeight: 1.1 }}>{t.value}</div>
            <div style={{ fontSize: '0.72rem', color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.label}</div>
            {t.sub && <div style={{ fontSize: '0.78rem', color: '#92400e', fontWeight: 600, marginTop: 2 }}>{t.sub}</div>}
          </div>
        </Link>
      ))}
    </div>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, full_name, can_validate_invoices')
    .eq('id', user.id)
    .single()

  const role = profile?.role as string | undefined
  const isManager = !!role && MANAGER_ROLES.includes(role)

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const todayStr = fmtYMD(now)
  const horizonStr = fmtYMD(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30))
  const monthName = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  const [
    clientsRes,
    productsRes,
    docsRes,
    jobsRes,
    requestsRes,
    movementsRes,
    recentReqsRes,
    quotesRes,
    blRes,
    purchasesRes,
    batchesRes,
  ] = await Promise.all([
    supabase.from('clients').select('*', { count: 'exact', head: true }),
    supabase.from('products').select('id, name, quantity, threshold_alert, unit'),
    supabase.from('documents').select('*', { count: 'exact', head: true }),
    supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('document_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('stock_movements').select('*, product:products(name, unit)').order('created_at', { ascending: false }).limit(8),
    supabase.from('document_requests').select('*').order('created_at', { ascending: false }).limit(4),
    supabase.from('documents').select('*', { count: 'exact', head: true }).eq('type', 'devis').eq('status', 'pending'),
    supabase.from('documents').select('*', { count: 'exact', head: true }).eq('type', 'bon_livraison').eq('status', 'pending'),
    supabase.from('purchases').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('product_batches').select('id, batch_number, quantity, expiry_date, quality_status, product:products(name, unit)'),
  ])

  // Indicateurs financiers du mois — uniquement pour les rôles de direction.
  let monthValidated = 0
  let monthCA = 0
  let recentInvoices: any[] = []
  if (isManager) {
    const [monthInvRes, recentInvRes] = await Promise.all([
      supabase.from('invoices').select('total').gte('date', fmtYMD(monthStart)).lte('date', fmtYMD(monthEnd)).in('status', ['approved', 'partial', 'paid']),
      supabase.from('invoices').select('id, invoice_number, date, status, total, client:clients(name)').order('created_at', { ascending: false }).limit(5),
    ])
    const rows = monthInvRes.data || []
    monthValidated = rows.length
    monthCA = rows.reduce((s: number, r: any) => s + Number(r.total || 0), 0)
    recentInvoices = recentInvRes.data || []
  }

  const errors = ([
    clientsRes, productsRes, docsRes, jobsRes, requestsRes,
    movementsRes, recentReqsRes, quotesRes, blRes, purchasesRes, batchesRes,
  ] as any[])
    .filter(r => r?.error)
    .map(r => r.error?.message as string)
    .filter(Boolean)
  if (profileError) errors.push(profileError.message)

  const products = productsRes.data || []
  const lowStock = products.filter((p: any) => Number(p.quantity) <= Number(p.threshold_alert))
  const movements = movementsRes.data || []
  const recentRequests = recentReqsRes.data || []
  const batches: any[] = batchesRes.data || []

  const quarantine = batches.filter(b => b.quality_status === 'pending')
  const risky = batches
    .filter(b => b.expiry_date && Number(b.quantity) > 0 && String(b.expiry_date) <= horizonStr)
    .sort((a: any, b: any) => String(a.expiry_date).localeCompare(String(b.expiry_date)))
  const expiredCount = risky.filter(b => String(b.expiry_date) < todayStr).length
  const soonCount = risky.length - expiredCount
  const hasQualityAlerts = risky.length > 0 || quarantine.length > 0

  const totalClients = clientsRes.count ?? 0
  const totalDocuments = docsRes.count ?? 0
  const openJobs = jobsRes.count ?? 0
  const pendingRequests = requestsRes.count ?? 0
  const pendingQuotes = quotesRes.count ?? 0
  const pendingBL = blRes.count ?? 0
  const pendingPurchases = purchasesRes.count ?? 0

  // Actions rapides
  const quickActions = [
    { icon: '🧾', label: 'Nouvelle facture', href: '/invoices/new' },
    { icon: '📝', label: 'Nouveau devis', href: '/quotes/new' },
    { icon: '🛒', label: 'Nouvelle réception', href: '/purchases/new' },
    { icon: '🏭', label: 'Ordre de production', href: '/production/new' },
    { icon: '💳', label: 'Enregistrer un paiement', href: '/invoices' },
  ]

  const statCards = [
    { icon: '👥', value: totalClients, label: 'Clients & Partenaires', href: '/clients', tone: 'green' },
    { icon: '📦', value: products.length, label: 'Produits en stock', href: '/stock', tone: 'amber' },
    { icon: '⚠️', value: lowStock.length, label: 'Alertes stock bas', href: '/stock', tone: 'red' },
    { icon: '📄', value: totalDocuments, label: 'Documents générés', href: '/documents', tone: 'blue' },
    ...(isManager ? [{ icon: '💼', value: openJobs, label: 'Postes ouverts', href: '/recruitment', tone: 'green' }] : []),
    { icon: '📬', value: pendingRequests, label: 'Demandes en attente', href: '/requests', tone: 'amber' },
    { icon: '🧪', value: quarantine.length, label: 'Lots en quarantaine', href: '/quality', tone: 'amber' },
  ]

  const pulseTiles: PulseTile[] = isManager
    ? [
        { icon: '🧾', label: 'Factures validées', value: String(monthValidated), sub: `CA ${fmtAmount(monthCA)} · ${monthName}`, href: '/invoices' },
        { icon: '📝', label: 'Devis en attente', value: String(pendingQuotes), href: '/quotes' },
        { icon: '🚚', label: 'BL en attente', value: String(pendingBL), href: '/delivery-notes?status=pending' },
        { icon: '📬', label: 'Demandes externes', value: String(pendingRequests), href: '/requests' },
        { icon: '🛒', label: 'Réceptions en attente', value: String(pendingPurchases), href: '/purchases' },
      ]
    : [
        { icon: '📝', label: 'Devis en attente', value: String(pendingQuotes), href: '/quotes' },
        { icon: '🚚', label: 'BL en attente', value: String(pendingBL), href: '/delivery-notes?status=pending' },
        { icon: '📬', label: 'Demandes externes', value: String(pendingRequests), href: '/requests' },
        { icon: '🛒', label: 'Réceptions en attente', value: String(pendingPurchases), href: '/purchases' },
      ]

  return (
    <div>
      <div className="page-header">
        <h2>Tableau de bord</h2>
        <div style={{ fontSize: '0.8rem', color: '#666' }}>
          {now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      <div style={{ padding: '32px' }}>
        {/* Bannière d'erreur Supabase : on ne laisse jamais un échec silencieux. */}
        {errors.length > 0 && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 24 }}>
            <span>⚠️</span>
            <div>
              <strong>Certaines données n&apos;ont pas pu être chargées.</strong>{' '}
              <span style={{ fontSize: '0.8rem' }}>{errors.slice(0, 2).join(' · ')}</span>
            </div>
          </div>
        )}

        {/* Stats principales */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          {statCards.map(c => <StatCard key={c.label} {...c} />)}
        </div>

        {/* Actions rapides */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>
          {quickActions.map(a => (
            <Link key={a.label} href={a.href} className="btn-primary" style={{ textDecoration: 'none', padding: '9px 16px', fontSize: '0.82rem' }}>
              <span>{a.icon}</span> {a.label}
            </Link>
          ))}
        </div>

        <PendingValidationsBlock />

        {/* Pulsation opérationnelle : chiffres d'action, tous issus de statuts réels */}
        <PulseRow tiles={pulseTiles} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(440px, 100%), 1fr))', gap: 24, alignItems: 'start' }}>
          {/* Alertes stock bas */}
          <Panel title="⚠️ Alertes Stock Bas" to="/stock">
            {lowStock.length === 0 ? (
              <EmptyState message="✅ Tous les stocks sont au-dessus de leur seuil d'alerte." actionLabel="Gérer le stock" href="/stock" />
            ) : (
              lowStock.map((p: any) => {
                const pct = Number(p.threshold_alert) > 0
                  ? Math.min(100, (Number(p.quantity) / Number(p.threshold_alert)) * 100)
                  : 0
                return (
                  <div key={p.id} className="stock-alert" style={{ margin: '12px', borderRadius: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{p.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#92400e' }}>
                        Stock : <strong>{fmtQty(Number(p.quantity))} {p.unit}</strong> / Seuil : {fmtQty(Number(p.threshold_alert))} {p.unit}
                      </div>
                      <div className="progress-bar" style={{ marginTop: 6 }}>
                        <div className="progress-fill red" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </Panel>

          {/* Qualité & lots */}
          <Panel title="🧪 Qualité & lots" to="/quality" linkLabel="Voir la qualité →">
            {!hasQualityAlerts ? (
              <EmptyState message="✅ Aucun lot en quarantaine ni à risque de péremption sous 30 jours." actionLabel="Voir la qualité" href="/quality" />
            ) : (
              <>
                {(quarantine.length > 0 || expiredCount > 0 || soonCount > 0) && (
                  <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0ece4', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {quarantine.length > 0 && (
                      <Link href="/quality" style={{ textDecoration: 'none' }}>
                        <span className="badge badge-amber" style={{ fontSize: '0.75rem', padding: '6px 12px' }}>⏳ {quarantine.length} en quarantaine</span>
                      </Link>
                    )}
                    {expiredCount > 0 && (
                      <Link href="/stock" style={{ textDecoration: 'none' }}>
                        <span className="badge badge-red" style={{ fontSize: '0.75rem', padding: '6px 12px' }}>🚨 {expiredCount} expiré{expiredCount > 1 ? 's' : ''}</span>
                      </Link>
                    )}
                    {soonCount > 0 && (
                      <Link href="/stock" style={{ textDecoration: 'none' }}>
                        <span className="badge badge-amber" style={{ fontSize: '0.75rem', padding: '6px 12px' }}>🕐 {soonCount} expirent ≤ 30 j</span>
                      </Link>
                    )}
                  </div>
                )}

                {quarantine.length > 0 && (
                  <>
                    <div style={{ padding: '10px 20px', background: '#fafaf7', borderBottom: '1px solid #f0ece4', fontSize: '0.7rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      ⏳ En quarantaine ({quarantine.length})
                    </div>
                    {quarantine.slice(0, 3).map(b => (
                      <RowDivider key={b.id}>
                        <span className={`badge badge-amber`} style={{ flexShrink: 0 }}>Quarantaine</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.product?.name ?? 'Produit inconnu'} <span style={{ color: '#999', fontWeight: 500 }}>· {b.batch_number}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#666', textAlign: 'right' }}>
                          {fmtQty(Number(b.quantity))} {b.product?.unit ?? ''}
                          {b.expiry_date ? <div style={{ color: '#92400e' }}>Exp : {fmtDate(b.expiry_date)}</div> : null}
                        </div>
                      </RowDivider>
                    ))}
                  </>
                )}

                {risky.length > 0 && (
                  <>
                    <div style={{ padding: '10px 20px', background: '#fafaf7', borderBottom: '1px solid #f0ece4', fontSize: '0.7rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      🕐 Expiration ≤ 30 j ({risky.length})
                    </div>
                    {risky.slice(0, 4).map(b => {
                      const days = daysFromToday(String(b.expiry_date))
                      const isExpired = days !== null && days < 0
                      return (
                        <RowDivider key={b.id}>
                          <span className={`badge ${isExpired ? 'badge-red' : 'badge-amber'}`} style={{ flexShrink: 0 }}>
                            {isExpired ? `Expiré` : days === 0 ? 'Aujourd’hui' : `J-${days}`}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {b.product?.name ?? 'Produit inconnu'} <span style={{ color: '#999', fontWeight: 500 }}>· {b.batch_number}</span>
                            </div>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#666', textAlign: 'right' }}>
                            {fmtQty(Number(b.quantity))} {b.product?.unit ?? ''}
                            <div style={{ color: isExpired ? '#991b1b' : '#92400e', fontWeight: 600 }}>{fmtDate(b.expiry_date)}</div>
                          </div>
                        </RowDivider>
                      )
                    })}
                  </>
                )}
              </>
            )}
          </Panel>

          {/* Derniers mouvements */}
          <Panel title="📦 Derniers Mouvements" to="/stock">
            {movements.length === 0 ? (
              <EmptyState message="Aucun mouvement de stock enregistré pour le moment." actionLabel="Gérer le stock" href="/stock" />
            ) : (
              movements.map((m: any) => {
                const cfg = MOV_TYPE[m.type] ?? MOV_TYPE.ADJUST
                const qty = Number(m.quantity)
                const sign = m.type === 'IN' ? '+' : m.type === 'OUT' ? '−' : qty < 0 ? '' : '+'
                const unit = m.product?.unit ? ` ${m.product.unit}` : ''
                return (
                  <div key={m.id} style={{ padding: '12px 20px', borderBottom: '1px solid #f8f6f2', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className={`badge ${cfg.badge}`} style={{ flexShrink: 0 }}>
                      {cfg.arrow} {cfg.label}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.product?.name ?? 'Produit inconnu'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fmtDate(m.date)}
                        {m.reference ? ` · ${m.reference}` : m.reason ? ` · ${m.reason}` : ''}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, color: cfg.color, whiteSpace: 'nowrap', fontSize: '0.875rem' }}>
                      {sign}{fmtQty(Math.abs(qty))}{unit}
                    </div>
                  </div>
                )
              })
            )}
          </Panel>

          {/* Dernières factures — réservé à la direction */}
          {isManager && (
            <Panel title="🧾 Dernières Factures" to="/invoices">
              {recentInvoices.length === 0 ? (
                <EmptyState message="Aucune facture pour le moment." actionLabel="Nouvelle facture" href="/invoices/new" />
              ) : (
                recentInvoices.map((inv: any) => {
                  const st = INV_STATUS[inv.status] ?? { label: inv.status ?? '', badge: 'badge-gray' }
                  return (
                    <Link key={inv.id} href={`/invoices/${inv.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div style={{ padding: '12px 20px', borderBottom: '1px solid #f8f6f2', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.12s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#fafaf7' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--hub-green-mid)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {inv.invoice_number}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {inv.client?.name ?? 'Client inconnu'} · {fmtDate(inv.date)}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#1a1a1a', whiteSpace: 'nowrap' }}>{fmtAmount(Number(inv.total || 0))}</div>
                          <span className={`badge ${st.badge}`} style={{ marginTop: 4 }}>{st.label}</span>
                        </div>
                      </div>
                    </Link>
                  )
                })
              )}
            </Panel>
          )}

          {/* Demandes externes — pleine largeur pour les managers, demi-colonne pour les employés */}
          <Panel title="📬 Demandes Externes" to="/requests" span={isManager} >
            {recentRequests.length === 0 ? (
              <EmptyState message="Aucune demande externe pour le moment." actionLabel="Voir les demandes" href="/requests" />
            ) : (
              recentRequests.map((r: any) => (
                <div key={r.id} style={{ padding: '12px 20px', borderBottom: '1px solid #f8f6f2' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.requester_name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#666' }}>
                        {r.organization} · {r.document_type}
                      </div>
                      {r.description && (
                        <div style={{ fontSize: '0.75rem', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                          {r.description}
                        </div>
                      )}
                    </div>
                    <span className={`badge ${REQ_BADGE[r.status] ?? 'badge-gray'}`} style={{ flexShrink: 0 }}>
                      {REQ_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
