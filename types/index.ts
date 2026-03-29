export type UserRole = 'admin' | 'employee' | 'partner'

export type ClientType = 'client' | 'fournisseur' | 'institution'

export interface Client {
  id: string
  name: string
  type: ClientType
  email?: string
  phone?: string
  address?: string
  notes?: string
  created_at: string
  updated_at?: string
}

export interface Product {
  id: string
  name: string
  category: string
  quantity: number
  unit: string
  threshold_alert: number
  price_per_unit?: number
  description?: string
  created_at: string
}

export type MovementType = 'IN' | 'OUT'

export interface StockMovement {
  id: string
  product_id: string
  product?: Product
  type: MovementType
  quantity: number
  reason?: string
  user_id?: string
  date: string
  created_at: string
}

export type DocumentType =
  | 'facture'
  | 'bon_de_livraison'
  | 'attestation'
  | 'contrat'
  | 'document_administratif'
  | 'autre'

export type DocumentStatus = 'draft' | 'generated' | 'sent'

export interface Document {
  id: string
  title: string
  type: DocumentType
  client_id?: string
  client?: Client
  file_url?: string
  status: DocumentStatus
  created_by: string
  metadata?: Record<string, unknown>
  created_at: string
}

export type JobStatus = 'open' | 'closed' | 'archived'

export interface Job {
  id: string
  title: string
  department: string
  description: string
  requirements?: string
  location: string
  type: 'cdi' | 'cdd' | 'stage' | 'freelance'
  status: JobStatus
  deadline?: string
  created_at: string
}

export type CandidateStatus =
  | 'nouveau'
  | 'en_cours'
  | 'entretien'
  | 'accepte'
  | 'refuse'

export interface Candidate {
  id: string
  job_id: string
  job?: Job
  name: string
  email: string
  phone?: string
  cv_url?: string
  cover_letter?: string
  status: CandidateStatus
  notes?: string
  created_at: string
}

export type RequestStatus = 'pending' | 'processing' | 'approved' | 'rejected'

export interface DocumentRequest {
  id: string
  requester_name: string
  organization: string
  email: string
  phone?: string
  document_type: string
  description?: string
  status: RequestStatus
  response_notes?: string
  document_url?: string
  created_at: string
  updated_at?: string
}

export interface DashboardStats {
  totalClients: number
  totalProducts: number
  lowStockProducts: number
  totalDocuments: number
  openJobs: number
  pendingRequests: number
  recentMovements: StockMovement[]
  recentRequests: DocumentRequest[]
}
