'use client'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUserRole } from '@/lib/hooks/useUserRole'
import Link from 'next/link'
import Image from 'next/image'
import {
  Archive, BarChart3, Beaker, BellRing, BriefcaseBusiness, Building2, ClipboardCheck,
  FileText, FolderKanban, Handshake, KeyRound, LayoutDashboard, Package,
  ReceiptText, ScrollText, Send, Settings2, ShoppingCart, Sparkles, UsersRound, Warehouse,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import logoWhite from '../../app/assets/images/logo-white.png'
import type { UserRole } from '@/types'

interface NavItem {
  href: string
  icon: LucideIcon
  label: string
  external?: boolean
  roles?: UserRole[]
}

const nav: { section: string; items: NavItem[]; roles?: UserRole[] }[] = [
  {
    section: 'Principal',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
      { href: '/assistant', icon: Sparkles, label: 'Assistant IA', roles: ['ceo', 'admin'] },
      { href: '/me/conges', icon: BriefcaseBusiness, label: 'Mes congés' },
      { href: '/reports', icon: BarChart3, label: 'Rapports', roles: ['ceo', 'manager', 'admin'] },
    ]
  },
  {
    section: 'Opérations',
    items: [
      { href: '/quotes', icon: ScrollText, label: 'Devis' },
      { href: '/invoices', icon: ReceiptText, label: 'Facturation' },
      { href: '/delivery-notes', icon: Send, label: 'Bons de livraison' },
      { href: '/purchases', icon: ShoppingCart, label: 'Achats & réception' },
      { href: '/production', icon: FolderKanban, label: 'Production' },
      { href: '/stock', icon: Package, label: 'Gestion de stock' },
      { href: '/stock/warehouses', icon: Warehouse, label: 'Entrepôts' },
      { href: '/stock/inventory', icon: ClipboardCheck, label: 'Inventaire' },
      { href: '/stock/recall', icon: BellRing, label: 'Traçabilité lots' },
      { href: '/quality', icon: Beaker, label: 'Qualité' },
      { href: '/portal-orders', icon: ShoppingCart, label: 'Commandes portail', roles: ['ceo', 'manager', 'admin'] },
      { href: '/clients', icon: Handshake, label: 'Clients & partenaires' },
    ]
  },
  {
    section: 'Documents',
    items: [
      { href: '/documents', icon: FileText, label: 'Documents' },
      { href: '/requests', icon: Archive, label: 'Demandes externes' },
    ]
  },
  {
    section: 'Ressources Humaines',
    roles: ['ceo', 'manager', 'admin'],
    items: [
      { href: '/employees', icon: UsersRound, label: 'Employés & RH' },
      { href: '/hr/contracts', icon: ScrollText, label: 'Contrats' },
      { href: '/hr/certificates', icon: FileText, label: 'Attestations' },
      { href: '/hr/payslips', icon: ReceiptText, label: 'Fiches de paie' },
      { href: '/hr/leaves', icon: BriefcaseBusiness, label: 'Congés' },
      { href: '/hr/attendance', icon: ClipboardCheck, label: 'Présences & pointage' },
      { href: '/recruitment', icon: UsersRound, label: 'Recrutement' },
    ]
  },
  {
    section: 'Administration',
    roles: ['ceo', 'admin'],
    items: [
      { href: '/admin/users', icon: KeyRound, label: 'Gestion des rôles', roles: ['ceo', 'admin'] },
    ]
  },
  {
    section: 'Portail',
    items: [
      { href: '/portal', icon: Building2, label: 'Portail public', external: true },
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
            {group.items.filter(item => isVisible(item)).map(item => {
              const Icon = item.icon
              const hrefs = group.items.map(i => i.href)
              const exact = pathname === item.href
              const nested = pathname.startsWith(item.href + '/')
              const longerMatch = hrefs.some(other =>
                other !== item.href && other.length > item.href.length &&
                (pathname === other || pathname.startsWith(other + '/'))
              )
              const active = exact || (nested && !longerMatch)
              return (
              <Link
                key={item.href}
                href={item.href}
                target={item.external ? '_blank' : undefined}
                className={`nav-item ${active ? 'active' : ''}`}
                style={{ textDecoration: 'none' }}
              >
                <span style={{ display: 'grid', placeItems: 'center', width: 18 }}><Icon size={16} strokeWidth={1.8} /></span>
                <span>{item.label}</span>
                {item.external && <span style={{ marginLeft: 'auto', fontSize: '0.65rem', opacity: 0.5 }}>↗</span>}
              </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <button
          onClick={handleLogout}
          className="nav-item"
          style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer' }}
        >
          <span style={{ display: 'grid', placeItems: 'center', width: 18 }}><Settings2 size={16} strokeWidth={1.8} /></span>
          <span>Déconnexion</span>
        </button>
      </div>
    </div>
  )
}
