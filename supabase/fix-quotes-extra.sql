-- ============================================================
-- fix-quotes-extra.sql — Durcissement module DEVIS
-- À exécuter UNE FOIS dans le SQL Editor Supabase (idempotent).
--  1. documents.converted_at (traçabilité conversion → facture)
--  2. Conversion devis→facture ATOMIQUE (anti doublon / anti course)
--  3. Types de notification élargis (approuvé / refusé / converti)
--  4. Bucket privé "devis-pdf" pour l'archivage des PDF
-- ============================================================

-- ── 1. Colonne de traçabilité conversion ─────────────────────
ALTER TABLE documents ADD COLUMN IF NOT EXISTS converted_at timestamptz;
-- Compatibilité bases existantes : certains schémas distants n'ont pas encore
-- les colonnes content / updated_at sur documents (utilisées par la conversion).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content jsonb DEFAULT '{}';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ── 2. Types de notification devis ───────────────────────────
-- Supprime TOUTES les contraintes CHECK existantes portant sur notifications.type
-- (quel que soit leur nom auto-généré), puis recrée avec les nouveaux types.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'invoice_pending', 'bl_pending', 'leave_pending', 'quote_pending',
    'quote_approved', 'quote_rejected', 'quote_converted'
  ));

-- ── 3. Conversion atomique devis accepté → facture ───────────
-- Sécurisée par un verrou FOR UPDATE sur le devis : deux clics simultanés
-- (ou deux onglets) ne peuvent PAS créer deux factures pour un même devis.
-- Toutes les écritures (facture + lignes + statut converti) sont dans une
-- seule transaction : succès = tout, échec = rien.
CREATE OR REPLACE FUNCTION convert_quote_to_invoice(p_quote_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote documents%ROWTYPE;
  v_invoice_id uuid;
  v_invoice_number text;
  v_subtotal numeric;
  v_has_items boolean;
BEGIN
  SELECT * INTO v_quote
  FROM documents
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devis introuvable.';
  END IF;

  IF v_quote.type <> 'devis' THEN
    RAISE EXCEPTION 'Ce document n''est pas un devis.';
  END IF;

  -- Déjà converti : idempotence — on renvoie la facture existante sans doublon.
  IF v_quote.status = 'converted' AND v_quote.invoice_id IS NOT NULL THEN
    RETURN v_quote.invoice_id;
  END IF;

  -- Réparation auto d'une conversion partielle ancienne (facture sans statut converti)
  IF v_quote.invoice_id IS NOT NULL THEN
    UPDATE documents
      SET status = 'converted', converted_at = now(), updated_at = now()
    WHERE id = p_quote_id;
    RETURN v_quote.invoice_id;
  END IF;

  IF v_quote.status <> 'approved' THEN
    RAISE EXCEPTION 'Seuls les devis acceptés peuvent être convertis en facture (statut actuel : %).', v_quote.status;
  END IF;

  IF v_quote.client_id IS NULL THEN
    RAISE EXCEPTION 'Impossible de convertir : aucun client associé à ce devis.';
  END IF;

  SELECT EXISTS (SELECT 1 FROM document_items WHERE document_id = p_quote_id)
  INTO v_has_items;
  IF NOT v_has_items THEN
    RAISE EXCEPTION 'Impossible de convertir : le devis ne contient aucune ligne.';
  END IF;

  v_invoice_number := generate_invoice_number();
  -- Sous-total HT reconstruit à partir des montants stockés du devis
  v_subtotal := COALESCE(v_quote.total_amount, 0) - COALESCE(v_quote.tax_amount, 0) + COALESCE(v_quote.discount, 0);

  INSERT INTO invoices (
    invoice_number, client_id, date, due_date, status,
    subtotal, discount, tax_rate, tax_amount, total,
    notes, payment_terms, created_by, updated_at
  ) VALUES (
    v_invoice_number, v_quote.client_id, current_date, v_quote.due_date, 'pending',
    v_subtotal,
    COALESCE(v_quote.discount, 0),
    COALESCE(v_quote.tax_rate, 18),
    COALESCE(v_quote.tax_amount, 0),
    COALESCE(v_quote.total_amount, 0),
    v_quote.content->>'notes',
    COALESCE(v_quote.payment_terms, '30 jours'),
    COALESCE(auth.uid(), v_quote.created_by),
    now()
  )
  RETURNING id INTO v_invoice_id;

  -- Lignes du devis copiées telles quelles (produit, lot FEFO, prix, unité de base)
  INSERT INTO invoice_items (
    invoice_id, product_id, batch_id, name, description,
    quantity, unit, unit_price, tax_rate, sort_order
  )
  SELECT
    v_invoice_id, product_id, batch_id, name, description,
    quantity, unit, unit_price, COALESCE(v_quote.tax_rate, 18), sort_order
  FROM document_items
  WHERE document_id = p_quote_id
  ORDER BY sort_order;

  UPDATE documents
    SET status = 'converted',
        invoice_id = v_invoice_id,
        converted_at = now(),
        updated_at = now()
  WHERE id = p_quote_id;

  RETURN v_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION convert_quote_to_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION convert_quote_to_invoice(uuid) TO authenticated;

-- ── 4. Bucket privé "devis-pdf" (archivage des PDF de devis) ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('devis-pdf', 'devis-pdf', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "devis_pdf_storage_select" ON storage.objects;
CREATE POLICY "devis_pdf_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'devis-pdf');

DROP POLICY IF EXISTS "devis_pdf_storage_insert" ON storage.objects;
CREATE POLICY "devis_pdf_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'devis-pdf');

DROP POLICY IF EXISTS "devis_pdf_storage_update" ON storage.objects;
CREATE POLICY "devis_pdf_storage_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'devis-pdf')
  WITH CHECK (bucket_id = 'devis-pdf');
