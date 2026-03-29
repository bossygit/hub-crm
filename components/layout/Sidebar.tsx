'use client'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const nav = [
  {
    section: 'Principal',
    items: [
      { href: '/dashboard', icon: '📊', label: 'Tableau de bord' },
    ]
  },
  {
    section: 'Gestion',
    items: [
      { href: '/clients', icon: '👥', label: 'Clients & Partenaires' },
      { href: '/stock', icon: '📦', label: 'Gestion de Stock' },
      { href: '/documents', icon: '📄', label: 'Documents' },
    ]
  },
  {
    section: 'RH',
    items: [
      { href: '/recruitment', icon: '👨‍💼', label: 'Recrutement' },
    ]
  },
  {
    section: 'Portail',
    items: [
      { href: '/requests', icon: '📬', label: 'Demandes Externes' },
      { href: '/portal', icon: '🌐', label: 'Portail Public', external: true },
    ]
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>🌿</div>
        <h1>HUB</h1>
        <span>Distribution CRM</span>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {nav.map(group => (
          <div key={group.section}>
            <div className="nav-section">{group.section}</div>
            {group.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                target={item.external ? '_blank' : undefined}
                className={`nav-item ${pathname === item.href || pathname.startsWith(item.href + '/') ? 'active' : ''}`}
                style={{ textDecoration: 'none' }}
              >
                <span style={{ fontSize: '1rem' }}>{item.icon}</span>
                <span>{item.label}</span>
                {item.external && <span style={{ marginLeft: 'auto', fontSize: '0.65rem', opacity: 0.5 }}>↗</span>}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <button
          onClick={handleLogout}
          className="nav-item"
          style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer' }}
        >
          <span>🚪</span>
          <span>Déconnexion</span>
        </button>
      </div>
    </div>
  )
}
