export type PurchaseStockEffect = 'receive' | 'reverse' | 'none'

export function purchaseStockEffect(fromStatus: string, toStatus: string): PurchaseStockEffect {
  if ((fromStatus === 'draft' || fromStatus === 'pending') && toStatus === 'approved') return 'receive'
  if (fromStatus === 'approved' && toStatus === 'cancelled') return 'reverse'
  return 'none'
}

export function suggestPurchaseBatchNumber(purchaseNumber: string, sortOrder: number): string {
  return `${purchaseNumber}-L${sortOrder + 1}`
}

export function resolvePurchaseBatchNumber(
  explicit: string | null | undefined,
  purchaseNumber: string,
  sortOrder: number,
): string {
  const trimmed = explicit?.trim()
  return trimmed ? trimmed : suggestPurchaseBatchNumber(purchaseNumber, sortOrder)
}
