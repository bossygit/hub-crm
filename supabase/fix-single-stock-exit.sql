-- Une seule sortie de stock : facture OU BL autonome, pas les deux.
-- Un BL lié à une facture ne décrémente plus (ni ne restaure) le stock.
-- À exécuter dans le SQL Editor Supabase sur une base déjà déployée.

CREATE OR REPLACE FUNCTION process_bl_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
  linked_invoice uuid;
BEGIN
  linked_invoice := COALESCE(NEW.invoice_id, OLD.invoice_id);

  IF OLD.type = 'bon_livraison' AND OLD.status != 'approved' AND NEW.status = 'approved' THEN
    IF linked_invoice IS NULL THEN
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
    END IF;
    NEW.validated_at := now();
  END IF;

  IF OLD.type = 'bon_livraison' AND OLD.status = 'approved' AND NEW.status = 'rejected' THEN
    IF linked_invoice IS NULL THEN
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
  END IF;

  RETURN NEW;
END;
$$;
