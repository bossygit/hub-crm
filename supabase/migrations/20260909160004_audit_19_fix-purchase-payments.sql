-- Paiements fournisseur (achats) : table purchase_payments + soldes par fournisseur.
-- Idempotent. À exécuter dans le SQL Editor Supabase (ou supabase db query --linked).

-- 1. Table des paiements sur un achat (fournisseur).
CREATE TABLE IF NOT EXISTS purchase_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT current_date,
  method text NOT NULL DEFAULT 'virement'
    CHECK (method IN ('virement', 'especes', 'cheque', 'mobile', 'autre')),
  reference text,
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE purchase_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "purchase_payments_all" ON purchase_payments;
DROP POLICY IF EXISTS "purchase_payments_insert" ON purchase_payments;
-- Authentifiés : lecture / modification / suppression des paiements.
CREATE POLICY "purchase_payments_all" ON purchase_payments
  FOR ALL USING (auth.role() = 'authenticated');
-- Insertion explicite pour tout utilisateur authentifié.
CREATE POLICY "purchase_payments_insert" ON purchase_payments
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_purchase_payments_purchase ON purchase_payments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_payments_date ON purchase_payments(payment_date DESC);

-- 2. Total payé pour un achat donné.
CREATE OR REPLACE FUNCTION purchase_total_paid(p_purchase_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM purchase_payments
  WHERE purchase_id = p_purchase_id;
$$;

GRANT EXECUTE ON FUNCTION purchase_total_paid(uuid) TO authenticated;

-- 3. Snapshot des soldes par fournisseur.
--    Ne comptabilise QUE les achats commandés/réceptionnés (statut hors
--    'draft' et 'cancelled') : un brouillon n'est pas encore dû, et un achat
--    annulé ne l'est plus. Les paiements enregistrés sur de tels achats sont
--    eux aussi ignorés des balances (cohérent avec la logique métier).
CREATE OR REPLACE FUNCTION supplier_balance_snapshot()
RETURNS TABLE (
  supplier_id uuid,
  supplier_name text,
  total_purchases numeric,
  total_paid numeric,
  balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH purchase_totals AS (
    SELECT p.supplier_id,
           COALESCE(SUM(p.subtotal), 0) AS total_purchases
    FROM purchases p
    WHERE p.supplier_id IS NOT NULL
      AND p.status NOT IN ('draft', 'cancelled')
    GROUP BY p.supplier_id
  ),
  paid_totals AS (
    SELECT p.supplier_id,
           COALESCE(SUM(pp.amount), 0) AS total_paid
    FROM purchase_payments pp
    JOIN purchases p ON p.id = pp.purchase_id
    WHERE p.supplier_id IS NOT NULL
      AND p.status NOT IN ('draft', 'cancelled')
    GROUP BY p.supplier_id
  )
  SELECT pt.supplier_id,
         COALESCE(c.name, 'Fournisseur') AS supplier_name,
         pt.total_purchases,
         COALESCE(pt2.total_paid, 0) AS total_paid,
         pt.total_purchases - COALESCE(pt2.total_paid, 0) AS balance
  FROM purchase_totals pt
  JOIN clients c ON c.id = pt.supplier_id
  LEFT JOIN paid_totals pt2 ON pt2.supplier_id = pt.supplier_id
  ORDER BY balance DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION supplier_balance_snapshot() TO authenticated;
