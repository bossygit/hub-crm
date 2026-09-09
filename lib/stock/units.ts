export type ProductPack = { unit: string; factor: number }

export function toBaseQty(
  quantity: number,
  unit: string | null | undefined,
  baseUnit: string,
  packs: ProductPack[],
): number {
  const qty = Number(quantity) || 0
  const from = (unit || '').trim()
  const base = (baseUnit || '').trim()
  if (!from || !base || from === base) return qty
  const pack = packs.find(p => p.unit === from && Number(p.factor) > 0)
  return pack ? qty * Number(pack.factor) : qty
}

export function toStockLine(
  quantity: number,
  unit: string,
  unitPrice: number,
  baseUnit: string,
  packs: ProductPack[],
): { quantity: number; unit: string; unit_price: number } {
  const baseQty = toBaseQty(quantity, unit, baseUnit, packs)
  const total = (Number(quantity) || 0) * (Number(unitPrice) || 0)
  return {
    quantity: baseQty,
    unit: baseUnit,
    unit_price: baseQty > 0 ? total / baseQty : Number(unitPrice) || 0,
  }
}

export function inventoryVariance(theoretical: number, counted: number): number {
  return (Number(counted) || 0) - (Number(theoretical) || 0)
}

export function stockAdjustDelta(onHand: number, delta: number): number {
  return (Number(onHand) || 0) + (Number(delta) || 0)
}

export type SnapshotProduct = { id: string; name: string; quantity: number; unit: string }
export type SnapshotBatch = {
  id: string
  product_id: string
  batch_number: string
  quantity: number
  quality_status?: string | null
}

export type InventorySnapshotLine = {
  product_id: string
  product_name: string
  unit: string
  batch_id: string | null
  batch_number: string | null
  theoretical: number
}

export function buildInventorySnapshot(
  products: SnapshotProduct[],
  batches: SnapshotBatch[],
): InventorySnapshotLine[] {
  const lines: InventorySnapshotLine[] = []
  const batchQtyByProduct = new Map<string, number>()

  for (const product of products) {
    const productBatches = batches.filter(
      b => b.product_id === product.id && b.quality_status !== 'rejected',
    )
    for (const batch of productBatches) {
      const qty = Number(batch.quantity) || 0
      lines.push({
        product_id: product.id,
        product_name: product.name,
        unit: product.unit,
        batch_id: batch.id,
        batch_number: batch.batch_number,
        theoretical: qty,
      })
      batchQtyByProduct.set(product.id, (batchQtyByProduct.get(product.id) || 0) + qty)
    }
    const leftover = (Number(product.quantity) || 0) - (batchQtyByProduct.get(product.id) || 0)
    if (leftover > 0) {
      lines.push({
        product_id: product.id,
        product_name: product.name,
        unit: product.unit,
        batch_id: null,
        batch_number: null,
        theoretical: leftover,
      })
    }
  }

  return lines
}

export function unitsForProduct(baseUnit: string, packs: ProductPack[]): string[] {
  const base = baseUnit || 'kg'
  const extras = packs.map(p => p.unit).filter(u => u && u !== base)
  return [base, ...extras]
}

export function packsForProduct(productId: string | null | undefined, rows: (ProductPack & { product_id: string })[]): ProductPack[] {
  if (!productId) return []
  return rows.filter(r => r.product_id === productId)
}

export function lineInBaseUnit<T extends { product_id?: string | null; quantity: number; unit: string; unit_price: number; description?: string }>(
  item: T,
  baseUnit: string | undefined,
  packs: ProductPack[],
): T {
  if (!baseUnit) return item
  const stock = toStockLine(item.quantity, item.unit, item.unit_price, baseUnit, packs)
  let description = item.description || ''
  if (item.unit && item.unit !== baseUnit) {
    const note = `saisi : ${item.quantity} ${item.unit}`
    if (!description.includes(note)) description = [description, note].filter(Boolean).join(' · ')
  }
  return { ...item, quantity: stock.quantity, unit: stock.unit, unit_price: stock.unit_price, description }
}
