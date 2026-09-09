-- ─────────────────────────────────────────────────────────────────────────────
-- GEL DE STOCK PENDANT INVENTAIRE + COMPTAGE À L'AVEUGLE
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colonnes blind / started_at / counted_by / revealed_at sur inventory_sessions.
-- 2. fn_inventory_freeze_guard() (BEFORE INSERT sur stock_movements) :
--    bloque tout mouvement (entrée, sortie, ajustement manuel) qui touche un
--    produit ou un lot couvert par une séance d'inventaire en cours ('draft'),
--    SAUF les ADJUST générés par la validation de la séance elle-même
--    (process_inventory_validation → reference_type='inventory').
-- 3. fn_inventory_session_touch() (BEFORE UPDATE OF status) : horodate le
--    démarrage d'un comptage passé à l'état 'draft'.
-- À exécuter dans le SQL Editor Supabase sur une base déjà déployée.
-- Idempotent : relançable sans effet de bord (IF NOT EXISTS / OR REPLACE /
-- DROP TRIGGER IF EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Colonnes aveugle / horodatages / compteur ---------------------------------
ALTER TABLE inventory_sessions
  ADD COLUMN IF NOT EXISTS blind boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS counted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revealed_at timestamptz;

COMMENT ON COLUMN inventory_sessions.blind IS
  'Comptage à l''aveugle : le théorique est masqué à l''écran tant que revealed_at est NULL.';
COMMENT ON COLUMN inventory_sessions.started_at IS 'Début effectif du comptage.';
COMMENT ON COLUMN inventory_sessions.counted_by IS 'Utilisateur qui a lancé le comptage.';
COMMENT ON COLUMN inventory_sessions.revealed_at IS
  'Horodatage du dévoilement des écarts par un manager (fin du masque).';

-- 2) Garde de gel de stock ------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_inventory_freeze_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_session text;
BEGIN
  -- Exception : les mouvements ADJUST écrits par process_inventory_validation()
  -- au moment du passage draft -> approved. Ils portent le marqueur
  -- reference_type='inventory', reference_id = id de la séance et le motif
  -- exact 'Inventaire <numéro>'. Ce contrôle tourne dans un trigger BEFORE
  -- UPDATE sur inventory_sessions : le statut encore visible en base est 'draft'
  -- pendant la validation, d'où l'autorisation des deux statuts.
  IF NEW.type = 'ADJUST'
     AND NEW.reference_type = 'inventory'
     AND NEW.reference_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM inventory_sessions s
       WHERE s.id = NEW.reference_id
         AND s.status IN ('draft', 'approved')
         AND NEW.reason = 'Inventaire ' || s.session_number
         AND EXISTS (
           SELECT 1 FROM inventory_lines l
           WHERE l.session_id = s.id
             AND (l.product_id = NEW.product_id
                  OR (NEW.batch_id IS NOT NULL AND l.batch_id = NEW.batch_id))
         )
     ) THEN
    RETURN NEW;
  END IF;

  -- Gel : aucun autre mouvement ne peut modifier le stock d'un produit/lot
  -- couvert par une séance d'inventaire non clôturée ('draft').
  SELECT s.session_number INTO v_session
  FROM inventory_sessions s
  JOIN inventory_lines l ON l.session_id = s.id
  WHERE s.status = 'draft'
    AND (l.product_id = NEW.product_id
         OR (NEW.batch_id IS NOT NULL AND l.batch_id = NEW.batch_id))
  LIMIT 1;

  IF v_session IS NOT NULL THEN
    RAISE EXCEPTION
      'Stock gelé : l''inventaire % est en cours sur ce produit. Terminez ou annulez la séance avant tout mouvement de stock.',
      v_session;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_freeze_guard ON stock_movements;
CREATE TRIGGER trg_inventory_freeze_guard
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_inventory_freeze_guard();

-- 3) Horodatage de démarrage du comptage ---------------------------------------
CREATE OR REPLACE FUNCTION fn_inventory_session_touch()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'draft' AND OLD.status IS DISTINCT FROM 'draft' AND OLD.started_at IS NULL THEN
    NEW.started_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_session_touch ON inventory_sessions;
CREATE TRIGGER trg_inventory_session_touch
  BEFORE UPDATE OF status ON inventory_sessions
  FOR EACH ROW EXECUTE FUNCTION fn_inventory_session_touch();

-- RLS : inchangée (inventory_sessions_all / inventory_lines_all permettent déjà
-- aux utilisateurs authentifiés de lire/écrire ; le gel est appliqué par le
-- trigger ci-dessus, pas par une politique).
