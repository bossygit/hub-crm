-- Recettes (BOM) + ordres de production : consommation MP FEFO + lot produit fini.
-- À exécuter sur une base déjà déployée.

CREATE TABLE IF NOT EXISTS recipes (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  name text NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE RESTRICT NOT NULL,
  output_quantity numeric NOT NULL DEFAULT 1,
  unit text DEFAULT 'kg',
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  recipe_id uuid REFERENCES recipes(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE RESTRICT NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'kg',
  sort_order integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS production_orders (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_number text UNIQUE NOT NULL,
  recipe_id uuid REFERENCES recipes(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'cancelled')),
  batch_number text,
  expiry_date date,
  production_date date,
  output_batch_id uuid REFERENCES product_batches(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  completed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_order_items (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id uuid REFERENCES production_orders(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES product_batches(id) ON DELETE SET NULL,
  name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'kg',
  sort_order integer DEFAULT 0
);

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recipes_all ON recipes;
DROP POLICY IF EXISTS recipe_items_all ON recipe_items;
DROP POLICY IF EXISTS production_orders_all ON production_orders;
DROP POLICY IF EXISTS production_order_items_all ON production_order_items;
CREATE POLICY "recipes_all" ON recipes FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "recipe_items_all" ON recipe_items FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "production_orders_all" ON production_orders FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "production_order_items_all" ON production_order_items FOR ALL USING (auth.role() = 'authenticated');

CREATE OR REPLACE FUNCTION generate_production_number()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  current_year text;
  count_this_year integer;
BEGIN
  current_year := to_char(now(), 'YYYY');
  SELECT count(*) INTO count_this_year
  FROM production_orders
  WHERE order_number LIKE 'PROD-' || current_year || '-%';
  RETURN 'PROD-' || current_year || '-' || lpad((count_this_year + 1)::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION generate_production_number() TO authenticated;

CREATE OR REPLACE FUNCTION process_production_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
  v_batch_id uuid;
  v_batch_number text;
BEGIN
  IF OLD.status IN ('draft', 'pending') AND NEW.status = 'approved' THEN
    IF NEW.product_id IS NULL OR NEW.quantity <= 0 THEN
      RAISE EXCEPTION 'Ordre de production incomplet : produit fini et quantité requis';
    END IF;

    FOR item IN
      SELECT poi.*, p.name AS product_name, p.quantity AS stock_qty, pb.quantity AS batch_qty, pb.batch_number
      FROM production_order_items poi
      JOIN products p ON p.id = poi.product_id
      LEFT JOIN product_batches pb ON pb.id = poi.batch_id
      WHERE poi.order_id = NEW.id AND poi.product_id IS NOT NULL AND poi.quantity > 0
      ORDER BY poi.sort_order
    LOOP
      IF item.batch_id IS NULL THEN
        RAISE EXCEPTION 'Lot manquant pour la matière « % »', item.product_name;
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
    INSERT INTO product_batches (product_id, batch_number, quantity, expiry_date, production_date, notes)
    VALUES (NEW.product_id, v_batch_number, 0, NEW.expiry_date, COALESCE(NEW.production_date, current_date),
      'Ordre ' || NEW.order_number)
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
      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (NEW.product_id, NEW.output_batch_id, 'OUT', NEW.quantity,
        'Annulation production ' || NEW.order_number, NEW.id, 'production_cancel', NEW.completed_by);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_production_status_change ON production_orders;
CREATE TRIGGER on_production_status_change
  BEFORE UPDATE ON production_orders
  FOR EACH ROW EXECUTE FUNCTION process_production_completion();

CREATE INDEX IF NOT EXISTS idx_recipes_product ON recipes(product_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON recipe_items(recipe_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_status ON production_orders(status);
CREATE INDEX IF NOT EXISTS idx_production_orders_recipe ON production_orders(recipe_id);
CREATE INDEX IF NOT EXISTS idx_production_order_items_order ON production_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_production_order_items_batch ON production_order_items(batch_id);
