-- Qualité / libération des lots : quarantaine à la réception et à la production.
-- Lots existants restent libérés (DEFAULT released).
-- À exécuter sur une base déjà déployée.

ALTER TABLE product_batches
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'released';

ALTER TABLE product_batches DROP CONSTRAINT IF EXISTS product_batches_quality_status_check;
ALTER TABLE product_batches ADD CONSTRAINT product_batches_quality_status_check
  CHECK (quality_status IN ('pending', 'released', 'rejected'));

CREATE TABLE IF NOT EXISTS quality_checks (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  check_number text UNIQUE NOT NULL,
  batch_id uuid REFERENCES product_batches(id) ON DELETE RESTRICT NOT NULL,
  result text NOT NULL CHECK (result IN ('released', 'rejected')),
  source text CHECK (source IS NULL OR source IN ('purchase', 'production', 'manual')),
  notes text,
  checked_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE quality_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quality_checks_all ON quality_checks;
CREATE POLICY "quality_checks_all" ON quality_checks FOR ALL USING (auth.role() = 'authenticated');

CREATE OR REPLACE FUNCTION generate_quality_check_number()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  current_year text;
  count_this_year integer;
BEGIN
  current_year := to_char(now(), 'YYYY');
  SELECT count(*) INTO count_this_year
  FROM quality_checks
  WHERE check_number LIKE 'QC-' || current_year || '-%';
  RETURN 'QC-' || current_year || '-' || lpad((count_this_year + 1)::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION generate_quality_check_number() TO authenticated;

CREATE OR REPLACE FUNCTION process_quality_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_batch record;
BEGIN
  SELECT * INTO v_batch FROM product_batches WHERE id = NEW.batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lot introuvable';
  END IF;
  IF COALESCE(v_batch.quality_status, 'released') IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Ce lot n''est pas en quarantaine';
  END IF;

  IF NEW.result = 'released' THEN
    UPDATE product_batches SET quality_status = 'released' WHERE id = NEW.batch_id;
  ELSIF NEW.result = 'rejected' THEN
    UPDATE product_batches SET quality_status = 'rejected' WHERE id = NEW.batch_id;
    IF COALESCE(v_batch.quantity, 0) > 0 THEN
      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (v_batch.product_id, v_batch.id, 'OUT', v_batch.quantity,
        'Rebut qualité ' || NEW.check_number, NEW.id, 'quality', NEW.checked_by);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_quality_check_insert ON quality_checks;
CREATE TRIGGER on_quality_check_insert
  AFTER INSERT ON quality_checks
  FOR EACH ROW EXECUTE FUNCTION process_quality_check();

CREATE OR REPLACE FUNCTION process_purchase_reception()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
  v_batch_id uuid;
  v_batch_number text;
  v_supplier text;
BEGIN
  IF OLD.status IN ('draft', 'pending') AND NEW.status = 'approved' THEN
    SELECT c.name INTO v_supplier FROM clients c WHERE c.id = NEW.supplier_id;

    FOR item IN
      SELECT * FROM purchase_items
      WHERE purchase_id = NEW.id AND product_id IS NOT NULL AND quantity > 0
      ORDER BY sort_order
    LOOP
      v_batch_number := COALESCE(NULLIF(btrim(COALESCE(item.batch_number, '')), ''),
        NEW.purchase_number || '-L' || (item.sort_order + 1)::text);

      INSERT INTO product_batches (product_id, batch_number, quantity, expiry_date, production_date, supplier, cost_per_unit, quality_status)
      VALUES (item.product_id, v_batch_number, 0, item.expiry_date, item.production_date, v_supplier, item.unit_price, 'pending')
      RETURNING id INTO v_batch_id;

      UPDATE purchase_items SET batch_id = v_batch_id WHERE id = item.id;

      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, v_batch_id, 'IN', item.quantity,
        'Réception ' || NEW.purchase_number, NEW.id, 'purchase', NEW.received_by);
    END LOOP;

    NEW.received_at := now();
  END IF;

  IF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
    FOR item IN
      SELECT pi.*, pb.quality_status AS batch_quality
      FROM purchase_items pi
      LEFT JOIN product_batches pb ON pb.id = pi.batch_id
      WHERE pi.purchase_id = NEW.id AND pi.product_id IS NOT NULL AND pi.quantity > 0
    LOOP
      IF item.batch_quality = 'rejected' THEN
        CONTINUE;
      END IF;
      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, item.batch_id, 'OUT', item.quantity,
        'Annulation réception ' || NEW.purchase_number, NEW.id, 'purchase_cancel', NEW.received_by);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION process_production_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
  v_batch_id uuid;
  v_batch_number text;
  v_out_quality text;
BEGIN
  IF OLD.status IN ('draft', 'pending') AND NEW.status = 'approved' THEN
    IF NEW.product_id IS NULL OR NEW.quantity <= 0 THEN
      RAISE EXCEPTION 'Ordre de production incomplet : produit fini et quantité requis';
    END IF;

    FOR item IN
      SELECT poi.*, p.name AS product_name, p.quantity AS stock_qty, pb.quantity AS batch_qty,
             pb.batch_number, pb.quality_status AS batch_quality
      FROM production_order_items poi
      JOIN products p ON p.id = poi.product_id
      LEFT JOIN product_batches pb ON pb.id = poi.batch_id
      WHERE poi.order_id = NEW.id AND poi.product_id IS NOT NULL AND poi.quantity > 0
      ORDER BY poi.sort_order
    LOOP
      IF item.batch_id IS NULL THEN
        RAISE EXCEPTION 'Lot manquant pour la matière « % »', item.product_name;
      END IF;
      IF COALESCE(item.batch_quality, 'released') <> 'released' THEN
        RAISE EXCEPTION 'Lot "%" non libéré (qualité : %) — impossible de consommer « % »',
          item.batch_number, item.batch_quality, item.product_name;
      END IF;
      IF COALESCE(item.batch_qty, 0) < item.quantity THEN
        RAISE EXCEPTION 'Lot "%" insuffisant pour "%" : disponible=%, demandé=%',
          item.batch_number, item.product_name, item.batch_qty, item.quantity;
      END IF;
      IF item.stock_qty < item.quantity THEN
        RAISE EXCEPTION 'Stock insuffisant pour "%" : disponible=%, demandé=%',
          item.product_name, item.stock_qty, item.quantity;
      END IF;
    END LOOP;

    FOR item IN
      SELECT * FROM production_order_items
      WHERE order_id = NEW.id AND product_id IS NOT NULL AND quantity > 0
    LOOP
      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, item.batch_id, 'OUT', item.quantity,
        'Production ' || NEW.order_number, NEW.id, 'production', NEW.completed_by);
    END LOOP;

    v_batch_number := COALESCE(NULLIF(btrim(COALESCE(NEW.batch_number, '')), ''), NEW.order_number);
    INSERT INTO product_batches (product_id, batch_number, quantity, expiry_date, production_date, notes, quality_status)
    VALUES (NEW.product_id, v_batch_number, 0, NEW.expiry_date, COALESCE(NEW.production_date, current_date),
      'Ordre ' || NEW.order_number, 'pending')
    RETURNING id INTO v_batch_id;

    INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
    VALUES (NEW.product_id, v_batch_id, 'IN', NEW.quantity,
      'Production ' || NEW.order_number, NEW.id, 'production', NEW.completed_by);

    NEW.output_batch_id := v_batch_id;
    NEW.completed_at := now();
  END IF;

  IF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
    FOR item IN
      SELECT * FROM production_order_items
      WHERE order_id = NEW.id AND product_id IS NOT NULL AND quantity > 0
    LOOP
      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, item.batch_id, 'IN', item.quantity,
        'Annulation production ' || NEW.order_number, NEW.id, 'production_cancel', NEW.completed_by);
    END LOOP;

    IF NEW.output_batch_id IS NOT NULL THEN
      SELECT quality_status INTO v_out_quality FROM product_batches WHERE id = NEW.output_batch_id;
      IF COALESCE(v_out_quality, 'released') <> 'rejected' THEN
        INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
        VALUES (NEW.product_id, NEW.output_batch_id, 'OUT', NEW.quantity,
          'Annulation production ' || NEW.order_number, NEW.id, 'production_cancel', NEW.completed_by);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION process_invoice_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
BEGIN
  IF OLD.status IN ('draft', 'pending') AND NEW.status = 'approved' THEN
    FOR item IN
      SELECT ii.*, p.name AS product_name, p.quantity AS stock_qty,
             pb.quantity AS batch_qty, pb.batch_number, pb.quality_status AS batch_quality
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
      LEFT JOIN product_batches pb ON pb.id = ii.batch_id
      WHERE ii.invoice_id = NEW.id AND ii.product_id IS NOT NULL
    LOOP
      IF item.stock_qty < item.quantity THEN
        RAISE EXCEPTION 'Stock insuffisant pour "%" : disponible=%, demandé=%',
          item.product_name, item.stock_qty, item.quantity;
      END IF;
      IF item.batch_id IS NOT NULL AND COALESCE(item.batch_quality, 'released') <> 'released' THEN
        RAISE EXCEPTION 'Lot "%" non libéré (qualité : %) — impossible de facturer « % »',
          item.batch_number, item.batch_quality, item.product_name;
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
               pb.quantity AS batch_qty, pb.batch_number, pb.quality_status AS batch_quality
        FROM document_items di
        JOIN products p ON p.id = di.product_id
        LEFT JOIN product_batches pb ON pb.id = di.batch_id
        WHERE di.document_id = NEW.id AND di.product_id IS NOT NULL
      LOOP
        IF item.stock_qty < item.quantity THEN
          RAISE EXCEPTION 'Stock insuffisant pour "%" : disponible=%, demandé=%',
            item.product_name, item.stock_qty, item.quantity;
        END IF;
        IF item.batch_id IS NOT NULL AND COALESCE(item.batch_quality, 'released') <> 'released' THEN
          RAISE EXCEPTION 'Lot "%" non libéré (qualité : %) — impossible de livrer « % »',
            item.batch_number, item.batch_quality, item.product_name;
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

CREATE INDEX IF NOT EXISTS idx_product_batches_quality ON product_batches(quality_status);
CREATE INDEX IF NOT EXISTS idx_quality_checks_batch ON quality_checks(batch_id);
CREATE INDEX IF NOT EXISTS idx_quality_checks_created ON quality_checks(created_at DESC);
