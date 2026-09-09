/**
 * Logique métier du « comptage à l'aveugle » des inventaires physiques.
 * Logique pure sans dépendance, testable isolément (node --experimental-strip-types --test).
 * Le gel de stock pendant un inventaire ouvert est, lui, imposé en base :
 * voir supabase/fix-inventory-freeze.sql (trigger fn_inventory_freeze_guard).
 */

export interface InventorySessionLike {
  status?: string | null
  blind?: boolean | null
  revealed_at?: string | null
}

export interface InventoryCountLineLike {
  /** Quantité saisie par le compteur (vide tant que la ligne n'a pas été comptée). */
  entry_quantity?: number | string | null
  counted?: number | string | null
}

/** true si la séance a été créée en mode aveugle. */
export function isBlindSession(s: InventorySessionLike | null | undefined): boolean {
  return !!s && s.blind === true
}

/** true si un manager a déjà dévoilé les écarts (revealed_at posé). */
export function hasRevealedGaps(s: InventorySessionLike | null | undefined): boolean {
  return isBlindSession(s) && !!s?.revealed_at
}

/**
 * Le théorique reste masqué tant que la séance aveugle est ouverte (draft) et
 * non révélée. Une fois la séance validée ou annulée, le masque tombe : l'écart
 * définitif enregistré au stock doit rester consultable (piste d'audit).
 */
export function masksTheoretical(s: InventorySessionLike | null | undefined): boolean {
  return isBlindSession(s) && !s?.revealed_at && s?.status === 'draft'
}

/** Un manager peut dévoiler les écarts tant que la séance aveugle est en cours. */
export function canRevealGaps(s: InventorySessionLike | null | undefined): boolean {
  return masksTheoretical(s)
}

/** Le théorique (et l'écart) est-il affichable à l'écran ? */
export function theoreticalVisible(s: InventorySessionLike | null | undefined): boolean {
  return !masksTheoretical(s)
}

/**
 * En aveugle les lignes démarrent vides : refuser la validation tant qu'une
 * ligne n'a pas réellement été comptée (évite de valider un « 0 » subi sur une
 * ligne oubliée).
 */
export function hasUncountedLines(lines: InventoryCountLineLike[]): boolean {
  return lines.some(
    l => l.entry_quantity === null || l.entry_quantity === undefined || l.entry_quantity === '',
  )
}
