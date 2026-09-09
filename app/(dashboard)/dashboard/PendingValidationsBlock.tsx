'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface PendingGroup {
  key: string
  label: string
  icon: string
  count: number
  link: string
}

const MANAGER_ROLES = ['admin', 'ceo', 'manager']

export default function PendingValidationsBlock() {
  const [groups, setGroups] = useState<PendingGroup[]>([])
  const [visible, setVisible] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, can_validate_invoices')
        .eq('id', user.id)
        .single()
      if (cancelled) return

      const isManager = !!profile && MANAGER_ROLES.includes(profile.role as string)
      const isValidator = !!profile && (isManager || profile.can_validate_invoices === true)
      if (!isValidator) return

      setVisible(true)
      setChecking(true)

      // Non-manager validators (comptable) ne voient que les factures.
      const queries = [
        supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      ]
      if (isManager) {
        queries.push(
          supabase.from('documents').select('*', { count: 'exact', head: true }).eq('type', 'bon_livraison').eq('status', 'pending'),
          supabase.from('documents').select('*', { count: 'exact', head: true }).eq('type', 'devis').eq('status', 'pending'),
          supabase.from('employee_documents').select('*', { count: 'exact', head: true }).eq('type', 'conge').eq('status', 'pending'),
          supabase.from('product_batches').select('*', { count: 'exact', head: true }).eq('quality_status', 'pending'),
        )
      }

      const results = await Promise.all(queries)
      if (cancelled) return

      const failed = results.find(r => r.error)
      if (failed) setError(failed.error?.message || 'Erreur inconnue')

      const toGroup = (label: string, icon: string, count: number | null, link: string): PendingGroup => ({
        key: `${label}-${link}`,
        label,
        icon,
        count: count ?? 0,
        link,
      })

      if (isManager) {
        setGroups([
          toGroup('Factures', '🧾', results[0].count, '/invoices'),
          toGroup('Bons de livraison', '🚚', results[1].count, '/delivery-notes?status=pending'),
          toGroup('Devis', '📝', results[2].count, '/quotes'),
          toGroup('Demandes de congé', '🏖', results[3].count, '/hr/leaves'),
          toGroup('Lots qualité', '🧪', results[4].count, '/quality'),
        ])
      } else {
        setGroups([
          toGroup('Factures', '🧾', results[0].count, '/invoices'),
        ])
      }
      setChecking(false)
    }

    load()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null

  // État de chargement : léger squeletton dans le bandeau, pas de saut de mise en page.
  if (checking) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #1a3d2b 0%, #2d6a4f 100%)',
        borderRadius: 14, padding: '20px 24px', marginBottom: 24, color: 'white',
      }}>
        <div style={{ fontWeight: 800, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          ⏳ Validations en attente
        </div>
        <div style={{ fontSize: '0.85rem', opacity: 0.75, marginTop: 10 }}>
          Chargement des validations…
        </div>
      </div>
    )
  }

  // Erreur de chargement : on affiche un message clair plutôt qu'un silence trompeur.
  if (error) {
    return (
      <div style={{
        background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b',
        borderRadius: 12, padding: '14px 20px', marginBottom: 24,
        display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.875rem',
      }}>
        <span style={{ fontSize: '1.1rem' }}>⚠️</span>
        <div>
          <strong>Impossible de charger les validations en attente.</strong>
          <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>Rechargez la page pour réessayer.</div>
        </div>
      </div>
    )
  }

  const total = groups.reduce((s, g) => s + g.count, 0)

  // Tout est traité : message de confirmation positif.
  if (total === 0) {
    return (
      <div style={{
        background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46',
        borderRadius: 12, padding: '14px 20px', marginBottom: 24,
        display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.875rem',
      }}>
        <span style={{ fontSize: '1.1rem' }}>✅</span>
        <div>
          <strong>Aucune validation en attente.</strong>{' '}
          <span style={{ opacity: 0.85 }}>Tous les documents sont à jour.</span>
        </div>
      </div>
    )
  }

  const pending = groups.filter(g => g.count > 0)

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
          <div style={{ fontSize: '0.78rem', opacity: 0.7, marginTop: 2 }}>Documents nécessitant votre validation</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {pending.map(g => (
          <Link key={g.key} href={g.link} style={{ textDecoration: 'none' }}>
            <div style={{
              background: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
              transition: 'background 0.15s',
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
