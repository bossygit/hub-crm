import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import HeaderBar from '@/components/layout/HeaderBar'
import ConnectivityBanner from '@/components/ConnectivityBanner'
import { homeForRole } from '@/lib/auth/access'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'partner') redirect(homeForRole('partner'))

  return (
    <div>
      <ConnectivityBanner />
      <Sidebar />
      <div className="main-content">
        <HeaderBar fullName={profile?.full_name} role={profile?.role} email={user.email} />
        {children}
      </div>
    </div>
  )
}
