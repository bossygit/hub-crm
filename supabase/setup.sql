-- =====================================================
-- HUB Distribution CRM — Schéma Supabase Consolidé
-- Version: 3.0 — Fichier unique d'installation
-- 
-- INSTRUCTIONS:
--   1. Créer un projet Supabase (https://supabase.com)
--   2. Ouvrir l'éditeur SQL (Dashboard → SQL Editor)
--   3. Coller ce fichier en entier et exécuter
--   4. Configurer les buckets Storage (section 9)
--
-- Ce fichier consolide et remplace les 8 fichiers de
-- migration précédents (archivés dans supabase/archive/)
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. EXTENSIONS
-- ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────
-- 2. PROFILES & RÔLES
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name text,
  role text NOT NULL DEFAULT 'employee'
    CHECK (role IN ('ceo', 'manager', 'admin', 'employee', 'partner')),
  department text,
  phone text,
  avatar_url text,
  hire_date date,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'leave')),
  can_validate_invoices boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_admin_update" ON profiles FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role IN ('ceo', 'admin')
  )
);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-grant validation permission to admin/ceo
CREATE OR REPLACE FUNCTION sync_validate_permission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.role IN ('admin', 'ceo') THEN
    NEW.can_validate_invoices := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_role_change ON profiles;
CREATE TRIGGER on_profile_role_change
  BEFORE INSERT OR UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION sync_validate_permission();

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─────────────────────────────────────────────────────
-- 3. CLIENTS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'client'
    CHECK (type IN ('client', 'fournisseur', 'institution')),
  email text,
  phone text,
  address text,
  tax_id text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients_all" ON clients FOR ALL USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────
-- 4. PRODUITS & STOCK
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Général',
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'kg',
  threshold_alert numeric NOT NULL DEFAULT 10,
  price_per_unit numeric DEFAULT 0,
  description text,
  batch_tracking boolean DEFAULT false,
  supplier_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_select" ON products FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "products_insert" ON products FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "products_update" ON products FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "products_delete" ON products FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('ceo', 'manager', 'admin')
  )
);

-- Lots de produits
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
CREATE POLICY "batches_all" ON product_batches FOR ALL USING (auth.role() = 'authenticated');

-- Lots v2 (alternative table used by some migrations)
CREATE TABLE IF NOT EXISTS product_lots (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  lot_number text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  expiry_date date,
  production_date date,
  supplier text,
  supplier_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE product_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lots_all" ON product_lots FOR ALL USING (auth.role() = 'authenticated');

-- Mouvements de stock
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES product_batches(id) ON DELETE SET NULL,
  lot_id uuid REFERENCES product_lots(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('IN', 'OUT', 'ADJUST')),
  quantity numeric NOT NULL,
  reason text,
  reference text,
  reference_id uuid,
  reference_type text,
  user_id uuid REFERENCES profiles(id),
  notes text,
  date date DEFAULT current_date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "movements_all" ON stock_movements FOR ALL USING (auth.role() = 'authenticated');

-- Trigger: mise à jour automatique du stock
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

DROP TRIGGER IF EXISTS after_stock_movement ON stock_movements;
CREATE TRIGGER after_stock_movement
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION update_product_quantity();

-- ─────────────────────────────────────────────────────
-- 5. VENTES
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  reference text UNIQUE NOT NULL
    DEFAULT ('VTE-' || to_char(now(), 'YYYY') || '-' || lpad(floor(random() * 99999)::text, 5, '0')),
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
  total_amount numeric DEFAULT 0,
  tax_rate numeric DEFAULT 18,
  tax_amount numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  notes text,
  due_date date,
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_all" ON sales FOR ALL USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS sale_items (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  sale_id uuid REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES product_batches(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL,
  subtotal numeric GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale_items_all" ON sale_items FOR ALL USING (auth.role() = 'authenticated');

-- Trigger: validation vente → décrémentation stock
CREATE OR REPLACE FUNCTION process_sale_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
  sale_total numeric;
BEGIN
  IF OLD.status != 'approved' AND NEW.status = 'approved' THEN
    FOR item IN SELECT * FROM sale_items WHERE sale_id = NEW.id LOOP
      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type)
      VALUES (item.product_id, item.batch_id, 'OUT', item.quantity, 'Vente ' || NEW.reference, NEW.id, 'sale');
    END LOOP;
    SELECT sum(subtotal) INTO sale_total FROM sale_items WHERE sale_id = NEW.id;
    NEW.total_amount := COALESCE(sale_total, 0) - COALESCE(NEW.discount, 0);
    NEW.tax_amount := NEW.total_amount * NEW.tax_rate / 100;
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_sale_status_change ON sales;
CREATE TRIGGER on_sale_status_change
  BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION process_sale_approval();

-- ─────────────────────────────────────────────────────
-- 6. FACTURATION
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  invoice_number text UNIQUE NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  date date NOT NULL DEFAULT current_date,
  due_date date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'partial', 'paid', 'cancelled')),
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  tax_rate numeric NOT NULL DEFAULT 18,
  tax_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  file_url text,
  notes text,
  payment_terms text DEFAULT '30 jours',
  payment_method text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  validated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  validated_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit text DEFAULT 'unité',
  unit_price numeric NOT NULL,
  tax_rate numeric NOT NULL DEFAULT 18,
  subtotal numeric GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  amount numeric NOT NULL,
  payment_date date NOT NULL DEFAULT current_date,
  method text NOT NULL DEFAULT 'virement',
  reference text,
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  reference text UNIQUE NOT NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  reason text NOT NULL,
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'cancelled')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_all" ON invoices FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "invoice_items_all" ON invoice_items FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "invoice_payments_all" ON invoice_payments FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "credit_notes_all" ON credit_notes FOR ALL USING (auth.role() = 'authenticated');

-- Génération numéro de facture
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  current_year text;
  count_this_year integer;
BEGIN
  current_year := to_char(now(), 'YYYY');
  SELECT count(*) INTO count_this_year
  FROM invoices
  WHERE invoice_number LIKE 'FAC-' || current_year || '-%';
  RETURN 'FAC-' || current_year || '-' || lpad((count_this_year + 1)::text, 4, '0');
END;
$$;

-- Recalcul automatique des totaux facture
CREATE OR REPLACE FUNCTION recalculate_invoice_totals(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_subtotal numeric;
  v_discount numeric;
  v_tax_rate numeric;
  v_tax_amount numeric;
  v_total numeric;
BEGIN
  SELECT COALESCE(i.discount, 0), COALESCE(i.tax_rate, 18)
  INTO v_discount, v_tax_rate
  FROM invoices i
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(sum(quantity * unit_price), 0)
  INTO v_subtotal
  FROM invoice_items
  WHERE invoice_id = p_invoice_id;

  v_tax_amount := (v_subtotal - v_discount) * v_tax_rate / 100;
  v_total := v_subtotal - v_discount + v_tax_amount;

  UPDATE invoices SET
    subtotal = v_subtotal,
    tax_amount = v_tax_amount,
    total = v_total,
    updated_at = now()
  WHERE id = p_invoice_id;
END;
$$;

-- Trigger: recalcul après modification des lignes
CREATE OR REPLACE FUNCTION trigger_recalc_invoice()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalculate_invoice_totals(OLD.invoice_id);
  ELSE
    PERFORM recalculate_invoice_totals(NEW.invoice_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS recalc_on_item_change ON invoice_items;
CREATE TRIGGER recalc_on_item_change
  AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION trigger_recalc_invoice();

-- Trigger: validation/annulation facture → stock bidirectionnel
CREATE OR REPLACE FUNCTION process_invoice_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
BEGIN
  -- APPROVED: décrémente le stock
  IF OLD.status IN ('draft', 'pending') AND NEW.status = 'approved' THEN
    FOR item IN
      SELECT ii.*, p.name AS product_name, p.quantity AS stock_qty
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
      WHERE ii.invoice_id = NEW.id AND ii.product_id IS NOT NULL
    LOOP
      IF item.stock_qty < item.quantity THEN
        RAISE EXCEPTION 'Stock insuffisant pour "%" : disponible=%, demandé=%',
          item.product_name, item.stock_qty, item.quantity;
      END IF;
    END LOOP;

    FOR item IN
      SELECT * FROM invoice_items
      WHERE invoice_id = NEW.id AND product_id IS NOT NULL
    LOOP
      INSERT INTO stock_movements (product_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, 'OUT', item.quantity,
        'Facture ' || NEW.invoice_number || ' validée', NEW.id, 'invoice', NEW.validated_by);
    END LOOP;
    NEW.validated_at := now();
  END IF;

  -- CANCELLED depuis approved/partial: restaure le stock
  IF OLD.status IN ('approved', 'partial') AND NEW.status = 'cancelled' THEN
    FOR item IN
      SELECT * FROM invoice_items
      WHERE invoice_id = NEW.id AND product_id IS NOT NULL
    LOOP
      INSERT INTO stock_movements (product_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (item.product_id, 'IN', item.quantity,
        'Annulation facture ' || NEW.invoice_number, NEW.id, 'invoice_cancel', NEW.validated_by);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_invoice_validation ON invoices;
CREATE TRIGGER on_invoice_validation
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION process_invoice_validation();

-- Vue: résumé financier par client
CREATE OR REPLACE VIEW client_financial_summary AS
SELECT
  c.id AS client_id,
  c.name AS client_name,
  c.email,
  count(i.id) AS total_invoices,
  COALESCE(sum(CASE WHEN i.status NOT IN ('cancelled', 'draft') THEN i.total ELSE 0 END), 0) AS total_ordered,
  COALESCE(sum(CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END), 0) AS total_paid,
  COALESCE(sum(CASE WHEN i.status IN ('pending', 'approved', 'partial') THEN i.total ELSE 0 END), 0) AS balance_due,
  max(i.created_at) AS last_invoice_date
FROM clients c
LEFT JOIN invoices i ON i.client_id = c.id
GROUP BY c.id, c.name, c.email;

-- ─────────────────────────────────────────────────────
-- 7. DOCUMENTS & ÉCOSYSTÈME
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  reference text UNIQUE NOT NULL
    DEFAULT ('DOC-' || to_char(now(), 'YYYY') || '-' || lpad(floor(random() * 99999)::text, 5, '0')),
  title text NOT NULL,
  type text NOT NULL
    CHECK (type IN (
      'facture', 'bon_de_livraison', 'attestation', 'contrat',
      'document_rh', 'document_administratif', 'autre',
      'devis', 'bon_livraison', 'bon_entree_stock', 'bon_sortie_stock', 'recu_paiement'
    )),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'generated', 'sent', 'converted')),
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  content jsonb DEFAULT '{}',
  file_url text,
  rejection_reason text,
  document_number text UNIQUE,
  total_amount numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  tax_rate numeric DEFAULT 18,
  tax_amount numeric DEFAULT 0,
  due_date date,
  payment_terms text,
  created_by uuid REFERENCES profiles(id),
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  validated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  validated_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documents_all" ON documents FOR ALL USING (auth.role() = 'authenticated');

-- Lignes de documents (devis, BL, etc.)
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

-- Numérotation par type de document
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

-- Trigger: validation BL → stock
CREATE OR REPLACE FUNCTION process_bl_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
BEGIN
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

-- ─────────────────────────────────────────────────────
-- 8. EMPLOYÉS & RH
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  employee_number text UNIQUE,
  full_name text NOT NULL,
  position text NOT NULL,
  department text NOT NULL,
  email text,
  phone text,
  hire_date date NOT NULL,
  contract_type text NOT NULL DEFAULT 'cdi'
    CHECK (contract_type IN ('cdi', 'cdd', 'stage', 'freelance')),
  salary numeric,
  status text NOT NULL DEFAULT 'actif'
    CHECK (status IN ('actif', 'conge', 'suspendu', 'sorti')),
  address text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees_manager" ON employees FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('ceo', 'manager', 'admin')
  )
);

-- Documents RH
CREATE TABLE IF NOT EXISTS employee_documents (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  type text NOT NULL
    CHECK (type IN ('contrat', 'avenant', 'attestation_travail', 'fiche_paie', 'conge', 'discipline', 'autre')),
  title text NOT NULL,
  file_url text,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  content jsonb DEFAULT '{}',
  status text DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  start_date date,
  end_date date,
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  issued_date date DEFAULT current_date,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "emp_docs_manager" ON employee_documents FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('ceo', 'manager', 'admin')
  )
);

-- Soldes de congés
CREATE TABLE IF NOT EXISTS leave_balances (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  year integer NOT NULL DEFAULT extract(year FROM now())::integer,
  total_days integer NOT NULL DEFAULT 30,
  used_days integer NOT NULL DEFAULT 0,
  remaining_days integer GENERATED ALWAYS AS (total_days - used_days) STORED,
  created_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, year)
);

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leave_balances_all" ON leave_balances FOR ALL USING (auth.role() = 'authenticated');

-- Trigger: gestion congés
CREATE OR REPLACE FUNCTION process_leave_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  days_count integer;
  current_yr integer;
BEGIN
  IF OLD.type != 'conge' OR NEW.type != 'conge' THEN RETURN NEW; END IF;

  current_yr := extract(year FROM COALESCE(NEW.start_date, now()))::integer;

  IF NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL THEN
    days_count := 0;
    FOR i IN 0..(NEW.end_date - NEW.start_date) LOOP
      IF extract(dow FROM NEW.start_date + i) NOT IN (0, 6) THEN
        days_count := days_count + 1;
      END IF;
    END LOOP;
  ELSE
    days_count := 1;
  END IF;

  INSERT INTO leave_balances (employee_id, year)
  VALUES (NEW.employee_id, current_yr)
  ON CONFLICT (employee_id, year) DO NOTHING;

  IF (OLD.status IS DISTINCT FROM 'approved') AND NEW.status = 'approved' THEN
    UPDATE leave_balances SET used_days = used_days + days_count
    WHERE employee_id = NEW.employee_id AND year = current_yr;
  END IF;

  IF OLD.status = 'approved' AND NEW.status = 'rejected' THEN
    UPDATE leave_balances SET used_days = GREATEST(0, used_days - days_count)
    WHERE employee_id = NEW.employee_id AND year = current_yr;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_approval ON employee_documents;
CREATE TRIGGER on_leave_approval
  BEFORE UPDATE ON employee_documents
  FOR EACH ROW EXECUTE FUNCTION process_leave_approval();

-- RH Records (bulletins, avertissements, etc.)
CREATE TABLE IF NOT EXISTS hr_records (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL
    CHECK (type IN ('contrat', 'bulletin_salaire', 'conge', 'avertissement', 'attestation_travail', 'autre')),
  title text NOT NULL,
  file_url text,
  notes text,
  month_year text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE hr_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hr_records_manager" ON hr_records FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('ceo', 'manager', 'admin')
  )
);

-- Présences
CREATE TABLE IF NOT EXISTS attendance (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT current_date,
  status text DEFAULT 'present'
    CHECK (status IN ('present', 'absent', 'late', 'leave', 'holiday')),
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, date)
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_all" ON attendance FOR ALL USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────
-- 9. RECRUTEMENT
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  title text NOT NULL,
  department text NOT NULL,
  description text NOT NULL,
  requirements text,
  location text DEFAULT 'Brazzaville',
  type text NOT NULL CHECK (type IN ('cdi', 'cdd', 'stage', 'freelance')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
  deadline date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs_select" ON jobs FOR SELECT USING (true);
CREATE POLICY "jobs_write" ON jobs FOR ALL USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS candidates (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  cv_url text,
  cover_letter text,
  status text NOT NULL DEFAULT 'nouveau'
    CHECK (status IN ('nouveau', 'en_cours', 'entretien', 'accepte', 'refuse')),
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "candidates_select" ON candidates FOR SELECT USING (true);
CREATE POLICY "candidates_insert" ON candidates FOR INSERT WITH CHECK (true);
CREATE POLICY "candidates_update" ON candidates FOR UPDATE USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────
-- 10. DEMANDES EXTERNES (Portail)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_requests (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  requester_name text NOT NULL,
  organization text NOT NULL,
  email text NOT NULL,
  phone text,
  document_type text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'approved', 'rejected')),
  response_notes text,
  document_url text,
  handled_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE document_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "doc_req_insert" ON document_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "doc_req_select" ON document_requests FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "doc_req_update" ON document_requests FOR UPDATE USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────
-- 11. NOTIFICATIONS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('invoice_pending', 'bl_pending', 'leave_pending', 'quote_pending')),
  title text NOT NULL,
  message text,
  reference_id uuid,
  reference_type text,
  link text,
  is_read boolean DEFAULT false,
  recipient_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_select" ON notifications FOR SELECT USING (recipient_id = auth.uid());
CREATE POLICY "notifications_update" ON notifications FOR UPDATE USING (recipient_id = auth.uid());
CREATE POLICY "notifications_insert" ON notifications FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────
-- 12. INDEX DE PERFORMANCE
-- ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(product_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS idx_documents_invoice ON documents(invoice_id);
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_document_id);
CREATE INDEX IF NOT EXISTS idx_document_items_document ON document_items(document_id);
CREATE INDEX IF NOT EXISTS idx_document_items_product ON document_items(product_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_type ON employee_documents(type);
CREATE INDEX IF NOT EXISTS idx_employee_documents_status ON employee_documents(status);
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances(employee_id);

-- ─────────────────────────────────────────────────────
-- 13. STORAGE BUCKETS (exécuter via Dashboard Supabase
--     ou via l'API storage — pas via SQL directement)
-- ─────────────────────────────────────────────────────
-- Buckets à créer dans le Dashboard Supabase → Storage :
--
--   1. "invoices-pdf"  (privé) — PDF des factures générées
--   2. "documents"     (privé) — Devis, BL, fiches RH, etc.
--
-- Policies Storage (à configurer dans Dashboard → Storage → Policies) :
--   - SELECT : auth.role() = 'authenticated'
--   - INSERT : auth.role() = 'authenticated'
--   - UPDATE : auth.role() = 'authenticated'
--   - DELETE : role IN ('ceo', 'manager', 'admin')

-- ─────────────────────────────────────────────────────
-- 14. DONNÉES DE DÉMONSTRATION (optionnel)
-- ─────────────────────────────────────────────────────
INSERT INTO clients (name, type, email, phone, address, tax_id) VALUES
  ('Coopérative Agricole du Pool', 'fournisseur', 'coop.pool@gmail.com', '+242 06 700 0001', 'Kinkala, Congo', 'NIF-001234'),
  ('Supermarché Géant Vert', 'client', 'geantvert@business.cg', '+242 06 700 0002', 'Brazzaville', 'NIF-005678'),
  ('Direction Générale des Impôts', 'institution', 'dgi@finances.gov.cg', '+242 06 700 0003', 'Brazzaville', NULL),
  ('Assurances AXA Congo', 'institution', 'axa@assurances.cg', '+242 06 700 0004', 'Brazzaville', NULL),
  ('Restaurant Le Palmier', 'client', 'palmier@resto.cg', '+242 06 700 0005', 'Pointe-Noire', 'NIF-009012')
ON CONFLICT DO NOTHING;

INSERT INTO products (name, category, quantity, unit, threshold_alert, price_per_unit) VALUES
  -- Chocolats
  ('Chocolat noir à la cardamome d''Afrique centrale', 'Chocolats', 50, 'pièce', 20, 3500),
  ('Chocolat noir 100% sans sucre ajouté', 'Chocolats', 50, 'pièce', 20, 3500),
  ('Chocolat noir 75% NZOKO', 'Chocolats', 50, 'pièce', 20, 2000),
  ('Chocolat noir 70% aux éclats d''arachides sucrées', 'Chocolats', 50, 'pièce', 20, 3500),
  ('Chocolat noir 70%', 'Chocolats', 50, 'pièce', 20, 2000),
  ('Chocolat au lait aux éclats d''arachides sucrées', 'Chocolats', 50, 'pièce', 20, 3000),
  ('Chocolat au lait', 'Chocolats', 50, 'pièce', 20, 2000),
  ('Chocolat Noir 70% Kongo', 'Chocolats', 50, 'pièce', 20, 1800),
  -- Farines / Céréales
  ('Farine de maïs jaune 700g', 'Farines / Céréales', 50, 'pièce', 30, 1000),
  ('Semoule de manioc 700g', 'Farines / Céréales', 50, 'pièce', 30, 1000),
  ('Farine de maïs blanc 700g', 'Farines / Céréales', 50, 'pièce', 30, 1000),
  ('Farine de soja', 'Farines / Céréales', 50, 'pièce', 30, 2000),
  ('Farine de manioc 700g', 'Farines / Céréales', 50, 'pièce', 30, 1000),
  -- Graines / Légumineuses
  ('Haricot 700g', 'Graines / Légumineuses', 50, 'pièce', 20, 2000),
  ('Fève de cacao torréfiée 700g', 'Graines / Légumineuses', 50, 'pièce', 20, 6000),
  ('Graine de soja', 'Graines / Légumineuses', 50, 'pièce', 20, 2000),
  -- Autres produits alimentaires
  ('Pâte d''arachide', 'Autres produits alimentaires', 50, 'pièce', 20, 6000),
  ('Gari', 'Autres produits alimentaires', 50, 'pièce', 20, 1500),
  ('Bulukutu', 'Autres produits alimentaires', 50, 'pièce', 20, 700),
  ('Bissap Hibiscus', 'Autres produits alimentaires', 50, 'pièce', 20, 1500)
ON CONFLICT DO NOTHING;

INSERT INTO jobs (title, department, description, requirements, type, deadline) VALUES
  ('Responsable Commercial', 'Commercial', 'Développer le portefeuille clients.', 'BAC+3 en commerce, 2 ans exp.', 'cdi', '2025-06-30'),
  ('Technicien Qualité', 'Production', 'Contrôler la qualité des produits transformés.', 'BTS en agroalimentaire', 'cdi', '2025-05-31')
ON CONFLICT DO NOTHING;
