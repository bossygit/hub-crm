'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, LogOut, UserRound, ChevronDown, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import NotificationBell from '@/components/NotificationBell'

/**
 * Barre supérieure : ouverture de la navigation sur mobile (la sidebar est
 * masquée en dessous de 768 px), notifications et menu utilisateur avec la
 * déconnexion — visible en permanence, quel que soit l'écran.
 */

const ROLE_LABEL: Record<string, string> = {
  ceo: 'Direction',
  admin: 'Administrateur',
  manager: 'Manager',
  employee: 'Employé',
  partner: 'Partenaire',
  client: 'Partenaire',
}

export default function HeaderBar({
  fullName,
  role,
  email,
}: {
  fullName?: string | null
  role?: string | null
  email?: string | null
}) {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  // Ouvre/ferme la sidebar mobile via une classe sur <body> (le composant
  // Sidebar reste un composant serveur autonome).
  useEffect(() => {
    document.body.classList.toggle('sidebar-open', navOpen)
    return () => { document.body.classList.remove('sidebar-open') }
  }, [navOpen])

  // Referme la navigation après un changement de page.
  useEffect(() => { setNavOpen(false); setUserMenuOpen(false) }, [pathname])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleLogout() {
    setSigningOut(true)
    await supabase.auth.signOut()
    router.push('/login')
  }

  const displayName = fullName?.trim() || email || 'Mon compte'
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('')

  return (
    <>
      {navOpen && (
        <button
          type="button"
          aria-label="Fermer la navigation"
          className="sidebar-backdrop"
          onClick={() => setNavOpen(false)}
        />
      )}

      <div className="header-bar">
        <button
          type="button"
          className="nav-toggle"
          aria-label={navOpen ? 'Fermer la navigation' : 'Ouvrir la navigation'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen(v => !v)}
        >
          {navOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <div style={{ flex: 1 }} />

        <NotificationBell />

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="user-menu-trigger"
            onClick={() => setUserMenuOpen(v => !v)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            title="Mon compte"
          >
            <span className="user-menu-avatar">{initials || <UserRound size={14} />}</span>
            <span className="user-menu-name">{displayName}</span>
            <ChevronDown size={14} strokeWidth={2} style={{ opacity: 0.6 }} />
          </button>

          {userMenuOpen && (
            <div className="user-menu-panel" role="menu">
              <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0ece4' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1a3d2b' }}>{displayName}</div>
                {email && <div style={{ fontSize: '0.74rem', color: '#888', wordBreak: 'break-all' }}>{email}</div>}
                <div style={{ marginTop: 6 }}>
                  <span className="badge badge-gray" style={{ fontSize: '0.68rem' }}>
                    {ROLE_LABEL[role || ''] || role || 'Utilisateur'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                role="menuitem"
                className="user-menu-item"
                onClick={handleLogout}
                disabled={signingOut}
              >
                <LogOut size={15} strokeWidth={1.8} />
                <span>{signingOut ? 'Déconnexion…' : 'Se déconnecter'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
