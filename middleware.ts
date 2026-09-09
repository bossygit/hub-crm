import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  canAccessPath,
  homeForRole,
  isPublicPath,
  isRegisterOpen,
  isRegisterPath,
} from '@/lib/auth/access'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as any)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  async function roleOf(userId: string) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single()
    return profile?.role as string | undefined
  }

  function redirectTo(path: string) {
    const url = request.nextUrl.clone()
    url.pathname = path
    return NextResponse.redirect(url)
  }

  if (isRegisterPath(pathname)) {
    if (user) return redirectTo(homeForRole(await roleOf(user.id)))
    const { data: exists, error } = await supabase.rpc('profiles_exist')
    if (error || !isRegisterOpen(exists ? 1 : 0)) return redirectTo('/login')
    return supabaseResponse
  }

  if (user && (pathname === '/login' || pathname.startsWith('/login/'))) {
    return redirectTo(homeForRole(await roleOf(user.id)))
  }

  if (!user && !isPublicPath(pathname) && pathname !== '/') {
    return redirectTo('/login')
  }

  if (user) {
    const role = await roleOf(user.id)
    if (!canAccessPath(role, pathname) && pathname !== '/') {
      return redirectTo(homeForRole(role))
    }
    if (pathname === '/' && role === 'partner') {
      return redirectTo(homeForRole(role))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|app-icon\\.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
