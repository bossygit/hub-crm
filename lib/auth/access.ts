export const INTERNAL_HOME = '/dashboard'
export const PARTNER_HOME = '/portal'
export const LOGIN_PATH = '/login'
export const REGISTER_PATH = '/register'

const RESTRICTED_ROUTES: { prefix: string; roles: string[] }[] = [
  { prefix: '/employees', roles: ['ceo', 'manager', 'admin'] },
  { prefix: '/hr', roles: ['ceo', 'manager', 'admin'] },
  { prefix: '/reports', roles: ['ceo', 'manager', 'admin'] },
  { prefix: '/recruitment', roles: ['ceo', 'manager', 'admin'] },
  { prefix: '/admin', roles: ['ceo', 'admin'] },
]

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

export function homeForRole(role?: string | null): string {
  return role === 'partner' ? PARTNER_HOME : INTERNAL_HOME
}

export function isPublicPath(pathname: string): boolean {
  return matchesPrefix(pathname, LOGIN_PATH) || matchesPrefix(pathname, PARTNER_HOME)
}

export function isRegisterPath(pathname: string): boolean {
  return matchesPrefix(pathname, REGISTER_PATH)
}

export function isRegisterOpen(existingProfileCount: number): boolean {
  return existingProfileCount === 0
}

export function canAccessPath(role: string | null | undefined, pathname: string): boolean {
  if (!role) return false
  if (role === 'partner') return matchesPrefix(pathname, PARTNER_HOME)

  const restriction = RESTRICTED_ROUTES.find(r => matchesPrefix(pathname, r.prefix))
  if (!restriction) return true
  return restriction.roles.includes(role)
}
