-- Audit qualité (9/10) : COA laboratoire (certificat d'analyse) + CCP (points critiques HACCP).
-- Idempotent : exécutable plusieurs fois sur une base déjà déployée.
-- Ne remplace rien de fix-quality-haccp.sql : quarantaine / libération / rejet conservés.

-- ── Numérotation des COA : COA-YYYY-XXXX ──────────────────────────────
CREATE OR REPLACE FUNCTION generate_coa_number()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  current_year text;
  count_this_year integer;
BEGIN
  current_year := to_char(now(), 'YYYY');
  SELECT count(*) INTO count_this_year
  FROM quality_coa
  WHERE coa_number LIKE 'COA-' || current_year || '-%';
  RETURN 'COA-' || current_year || '-' || lpad((count_this_year + 1)::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION generate_coa_number() TO authenticated;

-- ── Table COA laboratoire ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quality_coa (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  coa_number text UNIQUE NOT NULL DEFAULT generate_coa_number(),
  batch_id uuid NOT NULL REFERENCES product_batches(id) ON DELETE CASCADE,
  product_name text,
  report_date date NOT NULL DEFAULT current_date,
  laboratory text,
  parameters jsonb NOT NULL DEFAULT '[]'::jsonb,
  conclusion text,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT quality_coa_conclusion_check CHECK (conclusion IS NULL OR conclusion IN ('conforme', 'non_conforme'))
);

-- PDF archivé dans le bucket privé "quality-coa" (chemin : quality-coa/<batch_id>/<coa>.pdf)
ALTER TABLE quality_coa ADD COLUMN IF NOT EXISTS file_url text;

ALTER TABLE quality_coa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quality_coa_select ON quality_coa;
CREATE POLICY "quality_coa_select" ON quality_coa
  FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS quality_coa_insert ON quality_coa;
CREATE POLICY "quality_coa_insert" ON quality_coa
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS quality_coa_update ON quality_coa;
CREATE POLICY "quality_coa_update" ON quality_coa
  FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_quality_coa_batch ON quality_coa(batch_id);
CREATE INDEX IF NOT EXISTS idx_quality_coa_created ON quality_coa(created_at DESC);

-- ── Numérotation des CCP : CCP-YYYY-XXXX ──────────────────────────────
CREATE OR REPLACE FUNCTION generate_quality_ccp_number()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  current_year text;
  count_this_year integer;
BEGIN
  current_year := to_char(now(), 'YYYY');
  SELECT count(*) INTO count_this_year
  FROM quality_ccp
  WHERE check_number LIKE 'CCP-' || current_year || '-%';
  RETURN 'CCP-' || current_year || '-' || lpad((count_this_year + 1)::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION generate_quality_ccp_number() TO authenticated;

-- ── Table CCP (points critiques HACCP) ────────────────────────────────
CREATE TABLE IF NOT EXISTS quality_ccp (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  check_number text UNIQUE NOT NULL DEFAULT generate_quality_ccp_number(),
  batch_id uuid REFERENCES product_batches(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('reception', 'production', 'stock', 'autre')),
  ccp_name text NOT NULL,
  requirement text NOT NULL,
  measured_value text,
  conform boolean NOT NULL,
  checked_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE quality_ccp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quality_ccp_select ON quality_ccp;
CREATE POLICY "quality_ccp_select" ON quality_ccp
  FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS quality_ccp_insert ON quality_ccp;
CREATE POLICY "quality_ccp_insert" ON quality_ccp
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS quality_ccp_update ON quality_ccp;
CREATE POLICY "quality_ccp_update" ON quality_ccp
  FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_quality_ccp_batch ON quality_ccp(batch_id);
CREATE INDEX IF NOT EXISTS idx_quality_ccp_created ON quality_ccp(created_at DESC);

-- ── Bucket privé "quality-coa" (PDF des certificats) ──────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('quality-coa', 'quality-coa', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "quality_coa_storage_select" ON storage.objects;
CREATE POLICY "quality_coa_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'quality-coa');

DROP POLICY IF EXISTS "quality_coa_storage_insert" ON storage.objects;
CREATE POLICY "quality_coa_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quality-coa');

DROP POLICY IF EXISTS "quality_coa_storage_update" ON storage.objects;
CREATE POLICY "quality_coa_storage_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'quality-coa')
  WITH CHECK (bucket_id = 'quality-coa');
