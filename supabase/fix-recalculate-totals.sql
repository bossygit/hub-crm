-- =====================================================
-- FIX: recalculate_invoice_totals NULL tax_amount
--
-- Problème: quand toutes les lignes d'une facture sont
-- supprimées (étape normale de sauvegarde), le JOIN
-- entre invoice_items et invoices ne retourne aucune
-- ligne, laissant tax_rate et discount à NULL.
-- Résultat: tax_amount = NULL → violation NOT NULL.
--
-- Solution: séparer les requêtes — lire discount/tax_rate
-- directement depuis invoices (toujours 1 ligne), et
-- calculer le subtotal séparément depuis invoice_items.
--
-- À exécuter dans Supabase SQL Editor (Dashboard → SQL)
-- =====================================================

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
