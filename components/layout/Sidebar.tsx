'use client'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUserRole } from '@/lib/hooks/useUserRole'
import Link from 'next/link'
import Image from 'next/image'
import logoWhite from '../../app/assets/images/logo-white.png'
import type { UserRole } from '@/types'

interface NavItem {
  href: string
  icon: string
  label: string
  external?: boolean
  roles?: UserRole[]
}

const nav: { section: string; items: NavItem[]; roles?: UserRole[] }[] = [
  {
    section: 'Principal',
    items: [
      { href: '/dashboard', icon: '📊', label: 'Tableau de bord' },
      { href: '/reports', icon: '📈', label: 'Rapports', roles: ['ceo', 'manager', 'admin'] },
    ]
  },
  {
    section: 'Opérations',
    items: [
      { href: '/quotes', icon: '📝', label: 'Devis' },
      { href: '/invoices', icon: '🧾', label: 'Facturation' },
      { href: '/delivery-notes', icon: '🚚', label: 'Bons de Livraison' },
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
    roles: ['ceo', 'manager', 'admin'],
    items: [
      { href: '/employees', icon: '👨‍💼', label: 'Employés & RH' },
      { href: '/hr/contracts', icon: '📝', label: 'Contrats' },
      { href: '/hr/certificates', icon: '🏛', label: 'Attestations' },
      { href: '/hr/payslips', icon: '💵', label: 'Fiches de paie' },
      { href: '/hr/leaves', icon: '🏖', label: 'Congés' },
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
  const { profile } = useUserRole()
  const userRole = profile?.role

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function isVisible(item: { roles?: UserRole[] }) {
    if (!item.roles) return true
    if (!userRole) return false
    return item.roles.includes(userRole)
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
        {nav.filter(group => isVisible(group)).map(group => (
          <div key={group.section}>
            <div className="nav-section">{group.section}</div>
            {group.items.filter(item => isVisible(item)).map(item => (
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
