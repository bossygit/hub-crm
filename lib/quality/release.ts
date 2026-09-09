export type QualityStatus = 'pending' | 'released' | 'rejected'
export type QualityDecisionEffect = 'release' | 'scrap' | 'none'

export function isLotReleased(status?: string | null): boolean {
  return !status || status === 'released'
}

export function isLotUsable(batch: { quantity: number; quality_status?: string | null }): boolean {
  return Number(batch.quantity) > 0 && isLotReleased(batch.quality_status)
}

export function qualityDecisionEffect(fromStatus: string, result: string): QualityDecisionEffect {
  if (fromStatus !== 'pending') return 'none'
  if (result === 'released') return 'release'
  if (result === 'rejected') return 'scrap'
  return 'none'
}

export function newBatchQualityStatus(): QualityStatus {
  return 'pending'
}

export const QUALITY_LABELS: Record<string, { label: string; badge: string; icon: string }> = {
  pending: { label: 'Quarantaine', badge: 'badge-amber', icon: '⏳' },
  released: { label: 'Libéré', badge: 'badge-green', icon: '✅' },
  rejected: { label: 'Rebut', badge: 'badge-red', icon: '❌' },
}
