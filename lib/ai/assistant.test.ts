import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildAssistantMessages, sanitizeHistory, AI_SYSTEM_PROMPT, SUGGESTED_QUESTIONS, MAX_HISTORY_MESSAGES } from './assistant.ts'

describe('sanitizeHistory', () => {
  it('ignore les entrées invalides et garde user/assistant', () => {
    const out = sanitizeHistory([
      { role: 'user', content: 'Bonjour' },
      { role: 'system', content: 'ignoré' },
      { role: 'assistant', content: 'Salut' },
      { role: 'user', content: 42 },
      null,
      'texte',
    ])
    assert.deepEqual(out, [
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: 'Salut' },
    ])
  })

  it('ne garde que les N derniers messages', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` }))
    const out = sanitizeHistory(many, 4)
    assert.equal(out.length, 4)
    assert.equal(out[out.length - 1].content, 'm19')
  })

  it('tronque les contenus trop longs', () => {
    const out = sanitizeHistory([{ role: 'user', content: 'x'.repeat(9000) }])
    assert.equal(out[0].content.length, 4000)
  })

  it('renvoie un tableau vide pour une entrée non tableau', () => {
    assert.deepEqual(sanitizeHistory(undefined), [])
    assert.deepEqual(sanitizeHistory('nope'), [])
  })
})

describe('buildAssistantMessages', () => {
  it('ordonne persona, données, historique puis question', () => {
    const messages = buildAssistantMessages({
      question: '  Comment vont les ventes ?  ',
      snapshotText: 'DONNÉES CRM : CA 1 000 000 FCFA',
      history: [
        { role: 'user', content: 'Bonjour' },
        { role: 'assistant', content: 'Bonjour, que puis-je faire ?' },
      ],
    })
    assert.equal(messages.length, 5)
    assert.equal(messages[0].role, 'system')
    assert.equal(messages[0].content, AI_SYSTEM_PROMPT)
    assert.equal(messages[1].role, 'system')
    assert.match(messages[1].content, /DONNÉES CRM/)
    assert.equal(messages[2].content, 'Bonjour')
    assert.equal(messages[3].role, 'assistant')
    assert.equal(messages[4].role, 'user')
    assert.equal(messages[4].content, 'Comment vont les ventes ?')
  })

  it('fonctionne sans historique et limite la question', () => {
    const messages = buildAssistantMessages({ question: 'q'.repeat(5000), snapshotText: 's' })
    assert.equal(messages.length, 3)
    assert.equal(messages[2].content.length, 2000)
  })

  it('expose des questions suggérées non vides', () => {
    assert.ok(SUGGESTED_QUESTIONS.length >= 3)
    assert.ok(SUGGESTED_QUESTIONS.every(q => q.trim().length > 0))
    assert.equal(MAX_HISTORY_MESSAGES, 8)
  })
})
