-- ─────────────────────────────────────────────────────────────────────────────
-- fix-delivery-notes-extra.sql — Durcissement ADDITIF Bons de Livraison.
-- À exécuter dans le SQL Editor Supabase sur une base déjà déployée.
--
-- RÈGLE : le trigger process_bl_validation est LA source de vérité de la sortie
-- unique de stock (BL lié à une facture = aucun mouvement ; BL autonome =
-- décrément à la validation, restauration à l'annulation après livraison).
-- Ce fichier n'ajoute AUCUNE colonne (réception signée / motifs = content jsonb
-- + documents.rejection_reason déjà existants) et ne réécrit pas la logique.
--
-- Durcissement : la table `documents` autorise DEUX valeurs pour un bon de
-- livraison (`bon_livraison` utilisé par /delivery-notes et `bon_de_livraison`
-- historique). La fonction de trigger ne couvrait que `bon_livraison` : une
-- ligne au type historique pouvait être validée SANS aucune sortie de stock,
-- contournant silencieusement l'invariant. On étend la garde aux deux types
-- (comportement inchangé pour `bon_livraison`).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION process_bl_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
  linked_invoice uuid;
BEGIN
  linked_invoice := COALESCE(NEW.invoice_id, OLD.invoice_id);

  IF OLD.type IN ('bon_livraison', 'bon_de_livraison') AND OLD.status != 'approved' AND NEW.status = 'approved' THEN
    -- Facture liée : le stock est déjà sorti à la validation de la facture → aucun mouvement.
    IF linked_invoice IS NULL THEN
      FOR item IN
        SELECT di.*, p.name AS product_name, p.quantity AS stock_qty,
               pb.quantity AS batch_qty, pb.batch_number
        FROM document_items di
        JOIN products p ON p.id = di.product_id
        LEFT JOIN product_batches pb ON pb.id = di.batch_id
        WHERE di.document_id = NEW.id AND di.product_id IS NOT NULL
      LOOP
        IF item.stock_qty < item.quantity THEN
          RAISE EXCEPTION 'Stock insuffisant pour "%" : disponible=%, demandé=%',
            item.product_name, item.stock_qty, item.quantity;
        END IF;
        IF item.batch_id IS NOT NULL AND COALESCE(item.batch_qty, 0) < item.quantity THEN
          RAISE EXCEPTION 'Lot "%" insuffisant pour "%" : disponible=%, demandé=%',
            item.batch_number, item.product_name, item.batch_qty, item.quantity;
        END IF;
      END LOOP;

      FOR item IN
        SELECT * FROM document_items
        WHERE document_id = NEW.id AND product_id IS NOT NULL
      LOOP
        INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
        VALUES (item.product_id, item.batch_id, 'OUT', item.quantity,
          'Bon de livraison ' || COALESCE(NEW.document_number, NEW.id::text),
          NEW.id, 'delivery_note', NEW.validated_by);
      END LOOP;
    END IF;
    NEW.validated_at := now();
  END IF;

  IF OLD.type IN ('bon_livraison', 'bon_de_livraison') AND OLD.status = 'approved' AND NEW.status = 'rejected' THEN
    IF linked_invoice IS NULL THEN
      FOR item IN
        SELECT * FROM document_items
        WHERE document_id = NEW.id AND product_id IS NOT NULL
      LOOP
        INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, reference_id, reference_type, user_id)
        VALUES (item.product_id, item.batch_id, 'IN', item.quantity,
          'Annulation BL ' || COALESCE(NEW.document_number, NEW.id::text),
          NEW.id, 'delivery_note_cancel', NEW.validated_by);
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_bl_validation ON documents;
CREATE TRIGGER on_bl_validation
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION process_bl_validation();
