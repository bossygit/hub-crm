'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const origin = (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, '')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${origin}/reset-password`,
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-brand">
          <div style={{ marginBottom: 8, fontSize: '2.5rem' }}>🔑</div>
          <h1>HUB Distribution</h1>
          <div className="tagline">Réinitialisation du mot de passe</div>
        </div>

        {sent ? (
          <>
            <div className="alert alert-success" style={{ marginBottom: 16 }}>
              📧 Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.
            </div>
            <p style={{ marginBottom: 24, color: '#666', fontSize: '0.85rem', lineHeight: 1.6 }}>
              Vérifiez votre boîte de réception (et vos courriers indésirables). Le lien est valable
              pendant une durée limitée.
            </p>
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
              Retour à la connexion →
            </a>
          </>
        ) : (
          <>
            <p style={{ marginBottom: 20, color: '#666', fontSize: '0.85rem', lineHeight: 1.6 }}>
              Saisissez l&apos;adresse email de votre compte : nous vous enverrons un lien pour
              choisir un nouveau mot de passe.
            </p>
            {error && (
              <div className="alert alert-error" style={{ marginBottom: 20 }}>
                ⚠️ {error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="hub-form-group">
                <label>Adresse Email</label>
                <input
                  className="hub-input"
                  type="email"
                  placeholder="vous@hubdistribution.cg"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <button
                type="submit"
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '14px' }}
                disabled={loading}
              >
                {loading ? 'Envoi...' : 'Recevoir le lien →'}
              </button>
            </form>
            <div style={{ textAlign: 'center', marginTop: 20, color: '#666', fontSize: '0.8rem' }}>
              Vous vous souvenez de votre mot de passe ?{' '}
              <a href="/login" style={{ color: 'var(--hub-green-mid)', fontWeight: 600 }}>
                Se connecter
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
