import { Resend } from 'resend'

export const resend = new Resend(process.env.RESEND_API_KEY || 'placeholder')

/**
 * Expéditeur des e-mails transactionnels.
 * Configurable via RESEND_FROM : indispensable tant que le domaine d'envoi
 * n'est pas vérifié dans Resend (on peut alors utiliser `onboarding@resend.dev`,
 * qui n'envoie toutefois qu'à l'adresse du compte Resend).
 */
export const RESEND_FROM =
  (process.env.RESEND_FROM || '').trim() || 'HUB-Distribution <contact@hub-distribution.com>'

/** Vrai si une clé Resend exploitable est configurée. */
export function isResendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY
  return !!key && key !== 're_your-resend-api-key-here'
}

/** Domaine d'envoi extrait de RESEND_FROM (pour les messages d'erreur). */
export function resendFromDomain(): string {
  const match = /<([^>]+)>/.exec(RESEND_FROM)
  const address = (match ? match[1] : RESEND_FROM).trim()
  return address.split('@')[1] || address
}

