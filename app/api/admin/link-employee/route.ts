import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createSupabaseAdmin, type SupabaseClient, type User } from '@supabase/supabase-js'

// Liaison fiche employé <-> compte auth (utilisateurs Supabase).
// Réservé aux rôles RH (ceo, manager, admin) — contrôlé ici même,
// indépendamment de la restriction de route '/admin' des pages web.
//
// GET  ?employee_id=…        → infos de liaison (compte lié + e-mail auth)
// POST {employee_id, email}  → lie un compte existant OU invite un nouvel
//                              utilisateur salarié (rôle employee)
// POST {employee_id, unlink} → dissocie le compte de la fiche
//
// Dépend de la variable d'env SUPABASE_SERVICE_ROLE_KEY (auth.admin).

const MANAGER_ROLES = ['ceo', 'manager', 'admin']

function appBaseUrl(): string {
  return (
    (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  )
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createSupabaseAdmin(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// L'API admin n'expose pas getUserByEmail sur cette version : on liste et on compare.
async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | undefined> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  return data?.users?.find(u => (u.email || '').toLowerCase() === email)?.id
}

type ManagerGuard =
  | { supabase: SupabaseClient; user: User }
  | { error: NextResponse }

async function requireManager(): Promise<ManagerGuard> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ ok: false, error: 'Non authentifié.' }, { status: 401 }) }
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    return { error: NextResponse.json({ ok: false, error: 'Accès réservé à la RH.' }, { status: 403 }) }
  }
  return { supabase, user }
}

export async function GET(req: NextRequest) {
  const guard = await requireManager()
  if ('error' in guard) return guard.error
  const supabase = guard.supabase

  const employee_id = req.nextUrl.searchParams.get('employee_id')
  if (!employee_id) {
    return NextResponse.json({ ok: false, error: 'Paramètre employee_id manquant.' }, { status: 400 })
  }

  const { data: emp } = await supabase
    .from('employees')
    .select('id, user_id, full_name')
    .eq('id', employee_id)
    .maybeSingle()
  if (!emp) {
    return NextResponse.json({ ok: false, error: 'Fiche employé introuvable.' }, { status: 404 })
  }

  const admin = makeAdminClient()
  let linkedUser: { id: string; email: string | null } | null = null
  if (emp.user_id && admin) {
    const { data } = await admin.auth.admin.getUserById(emp.user_id)
    if (data?.user) linkedUser = { id: data.user.id, email: data.user.email ?? null }
  }

  return NextResponse.json({
    ok: true,
    employee: { id: emp.id, user_id: emp.user_id, full_name: emp.full_name },
    linkedUser,
    serviceRoleConfigured: !!admin,
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireManager()
  if ('error' in guard) return guard.error
  const supabase = guard.supabase

  let body: { employee_id?: string; email?: string; unlink?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps JSON invalide.' }, { status: 400 })
  }

  const employee_id = (body.employee_id || '').trim()
  const unlink = !!body.unlink
  if (!employee_id) {
    return NextResponse.json({ ok: false, error: 'Paramètre employee_id manquant.' }, { status: 400 })
  }

  // La fiche doit exister (et l'appelant la voir via RLS manager).
  const { data: emp } = await supabase
    .from('employees')
    .select('id, user_id')
    .eq('id', employee_id)
    .maybeSingle()
  if (!emp) {
    return NextResponse.json({ ok: false, error: 'Fiche employé introuvable.' }, { status: 404 })
  }

  // Dissociation simple (aucun droit admin requis).
  if (unlink) {
    const { error: updErr } = await supabase
      .from('employees')
      .update({ user_id: null })
      .eq('id', employee_id)
    if (updErr) {
      return NextResponse.json({ ok: false, error: `Erreur : ${updErr.message}` }, { status: 500 })
    }
    return NextResponse.json({ ok: true, unlinked: true, employee_id })
  }

  const email = (body.email || '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'Adresse e-mail invalide.' }, { status: 400 })
  }

  const admin = makeAdminClient()
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY non configurée — liaison de compte indisponible côté serveur.' },
      { status: 503 }
    )
  }

  // 1) Compte existant ?
  let userId: string | undefined
  let created = false
  userId = await findUserIdByEmail(admin, email)
  if (!userId) {
    // 2) Sinon : invitation (crée le compte auth en attente de mot de passe ;
    //    le trigger handle_new_user crée le profil rôle 'employee').
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { role: 'employee' },
      redirectTo: `${appBaseUrl()}/login`,
    })
    if (inviteErr) {
      // Course possible (compte créé entre-temps) : on re-tente la recherche.
      userId = await findUserIdByEmail(admin, email)
      if (!userId) {
        return NextResponse.json(
          { ok: false, error: `Impossible de créer le compte : ${inviteErr.message}` },
          { status: 500 }
        )
      }
    } else {
      userId = invited?.user?.id
      created = true
    }
  }

  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Compte introuvable ou création impossible.' }, { status: 500 })
  }

  // Déjà lié à une autre fiche ? (l'index unique employees_user_id_key protège aussi en base)
  const { data: existing } = await supabase.from('employees').select('id').eq('user_id', userId)
  if ((existing || []).some((r: { id: string }) => r.id !== employee_id)) {
    return NextResponse.json(
      { ok: false, error: 'Ce compte est déjà lié à une autre fiche employé.' },
      { status: 409 }
    )
  }

  const { error: updErr } = await supabase
    .from('employees')
    .update({ user_id: userId })
    .eq('id', employee_id)
  if (updErr) {
    return NextResponse.json({ ok: false, error: `Erreur : ${updErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    employee_id,
    userId,
    email,
    created,
    message: created
      ? `Invitation envoyée à ${email} — le compte sera actif une fois le mot de passe défini.`
      : `Compte ${email} lié à la fiche employé.`,
  })
}
