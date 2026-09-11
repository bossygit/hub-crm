import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Garde commun aux routes d'automatisation (scan d'alertes, relances clients).
 *
 * Deux modes d'accès :
 *   • tâche planifiée : `Authorization: Bearer $CRON_SECRET` (client service
 *     role, indispensable car aucune session utilisateur n'existe) ;
 *   • utilisateur connecté de rôle ceo / manager / admin.
 *
 * Le client renvoyé est le service role s'il est configuré (accès complet,
 * notamment pour lire toutes les notifications et écrire pour autrui),
 * sinon le client de session (RLS appliquée).
 */

export const MANAGER_ROLES = ['ceo', 'manager', 'admin']

export type ManagerAuth =
  | { client: SupabaseClient; viaCron: boolean; userId: string | null }
  | { error: NextResponse }

export async function authorizeManager(req: NextRequest): Promise<ManagerAuth> {
  const secret = process.env.CRON_SECRET
  const header = req.headers.get('authorization') || ''

  if (secret && header === `Bearer ${secret}`) {
    const admin = createAdminClient()
    if (!admin) {
      return { error: NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY manquante pour la tâche planifiée.' }, { status: 503 }) }
    }
    return { client: admin, viaCron: true, userId: null }
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Accès réservé aux rôles direction/RH.' }, { status: 403 }) }
  }

  return { client: createAdminClient() || supabase, viaCron: false, userId: user.id }
}
