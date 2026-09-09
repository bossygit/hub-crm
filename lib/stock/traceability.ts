import { isLotUsable } from '../quality/release.ts'

export type BatchPick = {
  id: string
  product_id: string
  quantity: number
  expiry_date?: string | null
  quality_status?: string | null
}

const SKIP_STATUSES = new Set(['draft', 'cancelled', 'rejected'])

export function suggestFefoBatch(batches: BatchPick[], productId: string): string | null {
  const usable = batches
    .filter(b => b.product_id === productId && isLotUsable(b))
    .sort((a, b) => {
      if (!a.expiry_date && !b.expiry_date) return 0
      if (!a.expiry_date) return 1
      if (!b.expiry_date) return -1
      return a.expiry_date.localeCompare(b.expiry_date)
    })
  return usable[0]?.id ?? null
}

export type LotMeta = {
  batch_id: string
  batch_number: string
  product_name: string
  expiry_date?: string | null
  production_date?: string | null
}

export type LotDispatch = {
  source: 'invoice' | 'delivery_note'
  document_id: string
  document_number: string
  date: string
  status: string
  client_id: string | null
  client_name: string | null
  quantity: number
}

export type LotRecallClient = {
  client_id: string | null
  client_name: string
  quantity: number
  documents: LotDispatch[]
}

export type LotRecall = LotMeta & {
  totalQuantity: number
  clientCount: number
  clients: LotRecallClient[]
}

export function buildLotRecall(meta: LotMeta, dispatches: LotDispatch[]): LotRecall {
  const shipped = dispatches.filter(d => !SKIP_STATUSES.has(d.status))
  const byClient = new Map<string, LotRecallClient>()

  for (const row of shipped) {
    const key = row.client_id || row.client_name || 'inconnu'
    const current = byClient.get(key) ?? {
      client_id: row.client_id,
      client_name: row.client_name || 'Client inconnu',
      quantity: 0,
      documents: [],
    }
    current.quantity += Number(row.quantity) || 0
    current.documents.push(row)
    byClient.set(key, current)
  }

  const clients = Array.from(byClient.values()).sort((a, b) => b.quantity - a.quantity)
  return {
    ...meta,
    totalQuantity: clients.reduce((sum, c) => sum + c.quantity, 0),
    clientCount: clients.length,
    clients,
  }
}
