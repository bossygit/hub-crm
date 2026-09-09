-- =====================================================
-- FIX: Demandes externes — renvoi du fichier au demandeur
--
-- Comble l'écart d'audit "Pas de renvoi de fichier au
-- demandeur" : une demande approuvée peut être clôturée
-- avec un fichier de réponse (document_url) puis envoyée
-- par email au demandeur avec un lien de téléchargement.
--
-- Ajoute :
--   * document_requests.responded_at      → date de réponse (approuvée/rejetée)
--   * document_requests.response_file_name → nom original du fichier remis
--   * document_requests.email_sent_at      → date d'envoi de l'email (liens)
--   * Bucket PUBLIC 'request-responses'    → les liens fonctionnent sans session
--   * Policies storage.objects (insert/update) → upload authentifié côté tableau
--   * Policy DELETE document_requests      → suppression des demandes non traitées
--
-- Idempotent — peut être rejoué sans risque.
-- À exécuter dans Supabase SQL Editor (Dashboard → SQL)
-- =====================================================

ALTER TABLE public.document_requests
  ADD COLUMN IF NOT EXISTS responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_file_name text,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS handled_by uuid REFERENCES public.profiles(id);

-- Index de tri/filtre de la boîte de réception (pending → rejected,
-- plus récentes d'abord) et du filtre par statut côté UI.
CREATE INDEX IF NOT EXISTS idx_document_requests_status
  ON public.document_requests (status, created_at DESC);

-- ── Bucket 'request-responses' (PUBLIC — volontaire) ─────────────────
-- public = true est un choix délibéré : le lien de téléchargement est
-- envoyé par email à un tiers (DGI, assurance, banque, partenaire…) qui
-- ne possède AUCUNE session. Un bucket privé imposerait une URL signée
-- à durée limitée + un écran de téléchargement authentifié. Le lien
-- public direct est le plus simple et le plus fiable pour ce cas
-- d'usage. Les noms d'objets contiennent un horodatage + nom assaini :
-- ils ne sont pas devinables et ne sont exposés qu'aux destinataires
-- explicites des emails.
INSERT INTO storage.buckets (id, name, public)
VALUES ('request-responses', 'request-responses', true)
ON CONFLICT (id) DO NOTHING;

-- Aucune policy SELECT n'est requise : la lecture d'un bucket public
-- passe par l'URL publique /storage/v1/object/public/... sans RLS.
-- Seules les ÉCRITURES (upload depuis le tableau de bord, session
-- authentifiée) ont besoin de policies.
DROP POLICY IF EXISTS "request_responses_storage_insert" ON storage.objects;
CREATE POLICY "request_responses_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'request-responses');

DROP POLICY IF EXISTS "request_responses_storage_update" ON storage.objects;
CREATE POLICY "request_responses_storage_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'request-responses')
  WITH CHECK (bucket_id = 'request-responses');

-- ── DELETE document_requests ─────────────────────────────────────────
-- setup.sql ne définit que INSERT/SELECT/UPDATE sur cette table.
-- L'UI ne propose la suppression que pour les demandes en attente ou en
-- cours de traitement (pending/processing) ; cette policy DELETE permet
-- cette suppression à tout utilisateur authentifié (le garde-fou métier
-- « jamais de suppression d'une demande traitée » est appliqué côté UI).
DROP POLICY IF EXISTS "doc_req_delete" ON public.document_requests;
CREATE POLICY "doc_req_delete" ON public.document_requests
  FOR DELETE USING (auth.role() = 'authenticated');
