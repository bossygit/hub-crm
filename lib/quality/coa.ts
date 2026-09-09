// COA — Certificat d'analyse : logique pure (conclusion, validation, formatage).
// Aucun import local : utilisable aussi bien par l'UI Next que par les tests node.

export type CoaConclusion = 'conforme' | 'non_conforme'

export interface CoaParameter {
  label: string
  value: string
  unit?: string
  min?: number | null
  max?: number | null
  ok: boolean
}

export const COA_CONCLUSION_LABELS: Record<CoaConclusion, { label: string; badge: string; icon: string }> = {
  conforme: { label: 'Conforme', badge: 'badge-green', icon: '✅' },
  non_conforme: { label: 'Non conforme', badge: 'badge-red', icon: '❌' },
}

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  reception: 'Réception',
  production: 'Production',
  stock: 'Stock',
  autre: 'Autre',
}

export const CCP_SUGGESTIONS = [
  'Température de réception',
  'Température chambre froide',
  'Aspect visuel',
  'Odeur',
  'Texture',
  'Humidité',
  'pH',
  'Emballage et étiquetage',
] as const

/** Convertit une saisie (virgule décimale acceptée) en nombre, ou null. */
export function parseNumericValue(value: string): number | null {
  if (typeof value !== 'string') return null
  const t = value.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Conformité automatique d'un paramètre d'après ses limites (min/max). */
export function isAutoOk(value: string, min?: number | null, max?: number | null): boolean {
  const hasMin = min !== undefined && min !== null
  const hasMax = max !== undefined && max !== null
  if (!hasMin && !hasMax) return true
  const n = parseNumericValue(value)
  if (n === null) return false
  if (hasMin && n < (min as number)) return false
  if (hasMax && n > (max as number)) return false
  return true
}

/** Conclusion globale : conforme si tous les paramètres sont OK. */
export function computeCoaConclusion(parameters: CoaParameter[]): CoaConclusion {
  if (parameters.length === 0) return 'non_conforme'
  return parameters.every(p => p.ok) ? 'conforme' : 'non_conforme'
}

/** Erreurs structurelles (message vide = paramètres valides pour enregistrement). */
export function validateParameters(parameters: CoaParameter[]): string[] {
  const errors: string[] = []
  if (parameters.length === 0) {
    errors.push('Ajoutez au moins un paramètre d\u2019analyse.')
    return errors
  }
  parameters.forEach((p, idx) => {
    const row = `Ligne ${idx + 1}`
    const label = (p.label || '').trim()
    if (!label) {
      errors.push(`${row} : le libellé du paramètre est requis.`)
    }
    const value = typeof p.value === 'string' ? p.value.trim() : ''
    if (!value) {
      errors.push(`${row}${label ? ` (${label})` : ''} : la valeur mesurée est requise.`)
    }
    const hasMin = p.min !== undefined && p.min !== null
    const hasMax = p.max !== undefined && p.max !== null
    if ((hasMin || hasMax) && value && parseNumericValue(value) === null) {
      errors.push(`${row} (${label || 'paramètre'}) : la valeur doit être numérique pour être comparée aux limites.`)
    }
    if (hasMin && hasMax && (p.min as number) > (p.max as number)) {
      errors.push(`${row} (${label || 'paramètre'}) : la limite minimale est supérieure à la limite maximale.`)
    }
  })
  return errors
}

export function formatCoaNumber(year: number | string, seq: number): string {
  return `COA-${String(year)}-${String(seq).padStart(4, '0')}`
}

export function formatCcpNumber(year: number | string, seq: number): string {
  return `CCP-${String(year)}-${String(seq).padStart(4, '0')}`
}

/** Libellé des limites pour l'affichage (tableau PDF / UI). */
export function limitsLabel(p: { min?: number | null; max?: number | null }): string {
  const hasMin = p.min !== undefined && p.min !== null
  const hasMax = p.max !== undefined && p.max !== null
  if (hasMin && hasMax) return `${p.min} – ${p.max}`
  if (hasMin) return `≥ ${p.min}`
  if (hasMax) return `≤ ${p.max}`
  return '—'
}

/**
 * Parse une valeur jsonb quality_coa.parameters en CoaParameter[] sûr.
 * Les lignes invalides sont ignorées ; ok retombe sur la conformité auto.
 */
export function parseParameters(raw: unknown): CoaParameter[] {
  if (!Array.isArray(raw)) return []
  const out: CoaParameter[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.label !== 'string' || typeof r.value !== 'string') continue
    const toNum = (v: unknown): number | null =>
      typeof v === 'number' ? v : typeof v === 'string' ? parseNumericValue(v) : null
    const min = toNum(r.min)
    const max = toNum(r.max)
    const ok =
      typeof r.ok === 'boolean'
        ? (r.ok as boolean)
        : isAutoOk(r.value, min, max)
    out.push({
      label: r.label,
      value: r.value,
      unit: typeof r.unit === 'string' ? r.unit : undefined,
      min,
      max,
      ok,
    })
  }
  return out
}
