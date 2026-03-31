export type UserRole = 'ceo' | 'manager' | 'admin' | 'employee' | 'client'
export type ClientType = 'client' | 'fournisseur' | 'institution'
export type DocumentType = 'facture' | 'bon_de_livraison' | 'attestation' | 'contrat' | 'document_rh' | 'document_administratif' | 'autre'
export type DocumentStatus = 'draft' | 'pending' | 'approved' | 'rejected'
export type SaleStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled'
export type EmployeeStatus = 'actif' | 'conge' | 'suspendu' | 'sorti'

export interface Profile {
  id: string; full_name?: string; role: UserRole; department?: string; phone?: string; created_at: string
}
export interface Client {
  id: string; name: string; type: ClientType; email?: string; phone?: string; address?: string; tax_id?: string; notes?: string; created_at: string; updated_at?: string
}
export interface Product {
  id: string; name: string; category: string; quantity: number; unit: string; threshold_alert: number; price_per_unit?: number; description?: string; created_at: string
}
export interface ProductBatch {
  id: string; product_id: string; product?: Product; batch_number: string; quantity: number; expiry_date?: string; production_date?: string; supplier?: string; cost_per_unit?: number; notes?: string; created_at: string
}
export interface StockMovement {
  id: string; product_id: string; product?: Product; batch_id?: string; batch?: ProductBatch; type: 'IN' | 'OUT' | 'ADJUST'; quantity: number; reason?: string; reference_type?: string; date: string; created_at: string
}
export interface SaleItem {
  id: string; sale_id: string; product_id?: string; product?: Product; batch_id?: string; description: string; quantity: number; unit_price: number; subtotal: number
}
export interface Sale {
  id: string; reference: string; client_id?: string; client?: Client; status: SaleStatus; total_amount: number; tax_rate: number; tax_amount: number; discount: number; notes?: string; due_date?: string; approved_by?: string; approved_at?: string; created_by?: string; created_at: string; updated_at?: string; items?: SaleItem[]
}
export interface Document {
  id: string; reference: string; title: string; type: DocumentType; status: DocumentStatus; client_id?: string; client?: Client; sale_id?: string; employee_id?: string; content?: Record<string, unknown>; file_url?: string; rejection_reason?: string; created_by?: string; approved_by?: string; approved_at?: string; created_at: string
}
export interface Employee {
  id: string; user_id?: string; employee_number?: string; full_name: string; position: string; department: string; email?: string; phone?: string; hire_date: string; contract_type: 'cdi' | 'cdd' | 'stage' | 'freelance'; salary?: number; status: EmployeeStatus; address?: string; notes?: string; created_at: string
}
export interface EmployeeDocument {
  id: string; employee_id: string; employee?: Employee; type: string; title: string; file_url?: string; document_id?: string; issued_date: string; created_at: string
}
export interface Job {
  id: string; title: string; department: string; description: string; requirements?: string; location: string; type: 'cdi' | 'cdd' | 'stage' | 'freelance'; status: 'open' | 'closed' | 'archived'; deadline?: string; created_at: string
}
export interface Candidate {
  id: string; job_id: string; job?: Job; name: string; email: string; phone?: string; cv_url?: string; cover_letter?: string; status: 'nouveau' | 'en_cours' | 'entretien' | 'accepte' | 'refuse'; notes?: string; created_at: string
}
export interface DocumentRequest {
  id: string; requester_name: string; organization: string; email: string; phone?: string; document_type: string; description?: string; status: 'pending' | 'processing' | 'approved' | 'rejected'; response_notes?: string; document_url?: string; created_at: string; updated_at?: string
}
