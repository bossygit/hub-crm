'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface NotificationRow {
  id: string
  type?: string | null
  title?: string | null
  message?: string | null
  reference_id?: string | null
  link?: string | null
  is_read?: boolean
  created_at: string
}

// Meta par type de notification (FR). Tout type inconnu ou hérité retombe
// sur un icône + libellé génériques : le rendu ne plante jamais.
const TYPE_META: Record<string, { icon: string; label: string }> = {
  invoice_pending: { icon: '🧾', label: 'Facture en attente de validation' },
  bl_pending: { icon: '🚚', label: 'Bon de livraison en attente de validation' },
  leave_pending: { icon: '🏖', label: 'Demande de congé en attente de validation' },
  quote_pending: { icon: '📝', label: 'Devis en attente de validation' },
  quote_approved: { icon: '✅', label: 'Devis accepté' },
  quote_rejected: { icon: '❌', label: 'Devis refusé' },
  quote_converted: { icon: '🔄', label: 'Devis converti en facture' },
}

const FALLBACK_META = { icon: '📋', label: 'Notification' }

function metaFor(type?: string | null) {
  return (type && TYPE_META[type]) || FALLBACK_META
}

// Cible de navigation : on privilégie le lien stocké sur la notification ;
// à défaut on le reconstruit depuis le type + reference_id (robustesse).
function resolveLink(n: NotificationRow): string | undefined {
  if (n.link) return n.link
  if (!n.reference_id) return undefined
  switch (n.type) {
    case 'quote_pending':
    case 'quote_approved':
    case 'quote_rejected':
    case 'quote_converted':
      return `/quotes/${n.reference_id}`
    case 'invoice_pending':
      return `/invoices/${n.reference_id}`
    case 'bl_pending':
      return `/delivery-notes/${n.reference_id}`
    case 'leave_pending':
      return '/hr/leaves'
    default:
      return undefined
  }
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'maintenant'
  if (mins < 60) return `il y a ${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `il y a ${hours}h`
  const days = Math.floor(hours / 24)
  return `il y a ${days}j`
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  // Instance stable (créée une seule fois) pour garder `load` référentiellement stable
  // et éviter de recréer le polling à chaque rendu.
  const [supabase] = useState(() => createClient())

  const load = useCallback(async () => {
    // Compteur non-lus réel (RLS : uniquement les notifications du user connecté),
    // indépendant de la limite de 15 affichées dans le panneau.
    const [{ data, error }, countRes] = await Promise.all([
      supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('is_read', false),
    ])
    if (error) {
      // Ligne muette : la prochaine itération du polling retentera.
      return
    }
    const list = (data as NotificationRow[]) || []
    setNotifications(list)
    if (countRes.error) {
      // Repli : compter sur les 15 dernières si la requête de comptage échoue.
      setUnreadCount(list.filter(n => !n.is_read).length)
    } else if (typeof countRes.count === 'number') {
      setUnreadCount(countRes.count)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Un seul polling actif : nettoyage à chaque démontage / re-montage
  // (pas de listener dupliqué ni de setInterval orphelin).
  useEffect(() => {
    const interval = setInterval(() => { load() }, 30000)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function toggleOpen() {
    setOpen(prev => {
      const next = !prev
      if (next) load() // données fraîches à l'ouverture
      return next
    })
  }

  async function markAsRead(id: string, link?: string) {
    setOpen(false)
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('is_read', false)
    if (!error) {
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    }
    // Navigation même si le marquage a échoué : le lien reste l'action principale.
    if (link) router.push(link)
  }

  async function markAllRead() {
    if (unreadCount === 0 || markingAll) return
    setMarkingAll(true)
    // RLS restreint la mise à jour aux notifications du user connecté.
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('is_read', false)
    if (!error) {
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      setUnreadCount(0)
    }
    setMarkingAll(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={toggleOpen}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
        title="Notifications"
        style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem',
          position: 'relative', padding: '6px 8px', borderRadius: 8,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.05)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: '#dc2626', color: 'white', borderRadius: '50%',
            width: 18, height: 18, fontSize: '0.65rem', fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid white',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 8,
          width: 380, maxHeight: 460, overflowY: 'auto',
          background: 'white', borderRadius: 12, border: '1px solid #e8e4db',
          boxShadow: '0 12px 40px rgba(0,0,0,0.15)', zIndex: 1000,
        }}>
          <div style={{
            padding: '14px 18px', borderBottom: '1px solid #f0ece4',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            position: 'sticky', top: 0, background: 'white',
          }}>
            <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.9rem' }}>
              Notifications {unreadCount > 0 && <span style={{ color: '#dc2626', fontSize: '0.8rem' }}>({unreadCount})</span>}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={markingAll}
                style={{
                  background: 'none', border: 'none', cursor: markingAll ? 'wait' : 'pointer',
                  color: 'var(--hub-green-mid)', fontSize: '0.75rem', fontWeight: 600,
                  padding: 0,
                }}
              >
                {markingAll ? 'Marquage…' : 'Tout marquer comme lu'}
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
              <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>🔕</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Aucune notification</div>
              <div style={{ fontSize: '0.78rem', marginTop: 4 }}>Les validations en attente et les alertes apparaîtront ici.</div>
            </div>
          ) : (
            notifications.map(n => {
              const meta = metaFor(n.type)
              const link = resolveLink(n)
              const title = n.title || meta.label
              return (
                <div
                  key={n.id}
                  onClick={() => markAsRead(n.id, link)}
                  title={link ? 'Ouvrir la notification' : 'Marquer comme lue'}
                  style={{
                    padding: '12px 18px', borderBottom: '1px solid #f8f6f2',
                    cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start',
                    background: n.is_read ? 'white' : '#f0f9f5',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = n.is_read ? '#fafaf7' : '#e6f3ec' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = n.is_read ? 'white' : '#f0f9f5' }}
                >
                  <div style={{ fontSize: '1.3rem', lineHeight: 1 }}>{meta.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: n.is_read ? 500 : 700, fontSize: '0.85rem', color: '#1a1a1a', marginBottom: 2 }}>{title}</div>
                    {n.message && <div style={{ fontSize: '0.78rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</div>}
                    <div style={{ fontSize: '0.7rem', color: '#999', marginTop: 3 }}>{timeAgo(n.created_at)}</div>
                  </div>
                  {!n.is_read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2d6a4f', marginTop: 6, flexShrink: 0 }} />}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
