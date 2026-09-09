-- ============================================================
-- fix-documents-register.sql — Module DOCUMENTS GÉNÉRAUX (9/10)
-- Registre complet + PDF réels (jsPDF) + catégories + cycle de vie
-- (envoyé / archivé) + archive PDF par document dans un bucket privé.
-- À exécuter UNE FOIS dans le SQL Editor Supabase (idempotent).
--
--  1. Colonnes du registre (body, object, doc_date, doc_category,
--     entity_type/entity_id, signed_by, generated_at, archived_at)
--  2. Contraintes CHECK idempotentes (entity_type, doc_category)
--  3. Référence DOC-YYYY-XXXX via séquence dédiée + RPC gen_document_ref_doc()
--     (les documents généraux fixent reference explicitement côté UI ;
--      on ne touche PAS à la sémantique de documents.reference pour les
--      types existants devis/BL/etc.)
--  4. Index registre + bucket privé "general-documents" (PDF archivés)
--
-- NOTE : documents.type garde son CHECK historique. Les nouvelles catégories
-- (lettre, note_de_service, proces_verbal, rapport, convention…) étant plus
-- larges que le CHECK, elles sont stockées dans documents.doc_category et
-- documents.type reçoit une valeur autorisée par le CHECK existant
-- ('document_administratif' | 'autre').
-- ============================================================

-- ── 1. Colonnes du registre des documents généraux ───────────
ALTER TABLE documents ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS object text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_date date;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_category text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS signed_by text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS generated_at timestamptz;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- ── 2. Contraintes CHECK idempotentes ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_entity_type_check'
      AND conrelid = 'documents'::regclass
  ) THEN
    ALTER TABLE documents ADD CONSTRAINT documents_entity_type_check
      CHECK (entity_type IS NULL OR entity_type IN ('client', 'employee', 'none'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_doc_category_check'
      AND conrelid = 'documents'::regclass
  ) THEN
    ALTER TABLE documents ADD CONSTRAINT documents_doc_category_check
      CHECK (doc_category IS NULL OR doc_category IN (
        'lettre', 'note_de_service', 'proces_verbal', 'rapport',
        'convention', 'document_administratif', 'autre'
      ));
  END IF;
END;
$$;

-- ── 3. Référence DOC-YYYY-XXXX (séquence dédiée) ─────────────
-- Séquence indépendante : ne change PAS generate_document_number()
-- utilisé par devis / BL / etc. et ne touche pas au DEFAULT de
-- documents.reference (qui reste le fallback aléatoire historique).
CREATE SEQUENCE IF NOT EXISTS general_document_seq START 1;

CREATE OR REPLACE FUNCTION public.gen_document_ref_doc()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n bigint;
BEGIN
  n := nextval('general_document_seq');
  RETURN 'DOC-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.gen_document_ref_doc() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gen_document_ref_doc() TO authenticated;

-- ── 4. Index registre + bucket privé "general-documents" ─────
CREATE INDEX IF NOT EXISTS idx_documents_doc_category
  ON documents (doc_category, doc_date DESC);

INSERT INTO storage.buckets (id, name, public)
VALUES ('general-documents', 'general-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "general_documents_storage_select" ON storage.objects;
CREATE POLICY "general_documents_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'general-documents');

DROP POLICY IF EXISTS "general_documents_storage_insert" ON storage.objects;
CREATE POLICY "general_documents_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'general-documents');

DROP POLICY IF EXISTS "general_documents_storage_update" ON storage.objects;
CREATE POLICY "general_documents_storage_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'general-documents')
  WITH CHECK (bucket_id = 'general-documents');

-- Suppression : permet le nettoyage des PDF des brouillons supprimés.
DROP POLICY IF EXISTS "general_documents_storage_delete" ON storage.objects;
CREATE POLICY "general_documents_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'general-documents');
