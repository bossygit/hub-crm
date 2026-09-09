-- ─────────────────────────────────────────────────────────────────────────────
-- Portail public — catalogue produits + commandes (audit module 4/10 → ~9/10)
-- Tables portal_orders / portal_order_items, politiques RLS, colonnes de
-- catalogue sur products, numérotation POR-YYYY-XXXX.
--
-- IDEMPOTENT : exécutable plusieurs fois dans le SQL Editor Supabase.
-- Ne modifie rien de setup.sql ni des autres fix-*.sql.
--
-- Après exécution, activer les produits du catalogue public (page Produits /
-- stock à terme, sinon en SQL) :
--   UPDATE products SET is_catalog = TRUE WHERE price_per_unit > 0 AND quantity > 0;
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Numérotation des commandes : POR-YYYY-XXXX ───────────────────────────
CREATE OR REPLACE FUNCTION public.gen_portal_order_number()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  current_year text;
  count_this_year integer;
BEGIN
  current_year := to_char(now(), 'YYYY');
  SELECT count(*) INTO count_this_year
  FROM portal_orders
  WHERE order_number LIKE 'POR-' || current_year || '-%';
  RETURN 'POR-' || current_year || '-' || lpad((count_this_year + 1)::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.gen_portal_order_number() TO anon, authenticated;

-- ── 2. Colonnes catalogue sur products (créées avant la table commandes) ────
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_catalog boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_unit text;

COMMENT ON COLUMN products.is_catalog IS 'Produit visible dans le catalogue public du portail (section commande).';
COMMENT ON COLUMN products.catalog_unit IS 'Unité d''affichage public si différente de products.unit (ex. « carton de 12 »).';

-- ── 3. Commandes portail (formulaire public, traitées en interne) ───────────
CREATE TABLE IF NOT EXISTS portal_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number text UNIQUE NOT NULL DEFAULT public.gen_portal_order_number(),
  status text NOT NULL DEFAULT 'nouvelle'
    CHECK (status IN ('nouvelle', 'en_cours', 'pret', 'livree', 'convertie', 'annulee')),
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,
  organization text,
  delivery_address text,
  notes text,
  total_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  handled_by uuid REFERENCES profiles(id),
  handled_at timestamptz,
  internal_notes text
);

CREATE TABLE IF NOT EXISTS portal_order_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES portal_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  name text NOT NULL,
  unit text,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL,
  subtotal numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_orders_status ON portal_orders(status);
CREATE INDEX IF NOT EXISTS idx_portal_orders_created ON portal_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_orders_customer ON portal_orders(customer_name);
CREATE INDEX IF NOT EXISTS idx_portal_order_items_order ON portal_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_portal_order_items_product ON portal_order_items(product_id);

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE portal_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_order_items ENABLE ROW LEVEL SECURITY;

-- Public : création d'une commande (formulaire du portail) uniquement au statut
-- initial « nouvelle », non prise en charge — empêche la falsification du statut.
DROP POLICY IF EXISTS portal_orders_anon_insert ON portal_orders;
CREATE POLICY portal_orders_anon_insert ON portal_orders
  FOR INSERT TO anon
  WITH CHECK (status = 'nouvelle' AND handled_by IS NULL);

-- Interne : lecture et traitement des commandes.
DROP POLICY IF EXISTS portal_orders_auth_select ON portal_orders;
CREATE POLICY portal_orders_auth_select ON portal_orders
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS portal_orders_auth_update ON portal_orders;
CREATE POLICY portal_orders_auth_update ON portal_orders
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Public : lignes rattachées à une commande « nouvelle » non prise en charge.
DROP POLICY IF EXISTS portal_order_items_anon_insert ON portal_order_items;
CREATE POLICY portal_order_items_anon_insert ON portal_order_items
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM portal_orders o
      WHERE o.id = order_id AND o.status = 'nouvelle' AND o.handled_by IS NULL
    )
  );

-- Interne : lecture / mise à jour des lignes.
DROP POLICY IF EXISTS portal_order_items_auth_select ON portal_order_items;
CREATE POLICY portal_order_items_auth_select ON portal_order_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS portal_order_items_auth_update ON portal_order_items;
CREATE POLICY portal_order_items_auth_update ON portal_order_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── 5. Catalogue public : SELECT anon restreint aux produits actifs et en stock.
--      La politique authenticated existante (products_select, setup.sql) reste intacte.
DROP POLICY IF EXISTS products_catalog_public_anon ON products;
CREATE POLICY products_catalog_public_anon ON products
  FOR SELECT TO anon
  USING (is_catalog = true AND quantity > 0);

-- ── 6. Privilèges (filet de sécurité, indépendant des default privileges) ────
GRANT SELECT ON products TO anon;
GRANT SELECT, INSERT ON portal_orders TO anon;
GRANT SELECT, INSERT ON portal_order_items TO anon;
GRANT SELECT, INSERT, UPDATE ON portal_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON portal_order_items TO authenticated;
