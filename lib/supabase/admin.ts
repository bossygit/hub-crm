import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Client Supabase « service role » (contourne la RLS).
 * À n'utiliser que côté serveur, dans des routes protégées ou des tâches
 * planifiées. Renvoie null si la clé n'est pas configurée : les appelants
 * doivent alors se rabattre sur le client de session utilisateur.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
