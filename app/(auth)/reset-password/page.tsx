'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Session } from '@supabase/supabase-js'

export default function ResetPasswordPage() {
  const [checking, setChecking] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    let active = true
    // Supabase arrive sur /reset-password avec les tokens dans le hash de l'URL
    // (type=recovery) : le client les échange automatiquement, mais de façon
    // asynchrone. On combine l'écoute des événements et getSession pour capter
    // la session de récupération dès qu'elle est prête.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      if (event === 'SIGNED_OUT') {
        setSession(null)
        setChecking(false)
        return
      }
      if (nextSession) {
        setSession(nextSession)
        setChecking(false)
      }
    })
    supabase.auth.getSession().then(({ data: { session: current } }) => {
      if (!active) return
      if (current) setSession(current)
      setChecking(false)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    await supabase.auth.signOut()
    setLoading(false)
    setSuccess(true)
  }

  const fieldType = show ? 'text' : 'password'

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-brand">
          <div style={{ marginBottom: 8, fontSize: '2.5rem' }}>🔐</div>
          <h1>HUB Distribution</h1>
          <div className="tagline">Nouveau mot de passe</div>
        </div>

        {checking ? (
          <div style={{ textAlign: 'center', color: '#666', fontSize: '0.85rem', padding: '20px 0' }}>
            Vérification du lien…
          </div>
        ) : success ? (
          <>
            <div className="alert alert-success" style={{ marginBottom: 16 }}>
              ✅ Votre mot de passe a bien été mis à jour.
            </div>
            <a
              href="/login"
              className="btn-primary"
              style={{
                width: '100%',
                justifyContent: 'center',
                textDecoration: 'none',
                marginTop: 8,
                padding: '14px',
              }}
            >
              Se connecter →
            </a>
          </>
        ) : !session ? (
          <>
            <div className="alert alert-error" style={{ marginBottom: 20 }}>
              ⚠️ Lien invalide ou expiré.
            </div>
            <p style={{ marginBottom: 24, color: '#666', fontSize: '0.85rem', lineHeight: 1.6 }}>
              Ce lien de réinitialisation est invalide ou a expiré. Vous pouvez en demander un
              nouveau : un email vous sera envoyé avec un lien actualisé.
            </p>
            <a
              href="/forgot-password"
              className="btn-primary"
              style={{
                width: '100%',
                justifyContent: 'center',
                textDecoration: 'none',
                marginTop: 8,
                padding: '14px',
              }}
            >
              Renouveler le lien →
            </a>
            <div style={{ textAlign: 'center', marginTop: 20, color: '#666', fontSize: '0.8rem' }}>
              <a href="/login" style={{ color: 'var(--hub-green-mid)', fontWeight: 600 }}>
                Retour à la connexion
              </a>
            </div>
          </>
        ) : (
          <>
            {error && (
              <div className="alert alert-error" style={{ marginBottom: 20 }}>
                ⚠️ {error}
              </div>
            )}
            <p style={{ marginBottom: 20, color: '#666', fontSize: '0.85rem', lineHeight: 1.6 }}>
              Choisissez un nouveau mot de passe (8 caractères minimum).
            </p>
            <form onSubmit={handleSubmit}>
              <div className="hub-form-group">
                <label>Nouveau mot de passe</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="hub-input"
                    type={fieldType}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoFocus
                    style={{ paddingRight: 76 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShow(v => !v)}
                    style={{
                      position: 'absolute',
                      right: 6,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--hub-green-mid)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '6px 8px',
                    }}
                  >
                    {show ? 'Masquer' : 'Afficher'}
                  </button>
                </div>
              </div>
              <div className="hub-form-group">
                <label>Confirmer le mot de passe</label>
                <input
                  className="hub-input"
                  type={fieldType}
                  placeholder="••••••••"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <button
                type="submit"
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '14px' }}
                disabled={loading}
              >
                {loading ? 'Enregistrement...' : 'Mettre à jour le mot de passe →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
