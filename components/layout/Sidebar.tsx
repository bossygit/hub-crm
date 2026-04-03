'use client'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import Image from 'next/image'
import logoWhite from '../../app/assets/images/logo-white.png'

const nav = [
  {
    section: 'Principal',
    items: [
      { href: '/dashboard', icon: '📊', label: 'Tableau de bord' },
      { href: '/reports', icon: '📈', label: 'Rapports' },
    ]
  },
  {
    section: 'Opérations',
    items: [
      { href: '/invoices', icon: '🧾', label: 'Facturation' },
      { href: '/sales', icon: '💰', label: 'Commandes / Ventes' },
      { href: '/stock', icon: '📦', label: 'Gestion de Stock' },
      { href: '/clients', icon: '👥', label: 'Clients & Partenaires' },
    ]
  },
  {
    section: 'Documents',
    items: [
      { href: '/documents', icon: '📄', label: 'Documents' },
      { href: '/requests', icon: '📬', label: 'Demandes Externes' },
    ]
  },
  {
    section: 'Ressources Humaines',
    items: [
      { href: '/employees', icon: '👨‍💼', label: 'Employés & RH' },
      { href: '/recruitment', icon: '🎯', label: 'Recrutement' },
    ]
  },
  {
    section: 'Portail',
    items: [
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
        <Image
          src={logoWhite}
          alt="HUB Distribution"
          width={160}
          style={{ height: 'auto', display: 'block' }}
          priority
        />
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
