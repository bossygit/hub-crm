'use client'
import { useState } from 'react'

/**
 * Réapprovisionnement automatique (phase 3) : regroupe les produits sous seuil
 * par fournisseur et crée un bon de commande BROUILLON par fournisseur.
 * Aperçu puis confirmation ; les produits déjà en commande ouverte sont exclus.
 */
export default function ReorderButton({ label = '🛒 Réapprovisionner' }: { label?: string }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  async function run() {
    setBusy(true)
    setMessage(null)
    setIsError(false)
    try {
      const preview = await fetch('/api/purchases/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      }).then(r => r.json())

      if (!preview?.ok) throw new Error(preview?.error || 'Aperçu impossible.')

      if (!preview.suppliers) {
        setMessage(preview.withoutSupplier
          ? `${preview.withoutSupplier} produit(s) sous seuil sans fournisseur — à rattacher.`
          : 'Aucun produit à réapprovisionner.')
        return
      }

      const detail = (preview.plans || [])
        .map((p: { supplier_name: string; items: number }) => `• ${p.supplier_name} — ${p.items} article(s)`)
        .join('\n')
      const total = Math.round(Number(preview.estimated_total) || 0).toLocaleString('fr-FR')
      const extra = preview.withoutSupplier ? `\n(${preview.withoutSupplier} produit(s) sans fournisseur ignoré(s))` : ''

      if (!confirm(`Créer ${preview.suppliers} bon(s) de commande brouillon ?\n\n${detail}\n\nTotal estimé : ${total} FCFA${extra}`)) return

      const result = await fetch('/api/purchases/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(r => r.json())

      if (!result?.ok) throw new Error(result?.error || 'Génération impossible.')
      setIsError(!!result.failed)
      setMessage(`${result.created} commande(s) créée(s)${result.failed ? `, ${result.failed} échec(s)` : ''}.`)
    } catch (e) {
      setIsError(true)
      setMessage(e instanceof Error ? e.message : 'Erreur inattendue.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" className="btn-ghost" disabled={busy} onClick={run} title="Créer les bons de commande fournisseur pour les produits sous seuil">
        {busy ? '⏳…' : label}
      </button>
      {message && (
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isError ? '#991b1b' : '#065f46' }}>{message}</span>
      )}
    </span>
  )
}
