'use client'
import { useState } from 'react'

/**
 * Déclenche le scan des alertes (stock bas + factures en retard) côté serveur.
 * En production, la même route est appelée quotidiennement par un cron Vercel
 * (`/api/notifications/scan`) ; ce bouton permet un déclenchement manuel et
 * sert de repli si CRON_SECRET n'est pas configuré.
 */
export default function AlertsScanButton() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  async function run() {
    setBusy(true)
    setMessage(null)
    setIsError(false)
    try {
      const result = await fetch('/api/notifications/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(r => r.json())

      if (!result?.ok) throw new Error(result?.error || 'Scan impossible.')
      setMessage(result.total
        ? `${result.total} alerte(s) créée(s) — ${result.stockLow} stock bas, ${result.overdue} facture(s) en retard.`
        : 'Aucune nouvelle alerte (tout est à jour).')
    } catch (e) {
      setIsError(true)
      setMessage(e instanceof Error ? e.message : 'Erreur inattendue.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <button type="button" className="btn-ghost" disabled={busy} onClick={run}>
        {busy ? '⏳ Scan en cours…' : '🔔 Générer les alertes'}
      </button>
      <span style={{ fontSize: '0.78rem', color: '#888' }}>
        Stock bas et factures en retard → notifications dans la cloche.
      </span>
      {message && (
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: isError ? '#991b1b' : '#065f46' }}>{message}</span>
      )}
    </div>
  )
}
