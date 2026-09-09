-- Traçabilité lots : batch_id sur lignes facture/BL + sortie stock par lot.
-- À exécuter dans le SQL Editor Supabase sur une base déjà déployée.
--
-- Les bases installées avec le schéma v2 n'ont que product_lots (pas product_batches).
-- On crée la table attendue par l'app, on recopie les lots existants, puis on
-- ajoute batch_id sur les lignes commerciales.

CREATE TABLE IF NOT EXISTS product_batches (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  batch_number text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  expiry_date date,
  production_date date,
  supplier text,
  cost_per_unit numeric DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE product_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS batches_all ON product_batches;
CREATE POLICY "batches_all" ON product_batches FOR ALL USING (auth.role() = 'authenticated');

INSERT INTO product_batches (id, product_id, batch_number, quantity, expiry_date, production_date, notes, created_at)
SELECT id, product_id, lot_number, COALESCE(quantity, 0), expiry_date, production_date, notes, created_at
FROM product_lots
WHERE NOT EXISTS (SELECT 1 FROM product_batches b WHERE b.id = product_lots.id);

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES product_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_id uuid,
  ADD COLUMN IF NOT EXISTS reference_type text;

UPDATE stock_movements
SET batch_id = lot_id
WHERE batch_id IS NULL AND lot_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM product_batches b WHERE b.id = stock_movements.lot_id);

CREATE OR REPLACE FUNCTION update_product_quantity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'IN' THEN
    UPDATE products SET quantity = quantity + NEW.quantity WHERE id = NEW.product_id;
    IF NEW.batch_id IS NOT NULL THEN
      UPDATE product_batches SET quantity = quantity + NEW.quantity WHERE id = NEW.batch_id;
    END IF;
  ELSIF NEW.type = 'OUT' THEN
    UPDATE products SET quantity = quantity - NEW.quantity WHERE id = NEW.product_id;
    IF NEW.batch_id IS NOT NULL THEN
      UPDATE product_batches SET quantity = quantity - NEW.quantity WHERE id = NEW.batch_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES product_batches(id) ON DELETE SET NULL;

ALTER TABLE document_items
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES product_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_items_batch ON invoice_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_document_items_batch ON document_items(batch_id);

CREATE OR REPLACE FUNCTION process_invoice_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
BEGIN
  IF OLD.status IN ('draft', 'pending') AND NEW.status = 'approved' THEN
    FOR item IN
      SELECT ii.*, p.name AS product_name, p.quantity AS stock_qty,
             pb.quantity AS batch_qty, pb.batch_number
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
      LEFT JOIN product_batches pb ON pb.id = ii.batch_id
      WHERE ii.invoice_id = NEW.id AND ii.product_id IS NOT NULL
    LOOP
      IF item.stock_qty < item.quantity THEN
        RAISE EXCEPTION 'Stock insuffisant pour "%" : disponible=%, demandé=%',
          item.product_name, item.stock_qty, item.quantity;
      END IF;
      IF item.batch_id IS NOT NULL AND COALESCE(item.batch_qty, 0) < item.quantity THEN
        RAISE EXCEPTION 'Lot "%" insuffisant pour "%" : disponible=%, demandé=%',
          item.batch_number, item.product_name, item.batch_qty, item.quantity;
      END IF;
    END LOOP;

    FOR item IN
      SELECT * FROM invoice_items
      WHERE invoice_id = NEW.id AND product_id IS NOT NULL
    LOOP
      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, item.batch_id, 'OUT', item.quantity,
        'Facture ' || NEW.invoice_number || ' validée', NEW.id, 'invoice', NEW.validated_by);
    END LOOP;
    NEW.validated_at := now();
  END IF;

  IF OLD.status IN ('approved', 'partial') AND NEW.status = 'cancelled' THEN
    FOR item IN
      SELECT * FROM invoice_items
      WHERE invoice_id = NEW.id AND product_id IS NOT NULL
    LOOP
      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, item.batch_id, 'IN', item.quantity,
        'Annulation facture ' || NEW.invoice_number, NEW.id, 'invoice_cancel', NEW.validated_by);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION process_bl_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
  linked_invoice uuid;
BEGIN
  linked_invoice := COALESCE(NEW.invoice_id, OLD.invoice_id);

  IF OLD.type = 'bon_livraison' AND OLD.status != 'approved' AND NEW.status = 'approved' THEN
    IF linked_invoice IS NULL THEN
      FOR item IN
        SELECT di.*, p.name AS product_name, p.quantity AS stock_qty,
               pb.quantity AS batch_qty, pb.batch_number
        FROM document_items di
        JOIN products p ON p.id = di.product_id
        LEFT JOIN product_batches pb ON pb.id = di.batch_id
        WHERE di.document_id = NEW.id AND di.product_id IS NOT NULL
      LOOP
        IF item.stock_qty < item.quantity THEN
          RAISE EXCEPTION 'Stock insuffisant pour "%" : disponible=%, demandé=%',
            item.product_name, item.stock_qty, item.quantity;
        END IF;
        IF item.batch_id IS NOT NULL AND COALESCE(item.batch_qty, 0) < item.quantity THEN
          RAISE EXCEPTION 'Lot "%" insuffisant pour "%" : disponible=%, demandé=%',
            item.batch_number, item.product_name, item.batch_qty, item.quantity;
        END IF;
      END LOOP;

      FOR item IN
        SELECT * FROM document_items
        WHERE document_id = NEW.id AND product_id IS NOT NULL
      LOOP
        INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
        VALUES (item.product_id, item.batch_id, 'OUT', item.quantity,
          'Bon de livraison ' || COALESCE(NEW.document_number, NEW.id::text),
          NEW.id, 'delivery_note', NEW.validated_by);
      END LOOP;
    END IF;
    NEW.validated_at := now();
  END IF;

  IF OLD.type = 'bon_livraison' AND OLD.status = 'approved' AND NEW.status = 'rejected' THEN
    IF linked_invoice IS NULL THEN
      FOR item IN
        SELECT * FROM document_items
        WHERE document_id = NEW.id AND product_id IS NOT NULL
      LOOP
        INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
        VALUES (item.product_id, item.batch_id, 'IN', item.quantity,
          'Annulation BL ' || COALESCE(NEW.document_number, NEW.id::text),
          NEW.id, 'delivery_note_cancel', NEW.validated_by);
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
