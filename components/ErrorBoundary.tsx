'use client'
import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '60vh', gap: 16, padding: 40,
        }}>
          <div style={{ fontSize: '3rem' }}>{'\u26a0\ufe0f'}</div>
          <h2 style={{ color: '#991b1b', margin: 0 }}>Une erreur est survenue</h2>
          <p style={{ color: '#666', maxWidth: 440, textAlign: 'center', margin: 0 }}>
            {"L'application a rencontré un problème inattendu. Veuillez réessayer ou contacter l'administrateur si le problème persiste."}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.reload() }}
            style={{
              padding: '10px 28px', background: '#1a3d2b', color: 'white',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
              fontSize: '0.9rem',
            }}
          >
            Réessayer
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
