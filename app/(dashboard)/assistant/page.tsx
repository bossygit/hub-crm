'use client'
import { useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { SUGGESTED_QUESTIONS } from '@/lib/ai/assistant'

/**
 * AI CEO Assistant — conversation en langage naturel sur l'état de l'activité.
 * Le serveur agrège les données du CRM et interroge le LLM configuré
 * (Ollama Cloud aujourd'hui, DeepSeek demain) : aucune donnée brute ne part
 * du navigateur et rien n'est écrit en base.
 */

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type ProviderInfo = { id: string; label: string; model: string }

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [lastContext, setLastContext] = useState<Record<string, number> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || loading) return

    const history = messages.slice(-8)
    setMessages(prev => [...prev, { role: 'user', content: q }])
    setInput('')
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, history }),
      })
      const data = await res.json()

      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Assistant indisponible.')

      setMessages(prev => [...prev, { role: 'assistant', content: data.answer }])
      if (data.provider) setProvider(data.provider)
      if (data.context) setLastContext(data.context)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erreur inattendue.'
      setError(message)
      toast('error', message)
    } finally {
      setLoading(false)
    }
  }

  const fcfa = (n?: number) => `${(Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`

  return (
    <div>
      <div className="page-header">
        <h2>🤖 Assistant de direction</h2>
        <span className="badge badge-gray" title="Fournisseur LLM actif">
          {provider ? `${provider.label} · ${provider.model}` : 'Ollama / DeepSeek — selon configuration'}
        </span>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 960 }}>
        <div style={{ background: '#f8f5ee', border: '1px solid #e8e4db', borderRadius: 12, padding: '14px 18px', marginBottom: 18, fontSize: '0.85rem', color: '#555' }}>
          Posez une question sur l’activité : ventes, impayés, stock, clients. Les réponses s’appuient
          <strong> uniquement sur les données réelles du CRM</strong> (agrégées côté serveur). L’assistant observe et conseille — il ne modifie rien.
        </div>

        {lastContext && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18, fontSize: '0.78rem' }}>
            <span className="badge badge-green">CA mois : {fcfa(lastContext.monthTtc)}</span>
            <span className="badge badge-blue">CA année : {fcfa(lastContext.yearTtc)}</span>
            <span className={`badge ${lastContext.overdueCount ? 'badge-red' : 'badge-gray'}`}>{lastContext.overdueCount} facture(s) en retard</span>
            <span className={`badge ${lastContext.lowStockCount ? 'badge-amber' : 'badge-gray'}`}>{lastContext.lowStockCount} produit(s) en alerte stock</span>
          </div>
        )}

        {/* Conversation */}
        <div style={{ background: 'white', border: '1px solid #e8e4db', borderRadius: 12, minHeight: 320, maxHeight: '52vh', overflowY: 'auto', padding: '18px 20px', marginBottom: 16 }}>
          {messages.length === 0 && !loading ? (
            <div style={{ textAlign: 'center', padding: '40px 12px', color: '#999' }}>
              <div style={{ fontSize: '2.2rem', marginBottom: 8 }}>🤖</div>
              <div style={{ fontWeight: 700, color: '#555', marginBottom: 4 }}>Que voulez-vous savoir ?</div>
              <div style={{ fontSize: '0.85rem' }}>Choisissez une question ci-dessous ou écrivez la vôtre.</div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
                <div style={{
                  maxWidth: '82%', padding: '10px 14px', borderRadius: 12, fontSize: '0.88rem', lineHeight: 1.55, whiteSpace: 'pre-wrap',
                  background: m.role === 'user' ? 'var(--hub-green)' : '#f4f2ec',
                  color: m.role === 'user' ? 'white' : '#222',
                  borderBottomRightRadius: m.role === 'user' ? 3 : 12,
                  borderBottomLeftRadius: m.role === 'user' ? 12 : 3,
                }}>
                  {m.content}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#888', fontSize: '0.85rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--hub-green)', display: 'inline-block' }} />
              L’assistant analyse les données…
            </div>
          )}
          {error && (
            <div style={{ marginTop: 8, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: '0.82rem' }}>
              ⚠️ {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Questions suggérées */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {SUGGESTED_QUESTIONS.map(q => (
            <button key={q} type="button" className="btn-ghost" disabled={loading}
              style={{ padding: '6px 12px', fontSize: '0.78rem' }} onClick={() => ask(q)}>
              {q}
            </button>
          ))}
        </div>

        {/* Saisie */}
        <form onSubmit={e => { e.preventDefault(); ask(input) }} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea className="hub-input" rows={2} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) } }}
            placeholder="Ex : comment vont les ventes cette année ?"
            style={{ flex: 1, resize: 'vertical' }} disabled={loading} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="submit" className="btn-primary" disabled={loading || !input.trim()}>
              {loading ? '…' : 'Demander'}
            </button>
            {messages.length > 0 && (
              <button type="button" className="btn-ghost" style={{ fontSize: '0.72rem' }}
                onClick={() => { setMessages([]); setError(''); setLastContext(null) }}>
                Effacer
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
