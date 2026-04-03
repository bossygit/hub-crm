'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface PendingGroup {
  label: string
  icon: string
  count: number
  link: string
  color: string
}

export default function PendingValidationsBlock() {
  const [groups, setGroups] = useState<PendingGroup[]>([])
  const [visible, setVisible] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, can_validate_invoices')
        .eq('id', user.id)
        .single()

      if (!profile) return
      const isValidator = profile.can_validate_invoices ||
        ['admin', 'ceo', 'manager'].includes(profile.role)
      if (!isValidator) return

      setVisible(true)

      const [
        { count: invCount },
        { count: blCount },
        { count: quoteCount },
        { count: leaveCount },
      ] = await Promise.all([
        supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('documents').select('*', { count: 'exact', head: true }).eq('type', 'bon_livraison').eq('status', 'pending'),
        supabase.from('documents').select('*', { count: 'exact', head: true }).eq('type', 'devis').eq('status', 'pending'),
        supabase.from('employee_documents').select('*', { count: 'exact', head: true }).eq('type', 'conge').eq('status', 'pending'),
      ])

      setGroups([
        { label: 'Factures', icon: '🧾', count: invCount ?? 0, link: '/invoices?status=pending', color: '#2563eb' },
        { label: 'Bons de livraison', icon: '🚚', count: blCount ?? 0, link: '/delivery-notes?status=pending', color: '#059669' },
        { label: 'Devis', icon: '📝', count: quoteCount ?? 0, link: '/quotes?status=pending', color: '#7c3aed' },
        { label: 'Demandes de conge', icon: '🏖', count: leaveCount ?? 0, link: '/hr/leaves', color: '#ea580c' },
      ])
    }
    load()
  }, [])

  if (!visible) return null

  const total = groups.reduce((s, g) => s + g.count, 0)
  if (total === 0) return null

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a3d2b 0%, #2d6a4f 100%)',
      borderRadius: 14, padding: '20px 24px', marginBottom: 24, color: 'white',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            ⏳ Validations en attente
            <span style={{
              background: '#dc2626', color: 'white', borderRadius: '50%',
              width: 24, height: 24, display: 'inline-flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '0.75rem', fontWeight: 800,
            }}>{total}</span>
          </div>
          <div style={{ fontSize: '0.78rem', opacity: 0.7, marginTop: 2 }}>Documents necessitant votre validation</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {groups.filter(g => g.count > 0).map(g => (
          <Link key={g.label} href={g.link} style={{ textDecoration: 'none' }}>
            <div style={{
              background: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
              transition: 'background 0.15s, transform 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.22)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.12)' }}
            >
              <div style={{ fontSize: '1.5rem' }}>{g.icon}</div>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'white' }}>{g.count}</div>
                <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>{g.label}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
