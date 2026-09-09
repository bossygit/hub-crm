import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import NotificationBell from '@/components/NotificationBell'
import ConnectivityBanner from '@/components/ConnectivityBanner'
import { homeForRole } from '@/lib/auth/access'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'partner') redirect(homeForRole('partner'))

  return (
    <div>
      <ConnectivityBanner />
      <Sidebar />
      <div className="main-content">
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
          padding: '8px 24px 0', gap: 12,
        }}>
          <NotificationBell />
        </div>
        {children}
      </div>
    </div>
  )
}
