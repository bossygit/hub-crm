/**
 * Compatibilité des statuts employés avec les schémas hérités.
 *
 * La base distante `hub` a été initialisée avec un ancien schéma dont les
 * statuts étaient en anglais (active / on_leave / terminated), alors que
 * l'application utilise les valeurs françaises (actif / conge / suspendu /
 * sorti). La migration 20260911150000 élargit le CHECK pour accepter les deux
 * jeux de valeurs SANS réécrire les lignes existantes ; la traduction se fait
 * donc ici, à l'affichage et dans les filtres.
 */

import type { EmployeeStatus } from '@/types'

/** Valeurs héritées -> valeur applicative. */
export const LEGACY_EMPLOYEE_STATUS: Record<string, EmployeeStatus> = {
  active: 'actif',
  on_leave: 'conge',
  terminated: 'sorti',
}

/** Toutes les valeurs acceptées par le CHECK `employees_status_check`. */
export const EMPLOYEE_STATUS_VALUES = [
  'actif', 'conge', 'suspendu', 'sorti',
  'active', 'on_leave', 'terminated',
] as const

/**
 * Statuts considérés « en poste » (utilisés par les listes déroulantes RH :
 * contrats, congés, paie, attestations, pointage). Inclut les valeurs
 * héritées pour ne filtrer personne à tort.
 */
export const EMPLOYEE_ACTIVE_STATUSES = ['actif', 'conge', 'active', 'on_leave']

/** Ramène un statut hérité vers sa valeur applicative (défaut : actif). */
export function normalizeEmployeeStatus(status?: string | null): EmployeeStatus {
  if (!status) return 'actif'
  if (status in LEGACY_EMPLOYEE_STATUS) return LEGACY_EMPLOYEE_STATUS[status]
  return status as EmployeeStatus
}

export function isLegacyEmployeeStatus(status?: string | null): boolean {
  return !!status && status in LEGACY_EMPLOYEE_STATUS
}
