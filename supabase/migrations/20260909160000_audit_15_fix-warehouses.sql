-- ─────────────────────────────────────────────────────
-- MULTI-ENTREPÔT : table warehouses + rattachement des lots
-- et mouvements de stock à un entrepôt + RPC de transfert.
--
-- À exécuter dans le SQL Editor Supabase sur une base déjà déployée.
-- Idempotent : peut être ré-exécuté sans erreur.
--
-- NB : le trigger after_stock_movement / update_product_quantity() existant
-- n'est PAS modifié. warehouse_id est purement informatif/traçabilité :
-- les mouvements OUT/IN continuent de décrémenter/incrémenter products.quantity
-- et product_batches.quantity via batch_id comme avant.
-- ─────────────────────────────────────────────────────

-- 1. Table des entrepôts ------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  location text,
  is_cold boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE warehouses IS 'Entrepôts / lieux de stockage (multi-entrepôt)';
COMMENT ON COLUMN warehouses.is_cold IS 'Vrai si chambre froide / stockage sous température dirigée';

-- Entrepôt principal par défaut si la table vient d'être créée (vide).
INSERT INTO warehouses (name, code, location, is_cold, notes)
SELECT 'Entrepôt Principal', 'PRINCIPAL', NULL, false, 'Entrepôt par défaut'
WHERE NOT EXISTS (SELECT 1 FROM warehouses);

-- 2. RLS ----------------------------------------------------------------
-- SELECT / INSERT / UPDATE : tout utilisateur authentifié.
-- DELETE : réservé à ceo / manager / admin (comme les autres tables).
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wh_select ON warehouses;
CREATE POLICY wh_select ON warehouses
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS wh_insert ON warehouses;
CREATE POLICY wh_insert ON warehouses
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS wh_update ON warehouses;
CREATE POLICY wh_update ON warehouses
  FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS wh_delete ON warehouses;
CREATE POLICY wh_delete ON warehouses
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('ceo', 'manager', 'admin')
    )
  );

-- 3. Rattachement des lots & mouvements à un entrepôt ---------------------
ALTER TABLE product_batches
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_batches_warehouse ON product_batches(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse ON stock_movements(warehouse_id);

COMMENT ON COLUMN product_batches.warehouse_id IS 'Entrepôt où est stocké ce lot';
COMMENT ON COLUMN stock_movements.warehouse_id IS 'Entrepôt concerné par le mouvement (informatif)';

-- Lots existants créés avant le multi-entrepôt → rattachés à l'entrepôt par défaut.
UPDATE product_batches
SET warehouse_id = (SELECT id FROM warehouses WHERE code = 'PRINCIPAL' LIMIT 1)
WHERE warehouse_id IS NULL
  AND EXISTS (SELECT 1 FROM warehouses WHERE code = 'PRINCIPAL');

-- 4. RPC transfert entre entrepôts ----------------------------------------
-- Déplace p_qty d'un lot source (libéré) vers un entrepôt cible :
--   1. sortie de stock (type OUT, motif TRANSFERT SORTIE, entrepôt source)
--   2. entrée de stock (type IN, motif TRANSFERT ENTREE, entrepôt cible)
-- Si aucun lot identique (même produit + n° de lot) n'existe déjà dans
-- l'entrepôt cible, on crée d'abord un lot à quantité 0 (mêmes caractéristiques)
-- pour que le trigger after_stock_movement mette à jour sa quantité.
-- Le tout est transactionnel (repli total en cas d'erreur).
CREATE OR REPLACE FUNCTION transfer_batch(
  p_batch_id uuid,
  p_to_warehouse_id uuid,
  p_qty numeric,
  p_user uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch record;
  v_target_name text;
  v_source_name text;
  v_target_batch_id uuid;
BEGIN
  IF p_batch_id IS NULL OR p_to_warehouse_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Lot ou entrepôt de destination manquant.');
  END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'La quantité à transférer doit être strictement positive.');
  END IF;

  -- Lot source avec produit + entrepôt
  SELECT pb.*, p.name AS product_name, w.name AS source_warehouse
    INTO v_batch
    FROM product_batches pb
    JOIN products p ON p.id = pb.product_id
    LEFT JOIN warehouses w ON w.id = pb.warehouse_id
   WHERE pb.id = p_batch_id;

  IF v_batch.id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Lot source introuvable.');
  END IF;

  -- Entrepôt cible
  SELECT name INTO v_target_name FROM warehouses WHERE id = p_to_warehouse_id;
  IF v_target_name IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Entrepôt de destination introuvable.');
  END IF;

  v_source_name := COALESCE(v_batch.source_warehouse, 'Non affecté');

  IF v_batch.warehouse_id IS NULL THEN
    RETURN json_build_object('success', false, 'message',
      'Le lot source n''est rattaché à aucun entrepôt : affectez-lui un entrepôt avant de le transférer.');
  END IF;

  IF p_to_warehouse_id = v_batch.warehouse_id THEN
    RETURN json_build_object('success', false, 'message',
      'L''entrepôt de destination doit être différent de l''entrepôt source (' || v_source_name || ').');
  END IF;

  IF COALESCE(v_batch.quality_status, 'released') <> 'released' THEN
    RETURN json_build_object('success', false, 'message',
      'Seuls les lots libérés par la qualité (released) peuvent être transférés (statut actuel : ' ||
      COALESCE(v_batch.quality_status, '—') || ').');
  END IF;

  IF v_batch.quantity IS NULL OR v_batch.quantity < p_qty THEN
    RETURN json_build_object('success', false, 'message',
      'Quantité insuffisante dans le lot source (disponible : ' || COALESCE(v_batch.quantity, 0) || ').');
  END IF;

  -- Lot équivalent déjà présent dans l'entrepôt cible (même produit + n° de lot, libéré)
  SELECT id INTO v_target_batch_id
    FROM product_batches
   WHERE product_id = v_batch.product_id
     AND batch_number = v_batch.batch_number
     AND warehouse_id = p_to_warehouse_id
     AND COALESCE(quality_status, 'released') = 'released'
   ORDER BY quantity DESC
   LIMIT 1;

  -- Sinon, création d'un lot à 0 dans l'entrepôt cible AVANT le mouvement IN
  -- pour que le trigger after_stock_movement incrémente sa quantité.
  IF v_target_batch_id IS NULL THEN
    INSERT INTO product_batches
      (product_id, batch_number, quantity, expiry_date, production_date,
       supplier, cost_per_unit, notes, quality_status, warehouse_id)
    VALUES
      (v_batch.product_id, v_batch.batch_number, 0, v_batch.expiry_date, v_batch.production_date,
       v_batch.supplier, v_batch.cost_per_unit,
       'Lot créé par transfert depuis ' || v_source_name,
       'released', p_to_warehouse_id)
    RETURNING id INTO v_target_batch_id;
  END IF;

  -- 1) Sortie du lot source
  INSERT INTO stock_movements
    (product_id, batch_id, warehouse_id, type, quantity, reason, reference, notes, user_id)
  VALUES
    (v_batch.product_id, v_batch.id, v_batch.warehouse_id, 'OUT', p_qty,
     'TRANSFERT SORTIE', 'transfert', 'Transfert de ' || v_source_name || ' vers ' || v_target_name ||
       ' — lot ' || v_batch.batch_number, p_user);

  -- 2) Entrée dans l'entrepôt cible
  INSERT INTO stock_movements
    (product_id, batch_id, warehouse_id, type, quantity, reason, reference, notes, user_id)
  VALUES
    (v_batch.product_id, v_target_batch_id, p_to_warehouse_id, 'IN', p_qty,
     'TRANSFERT ENTREE', 'transfert', 'Transfert depuis ' || v_source_name ||
       ' — lot ' || v_batch.batch_number, p_user);

  RETURN json_build_object(
    'success', true,
    'message', 'Transfert effectué : ' || p_qty || ' unité(s) de "' || v_batch.product_name ||
      '" (lot ' || v_batch.batch_number || ') — ' || v_source_name || ' → ' || v_target_name || '.'
  );
END;
$$;

-- Droits d'exécution : tout utilisateur authentifié peut transférer.
GRANT EXECUTE ON FUNCTION transfer_batch(uuid, uuid, numeric, uuid) TO authenticated;

COMMENT ON FUNCTION transfer_batch(uuid, uuid, numeric, uuid) IS
  'Transfère une quantité d''un lot (libéré) vers un autre entrepôt, en créant les mouvements OUT/IN.';
