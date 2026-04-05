-- =====================================================
-- HUB Distribution — Migration Workflow Factures v2
-- Ajoute : statuts approved/partial, permission validation,
--          trigger stock bidirectionnel, restauration stock
-- À exécuter dans Supabase SQL Editor
-- =====================================================

-- 1. Permission de validation sur profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_validate_invoices boolean DEFAULT false;
UPDATE profiles SET can_validate_invoices = true WHERE role IN ('admin', 'ceo');

-- 2. Étendre la contrainte status sur invoices
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'partial', 'paid', 'cancelled'));

-- 3. Trigger validation + annulation (stock bidirectionnel)
CREATE OR REPLACE FUNCTION process_invoice_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
BEGIN
  -- ── APPROVED : décrémente le stock ──
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

  -- ── CANCELLED depuis approved/partial : restaure le stock ──
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

-- 4. Vue financière mise à jour (approved + partial = balance_due)
CREATE OR REPLACE VIEW client_financial_summary AS
SELECT
  c.id AS client_id,
  c.name AS client_name,
  c.email,
  count(i.id) AS total_invoices,
  coalesce(sum(CASE WHEN i.status NOT IN ('cancelled', 'draft') THEN i.total ELSE 0 END), 0) AS total_ordered,
  coalesce(sum(CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END), 0) AS total_paid,
  coalesce(sum(CASE WHEN i.status IN ('pending', 'approved', 'partial') THEN i.total ELSE 0 END), 0) AS balance_due,
  max(i.created_at) AS last_invoice_date
FROM clients c
LEFT JOIN invoices i ON i.client_id = c.id
GROUP BY c.id, c.name, c.email;
