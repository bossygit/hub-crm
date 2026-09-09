// Multi-entrepôt : types + logique pure de transfert entre entrepôts
// et de répartition du stock par entrepôt.

export type Warehouse = {
  id: string
  name: string
  code: string
  location: string | null
  is_cold: boolean
  notes: string | null
  created_at?: string
}

/** Entrepôt tel que renvoyé par la table warehouses (champs optionnels tolérés). */
export type WarehouseInput = {
  id: string
  name: string
  code?: string | null
  location?: string | null
  is_cold?: boolean | null
  notes?: string | null
}

export type WarehouseSummary = {
  id: string
  name: string
  code: string
  location: string | null
  is_cold: boolean
  notes: string | null
  /** Nombre de lots physiquement rattachés à cet entrepôt. */
  batch_count: number
  /** Somme des quantités des lots de cet entrepôt. */
  stock_quantity: number
}

export type TransferValidation = {
  availableQty: number
  qty: number
  /** false si le lot n'est pas libéré par la qualité. */
  released?: boolean | null
}

/**
 * Valide une demande de transfert de lot entre entrepôts.
 * Retourne un message d'erreur en français, ou null si le transfert est possible.
 */
export function validateTransfer({ availableQty, qty, released }: TransferValidation): string | null {
  const available = Number(availableQty)
  const amount = Number(qty)
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'La quantité à transférer doit être strictement positive.'
  }
  if (released === false) {
    return 'Seuls les lots libérés par la qualité (released) peuvent être transférés.'
  }
  if (!Number.isFinite(available) || amount > available) {
    return `Quantité insuffisante dans le lot source (disponible : ${Number.isFinite(available) ? available : 0}).`
  }
  return null
}

/** Lot minimal exploitable pour la répartition par entrepôt. */
export type StockBatchInput = {
  id: string
  product_id: string
  batch_number: string
  quantity: number
  quality_status?: string | null
  warehouse_id?: string | null
  product?: { name?: string | null } | null
}

/** Ligne de répartition : un produit dans un entrepôt. */
export type StockByWarehouseRow = {
  product_id: string
  product_name: string
  warehouse_id: string | null
  warehouse_name: string
  quantity: number
}

/**
 * Regroupe les lots par (produit, entrepôt) et somme les quantités.
 * Les lots dont le warehouse_id est NULL sont rattachés à l'entrepôt par
 * défaut (defaultWarehouseId) quand il est fourni, sinon regroupés sous
 * « Sans entrepôt ». Les lignes à quantité nulle sont exclues.
 */
export function stockByWarehouse(
  batches: StockBatchInput[],
  warehouses: Pick<WarehouseInput, 'id' | 'name'>[],
  defaultWarehouseId?: string | null,
): StockByWarehouseRow[] {
  const nameOf = (warehouseId: string | null | undefined): { id: string | null; name: string } => {
    if (!warehouseId) {
      const fallback = defaultWarehouseId
        ? warehouses.find(w => w.id === defaultWarehouseId)
        : undefined
      if (fallback) return { id: fallback.id, name: fallback.name }
      return { id: null, name: 'Sans entrepôt' }
    }
    const found = warehouses.find(w => w.id === warehouseId)
    return { id: warehouseId, name: found?.name ?? 'Entrepôt inconnu' }
  }

  const totals = new Map<string, StockByWarehouseRow>()
  for (const batch of batches) {
    const qty = Number(batch.quantity)
    if (!Number.isFinite(qty) || qty <= 0) continue
    const wh = nameOf(batch.warehouse_id)
    const productName = batch.product?.name?.trim() || 'Produit sans nom'
    const key = `${batch.product_id}::${wh.id ?? 'null'}`
    const existing = totals.get(key)
    if (existing) {
      existing.quantity += qty
    } else {
      totals.set(key, {
        product_id: batch.product_id,
        product_name: productName,
        warehouse_id: wh.id,
        warehouse_name: wh.name,
        quantity: qty,
      })
    }
  }

  return Array.from(totals.values()).sort(
    (a, b) =>
      a.product_name.localeCompare(b.product_name, 'fr') ||
      a.warehouse_name.localeCompare(b.warehouse_name, 'fr'),
  )
}

/**
 * Agrège les lignes stockByWarehouse par entrepôt (totaux globaux,
 * « Stock par entrepôt ») — sert aux cartes récapitulatives.
 */
export function totalsByWarehouse(rows: StockByWarehouseRow[]): { warehouse_name: string; quantity: number }[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    totals.set(row.warehouse_name, (totals.get(row.warehouse_name) || 0) + row.quantity)
  }
  return Array.from(totals.entries())
    .map(([warehouse_name, quantity]) => ({ warehouse_name, quantity }))
    .sort((a, b) => a.warehouse_name.localeCompare(b.warehouse_name, 'fr'))
}

/**
 * Calcule le résumé par entrepôt (nombre de lots + stock total) à partir
 * des entrepôts et des lots bruts. Si defaultWarehouseId est fourni, les lots
 * non affectés sont comptés dans l'entrepôt par défaut.
 */
export function summarizeWarehouses(
  warehouses: WarehouseInput[],
  batches: StockBatchInput[],
  defaultWarehouseId?: string | null,
): WarehouseSummary[] {
  const effectiveId = (warehouseId?: string | null): string | null =>
    warehouseId || defaultWarehouseId || null

  return warehouses.map(wh => {
    const owned = batches.filter(b => effectiveId(b.warehouse_id) === wh.id)
    return {
      id: wh.id,
      name: wh.name,
      code: (wh.code || '').trim().toUpperCase() || '—',
      location: wh.location || null,
      is_cold: Boolean(wh.is_cold),
      notes: wh.notes || null,
      batch_count: owned.length,
      stock_quantity: owned.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0),
    }
  })
}
