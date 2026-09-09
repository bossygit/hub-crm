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

const STATUS_OPTIONS = [
  { value: 'active', label: 'Actif', badge: 'badge-green' },
  { value: 'inactive', label: 'Inactif', badge: 'badge-red' },
  { value: 'leave', label: 'Congé', badge: 'badge-amber' },
] as const

type ProfileStatus = (typeof STATUS_OPTIONS)[number]['value']

function statusMeta(status: string | null) {
  return STATUS_OPTIONS.find(o => o.value === status) ?? STATUS_OPTIONS[0]
}

export default function AdminUsersPage() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [, setNonce] = useState(0)
  const { profile: me } = useUserRole()
  const { toast } = useToast()
  const supabase = createClient()

  const bump = useCallback(() => setNonce(n => n + 1), [])

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setLoadError(null) }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, department, phone, status, can_validate_invoices, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      setLoadError(error.message)
      if (!silent) toast('error', 'Impossible de charger les utilisateurs.')
      if (!silent) setLoading(false)
      return
    }
    setProfiles((data as ProfileRow[]) || [])
    if (!silent) setLoading(false)
  }, [toast])

  useEffect(() => { load() }, [load])

  const hasOtherWithRole = useCallback((role: UserRole, excludeId: string) =>
    profiles.some(p => p.id !== excludeId && p.role === role), [profiles])

  const displayName = (p: ProfileRow) => p.full_name || 'cet utilisateur'

  async function doUpdate(userId: string, patch: Record<string, unknown>, successMsg: string) {
    setSaving(userId)
    const { error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', userId)

    if (error) {
      toast('error', `Erreur : ${error.message}`)
    } else {
      toast('success', successMsg)
      await load(true) // re-sync (triggers côté base, ex. sync_validate_permission)
    }
    setSaving(null)
  }

  async function changeRole(userId: string, newRole: UserRole) {
    const target = profiles.find(p => p.id === userId)
    if (!target || target.role === newRole) return

    if (userId === me?.id) {
      toast('warning', 'Vous ne pouvez pas modifier votre propre rôle.')
      bump()
      return
    }

    const fromLabel = roleBadge(target.role).label
    const toLabel = roleBadge(newRole).label
    const name = displayName(target)
    const isPrivileged = target.role === 'ceo' || target.role === 'admin'

    if (isPrivileged && !hasOtherWithRole(target.role, userId)) {
      toast('error', `Impossible : « ${name} » est le dernier utilisateur avec le rôle « ${fromLabel} ». Attribuez d’abord ce rôle à un autre utilisateur avant de le rétrograder.`)
      bump()
      return
    }

    if (isPrivileged) {
      const ok = confirm(
        `Rétrograder « ${name} » ?\n\n` +
        `${name} passera du rôle « ${fromLabel} » au rôle « ${toLabel} ». ` +
        `Cette personne perdra l’accès à l’administration (gestion des rôles) et aux sections réservées aux CEO / Admins.\n\nContinuer ?`
      )
      if (!ok) { bump(); return }
    }

    await doUpdate(userId, { role: newRole }, `Rôle de « ${name} » mis à jour : ${toLabel}.`)
  }

  async function changeStatus(userId: string, newStatus: ProfileStatus) {
    const target = profiles.find(p => p.id === userId)
    if (!target || target.status === newStatus) return

    if (userId === me?.id) {
      toast('warning', 'Vous ne pouvez pas modifier votre propre statut.')
      bump()
      return
    }

    const name = displayName(target)
    const isPrivileged = target.role === 'ceo' || target.role === 'admin'

    if (newStatus === 'inactive' && isPrivileged && !hasOtherWithRole(target.role, userId)) {
      toast('error', `Impossible : « ${name} » est le dernier utilisateur avec le rôle « ${roleBadge(target.role).label} » ; il ne peut pas être désactivé.`)
      bump()
      return
    }

    if (newStatus === 'inactive') {
      const ok = confirm(
        `Désactiver « ${name} » ?\n\n` +
        `Le compte passera au statut « Inactif ». Attention : ce statut est informatif — le middleware ne bloque pas l’accès. ` +
        `Pour un blocage réel, retirez l’utilisateur dans Supabase Authentication.\n\nContinuer ?`
      )
      if (!ok) { bump(); return }
    }

    const statusLabel = STATUS_OPTIONS.find(o => o.value === newStatus)?.label ?? newStatus
    await doUpdate(userId, { status: newStatus }, `Statut de « ${name} » : ${statusLabel}.`)
  }

  async function toggleValidation(userId: string, current: boolean) {
    if (userId === me?.id) {
      toast('warning', 'Vous ne pouvez pas retirer votre propre permission de validation (elle est automatique pour les CEO / Admins).')
      return
    }
    const target = profiles.find(p => p.id === userId)
    await doUpdate(
      userId,
      { can_validate_invoices: !current },
      `Permission de validation ${!current ? 'accordée' : 'retirée'} à ${target ? `« ${displayName(target)} »` : 'cet utilisateur'}.`
    )
  }

  const q = search.trim().toLowerCase()
  const filtered = profiles.filter(p =>
    !q
    || (p.full_name || '').toLowerCase().includes(q)
    || p.role.toLowerCase().includes(q)
    || (p.department || '').toLowerCase().includes(q)
    || (p.phone || '').toLowerCase().includes(q)
  )

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

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            className="hub-input"
            style={{ maxWidth: 360 }}
            placeholder="Rechercher par nom, rôle, département, téléphone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {profiles.length > 0 && (
            <span style={{ fontSize: '0.8rem', color: '#888' }}>
              {filtered.length} / {profiles.length} utilisateur{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''}
            </span>
          )}
          <button
            className="btn-ghost"
            style={{ padding: '7px 14px', fontSize: '0.8rem' }}
            onClick={() => load()}
          >
            ↻ Rafraîchir
          </button>
        </div>

        {loadError && (
          <div style={{
            marginBottom: 16, padding: 14, borderRadius: 10, background: '#fef2f2',
            border: '1px solid #fca5a5', color: '#991b1b', fontSize: '0.85rem',
          }}>
            <strong>Erreur de chargement :</strong> {loadError}
            <button
              className="btn-primary"
              style={{ marginLeft: 12, padding: '4px 12px', fontSize: '0.75rem' }}
              onClick={() => load()}
            >
              Réessayer
            </button>
          </div>
        )}

        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4db', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>Chargement…</div>
          ) : profiles.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>
              Aucun utilisateur. Créez des comptes dans Supabase Authentication&nbsp;: un profil est créé automatiquement à la première inscription.
            </div>
          ) : (
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Rôle actuel</th>
                  <th>Statut</th>
                  <th>Département</th>
                  <th>Valide les factures</th>
                  <th>Inscrit le</th>
                  <th>Actions (rôle / statut)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const badge = roleBadge(p.role)
                  const st = statusMeta(p.status)
                  const isMe = p.id === me?.id
                  const busy = saving === p.id
                  const name = displayName(p)
                  return (
                    <tr key={p.id} style={{ opacity: busy ? 0.5 : 1 }}>
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
                          whiteSpace: 'nowrap',
                        }}>
                          {badge.label}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${st.badge}`}>{st.label}</span>
                      </td>
                      <td style={{ color: '#555' }}>{p.department || '—'}</td>
                      <td>
                        <label
                          title={isMe
                            ? 'Votre permission est automatique (CEO / Admin)'
                            : p.can_validate_invoices ? 'Retirer la permission de validation des factures' : 'Autoriser la validation des factures'}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8,
                            cursor: isMe || busy ? 'not-allowed' : 'pointer', opacity: isMe ? 0.55 : 1,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={p.can_validate_invoices}
                            disabled={isMe || busy}
                            onChange={() => toggleValidation(p.id, p.can_validate_invoices)}
                            style={{ cursor: 'inherit', accentColor: '#2d6a4f' }}
                          />
                          <span style={{ fontSize: '0.78rem', color: p.can_validate_invoices ? '#065f46' : '#666', fontWeight: p.can_validate_invoices ? 600 : 400 }}>
                            {p.can_validate_invoices ? 'Oui' : 'Non'}
                          </span>
                        </label>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#666', whiteSpace: 'nowrap' }}>
                        {new Date(p.created_at).toLocaleDateString('fr-FR')}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 150 }}>
                          <select
                            className="hub-select"
                            style={{ fontSize: '0.8rem' }}
                            value={p.role}
                            disabled={busy}
                            title={isMe ? 'Vous ne pouvez pas modifier votre propre rôle.' : `Changer le rôle de ${name}`}
                            onChange={e => changeRole(p.id, e.target.value as UserRole)}
                          >
                            {ROLES.map(r => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                          <select
                            className="hub-select"
                            style={{ fontSize: '0.8rem' }}
                            value={p.status || 'active'}
                            disabled={isMe || busy}
                            title={isMe ? 'Vous ne pouvez pas modifier votre propre statut.' : `Changer le statut de ${name}`}
                            onChange={e => changeStatus(p.id, e.target.value as ProfileStatus)}
                          >
                            {STATUS_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 48, color: '#999' }}>
                      {search.trim()
                        ? `Aucun utilisateur ne correspond à « ${search.trim()} ».`
                        : 'Aucun utilisateur trouvé'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginTop: 24, padding: 16, background: '#fffbeb', borderRadius: 10, border: '1px solid #fbbf24', fontSize: '0.85rem', color: '#92400e', lineHeight: 1.7 }}>
          <strong>Notes :</strong>
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            <li>
              Seuls <strong>CEO</strong> et <strong>Admin</strong> accèdent à cette page. Le rôle <strong>partenaire</strong> n’ouvre que le portail public.
            </li>
            <li>
              Le champ de recherche couvre le nom, le rôle, le département et le téléphone. Les adresses e-mail ne sont pas visibles ici
              (la table <code>auth.users</code> n’est pas accessible depuis le client) — consultez Supabase Authentication pour retrouver un e-mail.
            </li>
            <li>
              Vous ne pouvez pas modifier votre propre rôle ni votre propre statut, et le dernier utilisateur d’un rôle <strong>CEO</strong> / <strong>Admin</strong>
              ne peut être ni rétrogradé ni désactivé.
            </li>
            <li>
              Le statut <strong>inactif</strong> est informatif (badge d’équipe) : le middleware ne le vérifie pas et l’accès reste techniquement possible.
              Pour bloquer réellement un compte, retirez l’utilisateur dans Supabase Authentication.
            </li>
            <li>
              L’inscription publique <code>/register</code> est fermée dès qu’un profil existe. Créez les comptes suivants dans Supabase Authentication, puis assignez le rôle ici.
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
