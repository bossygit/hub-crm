import type { BatchPick } from '@/lib/stock/traceability'
import { isLotUsable } from '../quality/release.ts'

export type ProductionStockEffect = 'complete' | 'reverse' | 'none'

export function productionStockEffect(fromStatus: string, toStatus: string): ProductionStockEffect {
  if ((fromStatus === 'draft' || fromStatus === 'pending') && toStatus === 'approved') return 'complete'
  if (fromStatus === 'approved' && toStatus === 'cancelled') return 'reverse'
  return 'none'
}

export function scaleIngredientQty(recipeQty: number, recipeOutputQty: number, produceQty: number): number {
  const output = Number(recipeOutputQty) || 0
  if (output <= 0) return 0
  return Number(recipeQty) * (Number(produceQty) / output)
}

export type FefoAllocation = { batch_id: string; quantity: number }

export function allocateFefo(
  batches: BatchPick[],
  productId: string,
  needed: number,
): { allocations: FefoAllocation[]; shortfall: number } {
  const usable = batches
    .filter(b => b.product_id === productId && isLotUsable(b))
    .sort((a, b) => {
      if (!a.expiry_date && !b.expiry_date) return 0
      if (!a.expiry_date) return 1
      if (!b.expiry_date) return -1
      return a.expiry_date.localeCompare(b.expiry_date)
    })

  let remaining = Number(needed) || 0
  const allocations: FefoAllocation[] = []
  for (const batch of usable) {
    if (remaining <= 0) break
    const take = Math.min(Number(batch.quantity), remaining)
    if (take > 0) {
      allocations.push({ batch_id: batch.id, quantity: take })
      remaining -= take
    }
  }
  return { allocations, shortfall: Math.max(0, remaining) }
}

export type RecipeIngredient = {
  product_id: string
  name: string
  quantity: number
  unit: string
}

export type ConsumptionLine = {
  product_id: string
  name: string
  unit: string
  quantity: number
  batch_id: string | null
}

export function explodeRecipe(
  ingredients: RecipeIngredient[],
  recipeOutputQty: number,
  produceQty: number,
  batches: BatchPick[],
): { lines: ConsumptionLine[]; shortfalls: { product_id: string; needed: number; missing: number }[] } {
  const lines: ConsumptionLine[] = []
  const shortfalls: { product_id: string; needed: number; missing: number }[] = []

  for (const ingredient of ingredients) {
    const needed = scaleIngredientQty(ingredient.quantity, recipeOutputQty, produceQty)
    if (needed <= 0) continue
    const { allocations, shortfall } = allocateFefo(batches, ingredient.product_id, needed)
    for (const alloc of allocations) {
      lines.push({
        product_id: ingredient.product_id,
        name: ingredient.name,
        unit: ingredient.unit,
        quantity: alloc.quantity,
        batch_id: alloc.batch_id,
      })
    }
    if (shortfall > 0) {
      shortfalls.push({ product_id: ingredient.product_id, needed, missing: shortfall })
      if (allocations.length === 0) {
        lines.push({
          product_id: ingredient.product_id,
          name: ingredient.name,
          unit: ingredient.unit,
          quantity: needed,
          batch_id: null,
        })
      }
    }
  }

  return { lines, shortfalls }
}

export function suggestProductionBatchNumber(orderNumber: string): string {
  return orderNumber
}
