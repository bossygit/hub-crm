'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Email ou mot de passe incorrect')
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-brand">
          <img
            src="/app/assets/images/app-icon.png"
            alt="HUB Distribution"
            style={{ width: 84, height: 84, margin: '0 auto 12px', display: 'block' }}
          />
          <h1>HUB Distribution</h1>
          <div className="tagline">Système de Gestion Intégré</div>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="hub-form-group">
            <label>Adresse Email</label>
            <input
              className="hub-input"
              type="email"
              placeholder="vous@hubdistribution.cg"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="hub-form-group">
            <label>Mot de passe</label>
            <input
              className="hub-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '14px' }}
            disabled={loading}
          >
            {loading ? 'Connexion...' : 'Se connecter →'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 24, color: '#666', fontSize: '0.8rem' }}>
          Vous n&apos;avez pas de compte ?{' '}
          <a href="/register" style={{ color: 'var(--hub-green-mid)', fontWeight: 600 }}>
            S&apos;inscrire
          </a>
        </div>

        <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid #eee', textAlign: 'center' }}>
          <a href="/portal" style={{ color: 'var(--hub-amber)', fontSize: '0.8rem', fontWeight: 600 }}>
            🔗 Portail Partenaires & Institutions →
          </a>
        </div>
      </div>
    </div>
  )
}
