'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const typeIcons: Record<string, string> = {
  invoice_pending: '🧾',
  bl_pending: '🚚',
  leave_pending: '🏖',
  quote_pending: '📝',
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<any[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const supabase = createClient()

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(15)
    const list = data || []
    setNotifications(list)
    setUnreadCount(list.filter(n => !n.is_read).length)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function markAsRead(id: string, link?: string) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
    setOpen(false)
    if (link) router.push(link)
  }

  async function markAllRead() {
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id)
    if (unreadIds.length === 0) return
    await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
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

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
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
          }}>
            <div style={{ fontWeight: 700, color: 'var(--hub-green)', fontSize: '0.9rem' }}>
              Notifications {unreadCount > 0 && <span style={{ color: '#dc2626', fontSize: '0.8rem' }}>({unreadCount})</span>}
            </div>
            {unreadCount > 0 && (
              <button onClick={markAllRead} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--hub-green-mid)', fontSize: '0.75rem', fontWeight: 600,
              }}>Tout marquer lu</button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#999', fontSize: '0.875rem' }}>
              Aucune notification
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                onClick={() => markAsRead(n.id, n.link)}
                style={{
                  padding: '12px 18px', borderBottom: '1px solid #f8f6f2',
                  cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start',
                  background: n.is_read ? 'white' : '#f0f9f5',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (n.is_read) (e.currentTarget as HTMLDivElement).style.background = '#fafaf7' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = n.is_read ? 'white' : '#f0f9f5' }}
              >
                <div style={{ fontSize: '1.3rem', lineHeight: 1 }}>{typeIcons[n.type] || '📋'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: n.is_read ? 500 : 700, fontSize: '0.85rem', color: '#1a1a1a', marginBottom: 2 }}>{n.title}</div>
                  {n.message && <div style={{ fontSize: '0.78rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</div>}
                  <div style={{ fontSize: '0.7rem', color: '#999', marginTop: 3 }}>{timeAgo(n.created_at)}</div>
                </div>
                {!n.is_read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2d6a4f', marginTop: 6, flexShrink: 0 }} />}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
