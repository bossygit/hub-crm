-- =====================================================
-- HUB Distribution — Migration Écosystème Documents
-- Devis, Bon de Livraison, Reçu, Bons stock
-- À exécuter dans Supabase SQL Editor
-- =====================================================

-- 1. Colonnes supplémentaires sur documents
ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_number text UNIQUE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS total_amount numeric DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS discount numeric DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS tax_rate numeric DEFAULT 18;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS tax_amount numeric DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS payment_terms text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS validated_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS validated_at timestamptz;

-- 2. Étendre la contrainte type
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_type_check
  CHECK (type IN (
    'facture', 'bon_de_livraison', 'attestation', 'contrat',
    'document_rh', 'document_administratif', 'autre',
    'devis', 'bon_livraison', 'bon_entree_stock', 'bon_sortie_stock', 'recu_paiement'
  ));

-- 3. Étendre la contrainte status
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'generated', 'sent', 'converted'));

-- 4. Table document_items (lignes pour devis et BL)
CREATE TABLE IF NOT EXISTS document_items (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit text DEFAULT 'unité',
  unit_price numeric NOT NULL DEFAULT 0,
  subtotal numeric GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE document_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "document_items_all" ON document_items FOR ALL USING (auth.role() = 'authenticated');

-- 5. Fonction de numérotation par type
CREATE OR REPLACE FUNCTION generate_document_number(p_type text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  prefix text;
  current_year text;
  count_this_year integer;
BEGIN
  current_year := to_char(now(), 'YYYY');
  CASE p_type
    WHEN 'devis' THEN prefix := 'DEV';
    WHEN 'bon_livraison' THEN prefix := 'BL';
    WHEN 'recu_paiement' THEN prefix := 'REC';
    WHEN 'bon_entree_stock' THEN prefix := 'BSE';
    WHEN 'bon_sortie_stock' THEN prefix := 'BSS';
    ELSE prefix := 'DOC';
  END CASE;

  SELECT count(*) INTO count_this_year
  FROM documents
  WHERE document_number LIKE prefix || '-' || current_year || '-%';

  RETURN prefix || '-' || current_year || '-' || lpad((count_this_year + 1)::text, 4, '0');
END;
$$;

-- 6. Trigger stock pour Bon de Livraison
CREATE OR REPLACE FUNCTION process_bl_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
BEGIN
  -- BL validé : stock OUT
  IF OLD.type = 'bon_livraison' AND OLD.status != 'approved' AND NEW.status = 'approved' THEN
    FOR item IN
      SELECT di.*, p.name AS product_name, p.quantity AS stock_qty
      FROM document_items di
      JOIN products p ON p.id = di.product_id
      WHERE di.document_id = NEW.id AND di.product_id IS NOT NULL
    LOOP
      IF item.stock_qty < item.quantity THEN
        RAISE EXCEPTION 'Stock insuffisant pour "%" : disponible=%, demandé=%',
          item.product_name, item.stock_qty, item.quantity;
      END IF;
    END LOOP;

    FOR item IN
      SELECT * FROM document_items
      WHERE document_id = NEW.id AND product_id IS NOT NULL
    LOOP
      INSERT INTO stock_movements (product_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, 'OUT', item.quantity,
        'Bon de livraison ' || COALESCE(NEW.document_number, NEW.id::text),
        NEW.id, 'delivery_note', NEW.validated_by);
    END LOOP;

    NEW.validated_at := now();
  END IF;

  -- BL annulé depuis approved : stock IN (restauration)
  IF OLD.type = 'bon_livraison' AND OLD.status = 'approved' AND NEW.status = 'rejected' THEN
    FOR item IN
      SELECT * FROM document_items
      WHERE document_id = NEW.id AND product_id IS NOT NULL
    LOOP
      INSERT INTO stock_movements (product_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, 'IN', item.quantity,
        'Annulation BL ' || COALESCE(NEW.document_number, NEW.id::text),
        NEW.id, 'delivery_note_cancel', NEW.validated_by);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_bl_validation ON documents;
CREATE TRIGGER on_bl_validation
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION process_bl_validation();

-- 7. Index pour performance
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS idx_documents_invoice ON documents(invoice_id);
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_document_id);
CREATE INDEX IF NOT EXISTS idx_document_items_document ON document_items(document_id);
CREATE INDEX IF NOT EXISTS idx_document_items_product ON document_items(product_id);
