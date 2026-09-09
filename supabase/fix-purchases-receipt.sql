-- Achats / réception MP : tables purchases + entrée stock par lot.
-- À exécuter dans le SQL Editor Supabase (ou via supabase db query --linked).

CREATE TABLE IF NOT EXISTS purchases (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  purchase_number text UNIQUE NOT NULL,
  supplier_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'cancelled')),
  subtotal numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  received_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  received_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  purchase_id uuid REFERENCES purchases(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES product_batches(id) ON DELETE SET NULL,
  name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'kg',
  unit_price numeric NOT NULL DEFAULT 0,
  batch_number text,
  expiry_date date,
  production_date date,
  subtotal numeric GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchases_all ON purchases;
DROP POLICY IF EXISTS purchase_items_all ON purchase_items;
CREATE POLICY "purchases_all" ON purchases FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "purchase_items_all" ON purchase_items FOR ALL USING (auth.role() = 'authenticated');

CREATE OR REPLACE FUNCTION generate_purchase_number()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  current_year text;
  count_this_year integer;
BEGIN
  current_year := to_char(now(), 'YYYY');
  SELECT count(*) INTO count_this_year
  FROM purchases
  WHERE purchase_number LIKE 'ACH-' || current_year || '-%';
  RETURN 'ACH-' || current_year || '-' || lpad((count_this_year + 1)::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION generate_purchase_number() TO authenticated;

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

      INSERT INTO product_batches (product_id, batch_number, quantity, expiry_date, production_date, supplier, cost_per_unit)
      VALUES (item.product_id, v_batch_number, 0, item.expiry_date, item.production_date, v_supplier, item.unit_price)
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
      SELECT * FROM purchase_items
      WHERE purchase_id = NEW.id AND product_id IS NOT NULL AND quantity > 0
    LOOP
      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, item.batch_id, 'OUT', item.quantity,
        'Annulation réception ' || NEW.purchase_number, NEW.id, 'purchase_cancel', NEW.received_by);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_purchase_status_change ON purchases;
CREATE TRIGGER on_purchase_status_change
  BEFORE UPDATE ON purchases
  FOR EACH ROW EXECUTE FUNCTION process_purchase_reception();

CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_batch ON purchase_items(batch_id);
