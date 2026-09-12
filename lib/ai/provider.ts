/**
 * Fournisseur LLM — abstraction OpenAI-compatible.
 *
 * On parle le protocole `/chat/completions` (OpenAI), ce qui permet de
 * démarrer sur Ollama Cloud puis de basculer sur DeepSeek en changeant une
 * variable d'environnement, sans toucher au code.
 *
 *   AI_PROVIDER=ollama   OLLAMA_API_KEY=…    (défaut, modèle gemma4:31b-cloud)
 *   AI_PROVIDER=deepseek DEEPSEEK_API_KEY=…  (modèle deepseek-chat)
 *
 * Surcharges optionnelles : AI_MODEL, AI_BASE_URL.
 * Aucune clé n'est jamais codée en dur ni journalisée.
 */

export type AiProviderId = 'ollama' | 'deepseek'

export type AiProviderConfig = {
  id: AiProviderId
  label: string
  baseUrl: string
  apiKey: string
  model: string
}

export const AI_PROVIDER_PRESETS: Record<AiProviderId, { label: string; baseUrl: string; model: string }> = {
  ollama: { label: 'Ollama Cloud', baseUrl: 'https://ollama.com/v1', model: 'gemma4:31b-cloud' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
}

const PLACEHOLDER_KEYS = new Set(['', 're_your-resend-api-key-here', 'your-api-key', 'changeme'])

function usableKey(value?: string | null): string | null {
  const key = (value || '').trim()
  if (!key || PLACEHOLDER_KEYS.has(key)) return null
  return key
}

/**
 * Choisit le fournisseur actif d'après l'environnement.
 * `AI_PROVIDER` force le fournisseur ; sinon on privilégie DeepSeek si sa clé
 * est présente, sinon Ollama. Renvoie null si aucune clé exploitable.
 */
export function resolveAiProvider(
  env: Record<string, string | undefined> = process.env,
): AiProviderConfig | null {
  const explicit = (env.AI_PROVIDER || '').trim().toLowerCase()
  const ollamaKey = usableKey(env.OLLAMA_API_KEY)
  const deepseekKey = usableKey(env.DEEPSEEK_API_KEY)

  let id: AiProviderId
  if (explicit === 'deepseek') id = 'deepseek'
  else if (explicit === 'ollama') id = 'ollama'
  else id = deepseekKey ? 'deepseek' : 'ollama'

  let apiKey = id === 'deepseek' ? deepseekKey : ollamaKey
  if (!apiKey) {
    // Repli sur l'autre fournisseur si sa clé existe (évite une panne totale).
    const fallbackId: AiProviderId = id === 'deepseek' ? 'ollama' : 'deepseek'
    const fallbackKey = fallbackId === 'deepseek' ? deepseekKey : ollamaKey
    if (!fallbackKey) return null
    id = fallbackId
    apiKey = fallbackKey
  }

  const preset = AI_PROVIDER_PRESETS[id]
  const baseUrl = (env.AI_BASE_URL || preset.baseUrl).trim().replace(/\/+$/, '')
  const model = (env.AI_MODEL || preset.model).trim()

  return { id, label: preset.label, baseUrl, apiKey, model }
}

export type AiRole = 'system' | 'user' | 'assistant'
export type AiMessage = { role: AiRole; content: string }

export type ChatRequest = {
  url: string
  headers: Record<string, string>
  body: {
    model: string
    messages: AiMessage[]
    temperature: number
    max_tokens: number
    stream: false
  }
}

export function buildChatRequest(params: {
  provider: AiProviderConfig
  messages: AiMessage[]
  temperature?: number
  maxTokens?: number
}): ChatRequest {
  return {
    url: `${params.provider.baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.provider.apiKey}`,
    },
    body: {
      model: params.provider.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 900,
      stream: false,
    },
  }
}

export type ChatUsage = { promptTokens?: number; completionTokens?: number; totalTokens?: number }

/** Extrait le texte d'une réponse OpenAI-compatible. */
export function parseChatCompletion(json: unknown): { text: string; usage: ChatUsage } {
  const payload = json as {
    choices?: { message?: { content?: unknown } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  const content = payload?.choices?.[0]?.message?.content
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) throw new Error('Réponse vide du modèle.')
  return {
    text,
    usage: {
      promptTokens: payload?.usage?.prompt_tokens,
      completionTokens: payload?.usage?.completion_tokens,
      totalTokens: payload?.usage?.total_tokens,
    },
  }
}

/** Message d'erreur court, sans fuite de la clé API. */
export function describeProviderError(status: number, body: string): string {
  const trimmed = (body || '').replace(/\s+/g, ' ').slice(0, 300)
  if (status === 401 || status === 403) return 'Clé API refusée par le fournisseur LLM.'
  if (status === 404) return 'Modèle introuvable chez le fournisseur LLM.'
  if (status === 429) return 'Quota ou débit dépassé chez le fournisseur LLM.'
  return `Erreur du fournisseur LLM (${status})${trimmed ? ` : ${trimmed}` : ''}`
}
