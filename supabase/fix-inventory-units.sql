-- Inventaire physique par lot + conditionnements produit (unité de base).
-- ADJUST applique un écart signé (réel − théorique) sur produit et lot.
-- À exécuter sur une base déjà déployée.

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
  ELSIF NEW.type = 'ADJUST' THEN
    UPDATE products SET quantity = quantity + NEW.quantity WHERE id = NEW.product_id;
    IF NEW.batch_id IS NOT NULL THEN
      UPDATE product_batches SET quantity = quantity + NEW.quantity WHERE id = NEW.batch_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS product_units (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  unit text NOT NULL,
  factor numeric NOT NULL CHECK (factor > 0),
  UNIQUE (product_id, unit)
);

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_number text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'cancelled')),
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  validated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  validated_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_lines (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id uuid REFERENCES inventory_sessions(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES product_batches(id) ON DELETE SET NULL,
  name text NOT NULL,
  batch_number text,
  unit text DEFAULT 'kg',
  theoretical numeric NOT NULL DEFAULT 0,
  counted numeric NOT NULL DEFAULT 0,
  entry_quantity numeric,
  entry_unit text,
  sort_order integer DEFAULT 0
);

ALTER TABLE product_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_units_all ON product_units;
DROP POLICY IF EXISTS inventory_sessions_all ON inventory_sessions;
DROP POLICY IF EXISTS inventory_lines_all ON inventory_lines;
CREATE POLICY "product_units_all" ON product_units FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "inventory_sessions_all" ON inventory_sessions FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "inventory_lines_all" ON inventory_lines FOR ALL USING (auth.role() = 'authenticated');

CREATE UNIQUE INDEX IF NOT EXISTS inventory_lines_session_batch
  ON inventory_lines (session_id, batch_id) WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_lines_session_unbatched
  ON inventory_lines (session_id, product_id) WHERE batch_id IS NULL;

CREATE OR REPLACE FUNCTION generate_inventory_number()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  current_year text;
  count_this_year integer;
BEGIN
  current_year := to_char(now(), 'YYYY');
  SELECT count(*) INTO count_this_year
  FROM inventory_sessions
  WHERE session_number LIKE 'INV-' || current_year || '-%';
  RETURN 'INV-' || current_year || '-' || lpad((count_this_year + 1)::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION generate_inventory_number() TO authenticated;

CREATE OR REPLACE FUNCTION process_inventory_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
  v_delta numeric;
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
    FOR item IN
      SELECT * FROM inventory_lines
      WHERE session_id = NEW.id
      ORDER BY sort_order
    LOOP
      v_delta := COALESCE(item.counted, item.theoretical) - item.theoretical;
      IF v_delta = 0 THEN
        CONTINUE;
      END IF;
      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, item.batch_id, 'ADJUST', v_delta,
        'Inventaire ' || NEW.session_number, NEW.id, 'inventory', NEW.validated_by);
    END LOOP;
    NEW.validated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_inventory_status_change ON inventory_sessions;
CREATE TRIGGER on_inventory_status_change
  BEFORE UPDATE ON inventory_sessions
  FOR EACH ROW EXECUTE FUNCTION process_inventory_validation();

CREATE INDEX IF NOT EXISTS idx_product_units_product ON product_units(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sessions_status ON inventory_sessions(status);
CREATE INDEX IF NOT EXISTS idx_inventory_lines_session ON inventory_lines(session_id);
