import { NextRequest, NextResponse } from 'next/server'
import { authorizeRoles } from '@/lib/auth/serverGuard'
import {
  buildChatRequest,
  describeProviderError,
  parseChatCompletion,
  resolveAiProvider,
} from '@/lib/ai/provider'
import { buildBusinessSnapshot, snapshotToPrompt } from '@/lib/ai/context'
import { buildAssistantMessages } from '@/lib/ai/assistant'

// AI CEO Assistant — réponse en langage naturel sur l'état de l'activité.
//
// POST { question: string, history?: { role, content }[] }
//
// Réservé à la direction (ceo/admin) et JAMAIS déclenchable par un cron
// (l'appel au LLM est facturé). Le modèle ne reçoit que des agrégats calculés
// côté serveur — aucune donnée brute, aucune écriture en base.

export const maxDuration = 60

const ALLOWED_ROLES = ['ceo', 'admin']
const MAX_QUESTION_LENGTH = 2000

export async function POST(req: NextRequest) {
  try {
    const auth = await authorizeRoles(req, ALLOWED_ROLES, { allowCron: false })
    if ('error' in auth) return auth.error
    const { client } = auth

    let body: { question?: unknown; history?: unknown } = {}
    try { body = await req.json() } catch { /* corps vide accepté */ }

    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question) {
      return NextResponse.json({ error: 'Posez une question.' }, { status: 400 })
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json({ error: 'Question trop longue.' }, { status: 400 })
    }

    const provider = resolveAiProvider()
    if (!provider) {
      return NextResponse.json(
        { error: 'Assistant non configuré : définissez OLLAMA_API_KEY (ou DEEPSEEK_API_KEY) dans les variables d’environnement.' },
        { status: 503 },
      )
    }

    const [invoicesRes, paymentsRes, productsRes, clientsRes, purchasesRes, ordersRes] = await Promise.all([
      client.from('invoices').select('id, invoice_number, client_id, due_date, date, status, total'),
      client.from('invoice_payments').select('invoice_id, amount'),
      client.from('products').select('id, name, quantity, unit, threshold_alert, price_per_unit, category'),
      client.from('clients').select('id, name, segment'),
      client.from('purchases').select('id, status, subtotal, date'),
      client.from('portal_orders').select('id, status, total_amount, created_at'),
    ])

    const firstError = invoicesRes.error || paymentsRes.error || productsRes.error || clientsRes.error
    if (firstError) {
      return NextResponse.json({ error: firstError.message }, { status: 500 })
    }

    const snapshot = buildBusinessSnapshot({
      invoices: (invoicesRes.data || []) as never[],
      payments: (paymentsRes.data || []) as never[],
      products: (productsRes.data || []) as never[],
      clients: (clientsRes.data || []) as never[],
      purchases: (purchasesRes.error ? [] : purchasesRes.data || []) as never[],
      portalOrders: (ordersRes.error ? [] : ordersRes.data || []) as never[],
    })

    const messages = buildAssistantMessages({
      question,
      snapshotText: snapshotToPrompt(snapshot),
      history: body.history,
    })

    const request = buildChatRequest({ provider, messages, temperature: 0.2, maxTokens: 900 })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55_000)

    let response: Response
    try {
      response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      })
    } catch (e) {
      clearTimeout(timeout)
      const aborted = e instanceof Error && e.name === 'AbortError'
      return NextResponse.json(
        { error: aborted ? 'Le modèle a mis trop de temps à répondre.' : 'Fournisseur LLM injoignable.' },
        { status: 504 },
      )
    }
    clearTimeout(timeout)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return NextResponse.json({ error: describeProviderError(response.status, text) }, { status: 502 })
    }

    const json = await response.json().catch(() => null)
    let parsed: { text: string; usage: Record<string, number | undefined> }
    try {
      parsed = parseChatCompletion(json)
    } catch {
      return NextResponse.json({ error: 'Réponse inexploitable du modèle.' }, { status: 502 })
    }

    return NextResponse.json({
      ok: true,
      answer: parsed.text,
      provider: { id: provider.id, label: provider.label, model: provider.model },
      usage: parsed.usage,
      generatedAt: snapshot.generatedAt,
      context: {
        monthTtc: snapshot.revenue.monthTtc,
        yearTtc: snapshot.revenue.yearTtc,
        overdueCount: snapshot.receivables.overdueCount,
        lowStockCount: snapshot.stock.lowCount,
      },
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erreur serveur' }, { status: 500 })
  }
}
