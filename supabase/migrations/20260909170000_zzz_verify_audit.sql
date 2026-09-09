-- Vérification finale audit septembre 2026 (idempotent, conservé comme trace)
DO $$
DECLARE
  nb int := 0;
BEGIN
  -- Tables créées par l'audit
  SELECT count(*) INTO nb FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN
     ('warehouses','quality_coa','quality_ccp','purchase_payments','portal_orders','portal_order_items');
  RAISE NOTICE 'VERIFY tables_audit=% (attendu 6)', nb;

  -- Colonnes clés ajoutées
  SELECT count(*) INTO nb FROM information_schema.columns
   WHERE table_schema='public' AND
     ((table_name='clients' AND column_name IN ('tax_id','rccm','city','is_active','credit_limit'))
   OR (table_name='documents' AND column_name IN ('converted_at','content','updated_at','doc_category','body','object'))
   OR (table_name='product_batches' AND column_name='warehouse_id')
   OR (table_name='stock_movements' AND column_name='warehouse_id')
   OR (table_name='inventory_sessions' AND column_name IN ('blind','started_at','revealed_at'))
   OR (table_name='production_orders' AND column_name='actual_output_quantity')
   OR (table_name='employees' AND column_name='user_id')
   OR (table_name='document_requests' AND column_name IN ('responded_at','handled_by','email_sent_at'))
   OR (table_name='products' AND column_name IN ('is_catalog','catalog_unit')));
  RAISE NOTICE 'VERIFY colonnes_audit=% (attendu 24)', nb;

  -- Fonctions / déclencheurs
  SELECT count(*) INTO nb FROM pg_proc
   WHERE proname IN ('transfer_batch','convert_quote_to_invoice','gen_portal_order_number',
                     'fn_inventory_freeze_guard','generate_coa_number','generate_quality_ccp_number','gen_document_ref_doc');
  RAISE NOTICE 'VERIFY fonctions=% (attendu 7)', nb;

  SELECT count(*) INTO nb FROM pg_trigger
   WHERE tgname IN ('trg_inventory_freeze_guard','trg_inventory_session_touch','on_bl_validation','on_production_status_change');
  RAISE NOTICE 'VERIFY triggers=% (attendu 4)', nb;

  SELECT count(*) INTO nb FROM storage.buckets
   WHERE id IN ('devis-pdf','general-documents','request-responses','cvs','quality-coa');
  RAISE NOTICE 'VERIFY buckets=% (attendu 5)', nb;
END $$;
