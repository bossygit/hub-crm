/** Stock leaves on invoice validation. A BL only moves stock if it is standalone. */
export function deliveryNoteAffectsStock(invoiceId?: string | null): boolean {
  return invoiceId == null || invoiceId === ''
}
