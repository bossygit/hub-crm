'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.full_name } }
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-brand">
          <div style={{ marginBottom: 8, fontSize: '2.5rem' }}>🌿</div>
          <h1>HUB Distribution</h1>
          <div className="tagline">Créer un compte</div>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleRegister}>
          <div className="hub-form-group">
            <label>Nom complet</label>
            <input className="hub-input" type="text" placeholder="Jean Mbemba" value={form.full_name}
              onChange={e => setForm({...form, full_name: e.target.value})} required />
          </div>
          <div className="hub-form-group">
            <label>Email</label>
            <input className="hub-input" type="email" placeholder="vous@hubdistribution.cg" value={form.email}
              onChange={e => setForm({...form, email: e.target.value})} required />
          </div>
          <div className="hub-form-group">
            <label>Mot de passe</label>
            <input className="hub-input" type="password" placeholder="Min. 6 caractères" value={form.password}
              onChange={e => setForm({...form, password: e.target.value})} required minLength={6} />
          </div>
          <button type="submit" className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '14px' }} disabled={loading}>
            {loading ? 'Création...' : 'Créer mon compte →'}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 20, color: '#666', fontSize: '0.8rem' }}>
          Déjà un compte ? <a href="/login" style={{ color: 'var(--hub-green-mid)', fontWeight: 600 }}>Se connecter</a>
        </div>
      </div>
    </div>
  )
}
