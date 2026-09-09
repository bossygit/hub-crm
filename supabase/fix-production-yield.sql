-- Suivi du rendement de production (quantité réellement obtenue vs planifiée).
-- À exécuter sur une base déjà déployée, APRÈS fix-production-bom.sql (table production_orders).
-- Idempotent : peut être rejoué sans effet de bord.

-- 1) Colonnes de suivi du rendement sur les ordres de production.
--    - actual_output_quantity : quantité réellement obtenue (NULL = non saisie, l'UI
--      considère alors le rendement = 100 % et le stock est entré sur le planifié).
--      Les ordres produits AVANT cette migration gardent NULL → rendement 100 %.
--    - yield_notes : notes de production (pertes, incidents...) saisies par l'atelier.
--    - completed_by : opérateur / responsable ayant validé la production (déjà présent
--      dans fix-production-bom.sql, ajout IF NOT EXISTS pour les schémas antérieurs).
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS actual_output_quantity numeric,
  ADD COLUMN IF NOT EXISTS yield_notes text,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES profiles(id);

-- 2) process_production_completion — modifiée pour tenir compte du rendement réel.
--    Comportement d'origine conservé :
--      • contrôles de stock / lot des matières (FEFO) avant consommation ;
--      • mouvements OUT des matières premières consommées ;
--      • création du lot produit fini en quarantaine (statut 'pending') + mouvement IN ;
--      • annulation : restauration du stock (MP réintégrées, produit fini ressorti).
--    Changement :
--      • lors du passage à 'approved', si une quantité réellement obtenue est fournie
--        (positive), elle remplace la quantité planifiée pour la création du lot
--        produit fini et le mouvement IN ; sinon on conserve la quantité planifiée ;
--      • à l'annulation, le produit fini ressorti correspond exactement à la quantité
--        qui était entrée en stock lors de la production (réelle ou planifiée).
CREATE OR REPLACE FUNCTION process_production_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
  v_batch_id uuid;
  v_batch_number text;
  v_output_qty numeric;   -- Quantité de produit fini retenue (réelle si saisie, sinon planifiée)
  v_initial_in numeric;   -- Quantité réellement entrée en stock (pour l'annulation)
BEGIN
  IF OLD.status IN ('draft', 'pending') AND NEW.status = 'approved' THEN
    IF NEW.product_id IS NULL OR NEW.quantity <= 0 THEN
      RAISE EXCEPTION 'Ordre de production incomplet : produit fini et quantité requis';
    END IF;

    -- Rendement : si une quantité réellement obtenue est fournie, elle fait foi pour la
    -- création du lot et l'entrée en stock ; sinon on garde la quantité planifiée.
    IF NEW.actual_output_quantity IS NOT NULL AND NEW.actual_output_quantity <= 0 THEN
      RAISE EXCEPTION 'Quantité réellement obtenue invalide : doit être positive';
    END IF;
    v_output_qty := COALESCE(NEW.actual_output_quantity, NEW.quantity);

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
    -- Le lot est créé à 0 puis crédité par le mouvement IN (trigger update_product_quantity).
    INSERT INTO product_batches (product_id, batch_number, quantity, expiry_date, production_date, notes)
    VALUES (NEW.product_id, v_batch_number, 0, NEW.expiry_date, COALESCE(NEW.production_date, current_date),
      'Ordre ' || NEW.order_number)
    RETURNING id INTO v_batch_id;

    INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
    VALUES (NEW.product_id, v_batch_id, 'IN', v_output_qty,
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
      -- On ressort exactement la quantité entrée en stock à la production (le rendement
      -- réel a pu différer du planifié) afin de ne laisser ni stock fantôme ni solde négatif.
      SELECT quantity INTO v_initial_in
      FROM stock_movements
      WHERE reference_id = NEW.id AND reference_type = 'production'
        AND type = 'IN' AND batch_id = NEW.output_batch_id
      ORDER BY created_at
      LIMIT 1;
      v_initial_in := COALESCE(v_initial_in, NEW.quantity);

      INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
      VALUES (NEW.product_id, NEW.output_batch_id, 'OUT', v_initial_in,
        'Annulation production ' || NEW.order_number, NEW.id, 'production_cancel', NEW.completed_by);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
