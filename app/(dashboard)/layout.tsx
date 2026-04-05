import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import NotificationBell from '@/components/NotificationBell'
import ConnectivityBanner from '@/components/ConnectivityBanner'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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
