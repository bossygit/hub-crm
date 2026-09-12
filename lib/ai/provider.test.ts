import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveAiProvider,
  buildChatRequest,
  parseChatCompletion,
  describeProviderError,
  AI_PROVIDER_PRESETS,
} from './provider.ts'

describe('resolveAiProvider', () => {
  it('renvoie null sans clé exploitable', () => {
    assert.equal(resolveAiProvider({}), null)
    assert.equal(resolveAiProvider({ OLLAMA_API_KEY: '', DEEPSEEK_API_KEY: '   ' }), null)
    assert.equal(resolveAiProvider({ OLLAMA_API_KEY: 'your-api-key' }), null)
  })

  it('utilise Ollama par défaut avec sa clé', () => {
    const p = resolveAiProvider({ OLLAMA_API_KEY: 'abc123' })!
    assert.equal(p.id, 'ollama')
    assert.equal(p.baseUrl, AI_PROVIDER_PRESETS.ollama.baseUrl)
    assert.equal(p.model, 'gemma4:31b-cloud')
    assert.equal(p.apiKey, 'abc123')
  })

  it('privilégie DeepSeek si sa clé est présente', () => {
    const p = resolveAiProvider({ OLLAMA_API_KEY: 'o', DEEPSEEK_API_KEY: 'd' })!
    assert.equal(p.id, 'deepseek')
    assert.equal(p.model, 'deepseek-chat')
    assert.equal(p.baseUrl, 'https://api.deepseek.com/v1')
  })

  it('respecte AI_PROVIDER explicite, avec repli si la clé manque', () => {
    assert.equal(resolveAiProvider({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd' })!.id, 'deepseek')
    // deepseek demandé mais seule la clé Ollama existe -> repli Ollama
    const fallback = resolveAiProvider({ AI_PROVIDER: 'deepseek', OLLAMA_API_KEY: 'o' })!
    assert.equal(fallback.id, 'ollama')
    assert.equal(resolveAiProvider({ AI_PROVIDER: 'ollama', OLLAMA_API_KEY: 'o', DEEPSEEK_API_KEY: 'd' })!.id, 'ollama')
  })

  it('accepte AI_MODEL et AI_BASE_URL, et nettoie le slash final', () => {
    const p = resolveAiProvider({
      OLLAMA_API_KEY: 'k',
      AI_MODEL: 'gemma4:31b',
      AI_BASE_URL: 'https://exemple.test/v1/',
    })!
    assert.equal(p.model, 'gemma4:31b')
    assert.equal(p.baseUrl, 'https://exemple.test/v1')
  })
})

describe('buildChatRequest', () => {
  it('construit une requête OpenAI-compatible', () => {
    const provider = resolveAiProvider({ OLLAMA_API_KEY: 'secret' })!
    const req = buildChatRequest({
      provider,
      messages: [{ role: 'user', content: 'Bonjour' }],
    })
    assert.equal(req.url, 'https://ollama.com/v1/chat/completions')
    assert.equal(req.headers.Authorization, 'Bearer secret')
    assert.equal(req.body.model, 'gemma4:31b-cloud')
    assert.equal(req.body.stream, false)
    assert.equal(req.body.temperature, 0.2)
    assert.equal(req.body.messages.length, 1)
  })

  it('accepte des options explicites', () => {
    const provider = resolveAiProvider({ OLLAMA_API_KEY: 'k' })!
    const req = buildChatRequest({ provider, messages: [], temperature: 0.7, maxTokens: 100 })
    assert.equal(req.body.temperature, 0.7)
    assert.equal(req.body.max_tokens, 100)
  })
})

describe('parseChatCompletion', () => {
  it('extrait le texte et l’usage', () => {
    const out = parseChatCompletion({
      choices: [{ message: { content: '  Bonjour CEO  ' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
    assert.equal(out.text, 'Bonjour CEO')
    assert.equal(out.usage.totalTokens, 15)
  })

  it('échoue proprement sur une réponse vide', () => {
    assert.throws(() => parseChatCompletion({ choices: [] }), /vide/)
    assert.throws(() => parseChatCompletion({ choices: [{ message: { content: '   ' } }] }), /vide/)
  })
})

describe('describeProviderError', () => {
  it('traduit les statuts courants sans divulguer la clé', () => {
    assert.match(describeProviderError(401, ''), /Clé API refusée/)
    assert.match(describeProviderError(404, ''), /Modèle introuvable/)
    assert.match(describeProviderError(429, ''), /Quota/)
    const msg = describeProviderError(500, 'boom')
    assert.match(msg, /500/)
    assert.ok(!msg.includes('Bearer'))
  })
})
