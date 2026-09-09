// Suivi du rendement de production : quantité réellement obtenue vs quantité planifiée.
// Helpers purs (aucune dépendance) : calcul du %, libellé, couleur de badge, validation.
// Le rendement est saisi après la production ; si aucune quantité réelle n'est renseignée
// (NULL), l'ordre est considéré à 100 % (UI) et le stock est entré sur la base du planifié.

export type YieldLevel = 'expected' | 'good' | 'low'

// Garde-fou anti-erreur de saisie : une quantité réelle > 3 × le planifié est
// presque toujours une erreur (mauvaise unité, chiffre décalé). Au-delà, on refuse.
// En deçà (même > 100 %), on accepte : un rendement peut dépasser la prévision.
const PLANNED_MAX_MULTIPLIER = 3

/**
 * Rendement en % = réel / planifié × 100, arrondi à 1 décimale.
 * Retourne null quand aucune quantité réelle n'est enregistrée (ou planifié invalide).
 * Accepte les nombres comme les chaînes numériques renvoyées par PostgREST (numeric).
 */
export function computeYieldPct(actual: number | null | undefined, planned: number): number | null {
  if (actual == null) return null
  const a = Number(actual)
  const p = Number(planned)
  if (!Number.isFinite(a) || !Number.isFinite(p) || p <= 0) return null
  return Math.round((a / p) * 1000) / 10
}

/** Niveau de rendement : 'expected' ≥ 100 %, 'good' ≥ 90 %, 'low' sinon ; null si non saisi. */
export function yieldLevel(pct: number | null): YieldLevel | null {
  if (pct == null) return null
  if (pct >= 100) return 'expected'
  if (pct >= 90) return 'good'
  return 'low'
}

/** Libellé français du rendement. */
export function yieldLabel(pct: number | null): string {
  if (pct == null) return '—'
  if (pct >= 100) return 'Rendement attendu'
  if (pct >= 90) return 'Correct'
  return 'Faible'
}

/** Classe de badge (couleur) selon le pourcentage de rendement. */
export function yieldBadgeClass(pct: number | null): string {
  const level = yieldLevel(pct)
  if (level === 'expected') return 'badge-green'
  if (level === 'good') return 'badge-amber'
  if (level === 'low') return 'badge-red'
  return 'badge-gray'
}

/**
 * Valide une quantité réellement obtenue saisie dans le formulaire.
 * - null / champ vide → pas de rendement saisi, valide (stock au planifié).
 * - doit être strictement positive.
 * - borne haute de sécurité : 3 × la quantité planifiée (sauf planifié non positif).
 * Retourne un message d'erreur français, ou null si valide.
 */
export function validateActualOutput(value: number | null, planned: number): string | null {
  if (value == null) return null
  if (!Number.isFinite(value)) return 'Quantité invalide.'
  if (value <= 0) return 'La quantité réellement obtenue doit être positive.'
  const p = Number(planned)
  if (Number.isFinite(p) && p > 0 && value > p * PLANNED_MAX_MULTIPLIER) {
    return `Quantité aberrante : elle dépasse 3 × le planifié (${p}). Vérifiez la saisie.`
  }
  return null
}
