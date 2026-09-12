/**
 * Assistant de direction — persona, questions suggérées et assemblage des
 * messages envoyés au LLM. Pur (hors appel réseau) donc testable.
 */

import type { AiMessage } from './provider'

export const AI_SYSTEM_PROMPT = `Tu es l'assistant de direction (« CEO Assistant ») de HUB Distribution, entreprise congolaise de transformation et distribution agricole (Brazzaville).

Règles strictes :
- Réponds en français, de façon brève, concrète et professionnelle.
- Appuie-toi UNIQUEMENT sur les données CRM fournies dans le message « DONNÉES CRM ». N'invente aucun chiffre.
- Si une information demandée n'est pas présente dans les données, dis-le clairement et indique où la trouver dans le CRM.
- Exprime tous les montants en FCFA (séparateur de milliers).
- Tu ne peux pas modifier la base : tu observes et tu conseilles. Formule les actions à faire comme des recommandations.
- Termine par une recommandation actionnable quand c'est pertinent (relance, réapprovisionnement, priorité commerciale).
- Ne dépasse pas ~250 mots sauf demande explicite de détail.`

export const SUGGESTED_QUESTIONS = [
  'Comment vont les ventes cette année ?',
  'Quels clients sont en retard de paiement et pour combien ?',
  'Quels produits dois-je réapprovisionner en priorité ?',
  'Quels sont mes meilleurs clients ?',
  'Où en sont les factures en attente de validation ?',
  'Résume la situation de l’entreprise en 5 points.',
]

export const MAX_HISTORY_MESSAGES = 8

/** Ne conserve que les tours user/assistant, les plus récents. */
export function sanitizeHistory(history: unknown, max: number = MAX_HISTORY_MESSAGES): AiMessage[] {
  if (!Array.isArray(history)) return []
  const cleaned = history
    .filter((m): m is { role: string; content: string } =>
      !!m && typeof m === 'object'
      && typeof (m as { content?: unknown }).content === 'string'
      && ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant'),
    )
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 4000) }))
  return cleaned.slice(-Math.max(0, max))
}

/**
 * Assemble les messages : persona, données CRM, historique récent, question.
 * Le contexte est un message système distinct pour que le modèle le traite
 * comme une source de vérité et non comme une instruction.
 */
export function buildAssistantMessages(params: {
  question: string
  snapshotText: string
  history?: unknown
  maxHistory?: number
}): AiMessage[] {
  const messages: AiMessage[] = [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    { role: 'system', content: params.snapshotText },
  ]
  messages.push(...sanitizeHistory(params.history, params.maxHistory ?? MAX_HISTORY_MESSAGES))
  messages.push({ role: 'user', content: params.question.trim().slice(0, 2000) })
  return messages
}
