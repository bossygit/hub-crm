'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types'

interface UserProfile {
  id: string
  role: UserRole
  full_name?: string
  can_validate_invoices?: boolean
}

export function useUserRole() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) { setLoading(false); return }

      const { data } = await supabase
        .from('profiles')
        .select('id, role, full_name, can_validate_invoices')
        .eq('id', user.id)
        .single()

      if (!cancelled) {
        setProfile(data as UserProfile | null)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const hasRole = (...roles: UserRole[]) =>
    profile ? roles.includes(profile.role) : false

  const isManager = () => hasRole('ceo', 'manager', 'admin')

  return { profile, loading, hasRole, isManager }
}
