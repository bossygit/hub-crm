'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUserRole } from '@/lib/hooks/useUserRole'
import { useToast } from '@/components/ui/Toast'
import type { UserRole } from '@/types'

interface ProfileRow {
  id: string
  full_name: string | null
  role: UserRole
  department: string | null
  phone: string | null
  status: string | null
  can_validate_invoices: boolean
  created_at: string
}

const ROLES: { value: UserRole; label: string; color: string }[] = [
  { value: 'ceo', label: 'CEO', color: '#7c3aed' },
  { value: 'manager', label: 'Manager', color: '#0369a1' },
  { value: 'admin', label: 'Admin', color: '#065f46' },
  { value: 'employee', label: 'Employé', color: '#6b7280' },
  { value: 'partner', label: 'Partenaire', color: '#92400e' },
]

function roleBadge(role: UserRole) {
  const r = ROLES.find(x => x.value === role)
  return { label: r?.label ?? role, color: r?.color ?? '#555' }
}

export default function AdminUsersPage() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const { profile: me } = useUserRole()
  const { toast } = useToast()
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, department, phone, status, can_validate_invoices, created_at')
      .order('created_at', { ascending: true })
    if (error) {
      toast('error', 'Impossible de charger les utilisateurs.')
    }
    setProfiles((data as ProfileRow[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function changeRole(userId: string, newRole: UserRole) {
    if (userId === me?.id) {
      toast('warning', 'Vous ne pouvez pas modifier votre propre rôle.')
      return
    }

    setSaving(userId)
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId)

    if (error) {
      toast('error', `Erreur : ${error.message}`)
    } else {
      toast('success', 'Rôle mis à jour avec succès.')
      setProfiles(prev =>
        prev.map(p => p.id === userId ? { ...p, role: newRole } : p)
      )
    }
    setSaving(null)
  }

  async function toggleValidation(userId: string, current: boolean) {
    setSaving(userId)
    const { error } = await supabase
      .from('profiles')
      .update({ can_validate_invoices: !current })
      .eq('id', userId)

    if (error) {
      toast('error', `Erreur : ${error.message}`)
    } else {
      toast('success', `Permission de validation ${!current ? 'accordée' : 'retirée'}.`)
      setProfiles(prev =>
        prev.map(p => p.id === userId ? { ...p, can_validate_invoices: !current } : p)
      )
    }
    setSaving(null)
  }

  const filtered = profiles.filter(p => {
    const s = search.toLowerCase()
    return !s
      || (p.full_name || '').toLowerCase().includes(s)
      || p.role.toLowerCase().includes(s)
      || (p.department || '').toLowerCase().includes(s)
  })

  const stats = {
    total: profiles.length,
    ceo: profiles.filter(p => p.role === 'ceo').length,
    manager: profiles.filter(p => p.role === 'manager').length,
    admin: profiles.filter(p => p.role === 'admin').length,
    employee: profiles.filter(p => p.role === 'employee').length,
    partner: profiles.filter(p => p.role === 'partner').length,
  }

  return (
    <div>
      <div className="page-header">
        <h2>Administration des utilisateurs</h2>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div className="stat-card green">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total</div>
          </div>
          {ROLES.map(r => (
            <div key={r.value} className="stat-card" style={{ borderLeftColor: r.color }}>
              <div className="stat-value">{stats[r.value as keyof typeof stats] || 0}</div>
              <div className="stat-label">{r.label}</div>
            </div>
          ))}
        </div>

        <input
          className="hub-input"
          style={{ maxWidth: 320, marginBottom: 16 }}
          placeholder="Rechercher par nom, rôle, département..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement...</div>
          ) : (
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Rôle actuel</th>
                  <th>Département</th>
                  <th>Validation factures</th>
                  <th>Inscrit le</th>
                  <th>Changer le rôle</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const badge = roleBadge(p.role)
                  const isMe = p.id === me?.id
                  return (
                    <tr key={p.id} style={{ opacity: saving === p.id ? 0.5 : 1 }}>
                      <td>
                        <div style={{ fontWeight: 700 }}>
                          {p.full_name || '(sans nom)'}
                          {isMe && (
                            <span style={{ marginLeft: 8, fontSize: '0.7rem', background: '#f0f9f5', color: '#065f46', padding: '2px 8px', borderRadius: 10 }}>
                              Vous
                            </span>
                          )}
                        </div>
                        {p.phone && <div style={{ fontSize: '0.75rem', color: '#999' }}>{p.phone}</div>}
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 12px',
                          borderRadius: 6,
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          color: 'white',
                          background: badge.color,
                        }}>
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ color: '#555' }}>{p.department || '—'}</td>
                      <td>
                        <button
                          className={p.can_validate_invoices ? 'btn-primary' : 'btn-ghost'}
                          style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                          disabled={isMe || saving === p.id}
                          onClick={() => toggleValidation(p.id, p.can_validate_invoices)}
                        >
                          {p.can_validate_invoices ? 'Oui' : 'Non'}
                        </button>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#666' }}>
                        {new Date(p.created_at).toLocaleDateString('fr-FR')}
                      </td>
                      <td>
                        {isMe ? (
                          <span style={{ fontSize: '0.8rem', color: '#999' }}>—</span>
                        ) : (
                          <select
                            className="hub-select"
                            style={{ minWidth: 130, fontSize: '0.85rem' }}
                            value={p.role}
                            disabled={saving === p.id}
                            onChange={e => changeRole(p.id, e.target.value as UserRole)}
                          >
                            {ROLES.map(r => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 48, color: '#999' }}>
                      Aucun utilisateur trouvé
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginTop: 24, padding: 16, background: '#fffbeb', borderRadius: 10, border: '1px solid #fbbf24', fontSize: '0.85rem', color: '#92400e' }}>
          <strong>Note :</strong> Seuls les utilisateurs avec le rôle CEO ou Admin peuvent accéder à cette page.
          Le changement de rôle prend effet immédiatement. L&apos;utilisateur devra recharger la page pour voir ses nouvelles permissions.
        </div>
      </div>
    </div>
  )
}
