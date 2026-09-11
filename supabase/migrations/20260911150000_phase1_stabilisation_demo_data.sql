-- =====================================================================
-- HUB Distribution CRM — Phase 1 : stabilisation opérationnelle
--
-- Cette migration prépare un environnement de démonstration exploitable :
-- fournisseurs, produits liés, employés, soldes de congés et régularisation
-- des factures alors en attente. Les enregistrements créés sont explicitement
-- identifiés « démo » pour pouvoir être remplacés par les données réelles.
-- =====================================================================

-- ── Congés : la page self-service doit pouvoir lire sa fiche, ses soldes
--    et ses demandes sans ouvrir les données RH aux autres employés.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employees_user_id_key
  ON public.employees (user_id)
  WHERE user_id IS NOT NULL;

DROP POLICY IF EXISTS "self_employees_own_select" ON public.employees;
CREATE POLICY "self_employees_own_select"
  ON public.employees FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "self_emp_docs_own_select" ON public.employee_documents;
CREATE POLICY "self_emp_docs_own_select"
  ON public.employee_documents FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "self_emp_docs_own_insert" ON public.employee_documents;
CREATE POLICY "self_emp_docs_own_insert"
  ON public.employee_documents FOR INSERT TO authenticated
  WITH CHECK (
    type = 'conge'
    AND status = 'pending'
    AND employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "self_leave_balances_own_select" ON public.leave_balances;
CREATE POLICY "self_leave_balances_own_select"
  ON public.leave_balances FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));

-- ── Fournisseurs de démonstration.
INSERT INTO public.clients (name, type, email, phone, address, tax_id, notes)
SELECT v.name, 'fournisseur', v.email, v.phone, v.address, v.tax_id,
       'Donnée démo phase 1 — à remplacer par la fiche fournisseur réelle.'
FROM (VALUES
  ('Congo Agro Source', 'contact@congoagro.demo', '+242 06 900 10 01', 'Kintélé, Brazzaville', 'CG-AGRO-001'),
  ('Africa Food Trading', 'ventes@africafood.demo', '+242 06 900 10 02', 'Pointe-Noire', 'CG-AFT-002'),
  ('Brazzaville Emballage', 'service@bzvemballage.demo', '+242 06 900 10 03', 'Mfilou, Brazzaville', 'CG-BZE-003'),
  ('TransLogistique Congo', 'operations@translog.demo', '+242 06 900 10 04', 'Zone industrielle, Pointe-Noire', 'CG-TLC-004')
) AS v(name, email, phone, address, tax_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.clients c WHERE c.type = 'fournisseur' AND c.name = v.name
);

-- Produits d'approvisionnement associés, créés uniquement s'ils sont absents.
WITH supplier_products AS (
  SELECT * FROM (VALUES
    ('Congo Agro Source', 'Farine de manioc premium', 'Matières premières', 'kg', 250, 80, 1.0, true),
    ('Africa Food Trading', 'Arachides décortiquées premium', 'Épicerie', 'kg', 180, 100, 1.0, true),
    ('Brazzaville Emballage', 'Sachets kraft HUB 1 kg', 'Emballages', 'pièce', 800, 200, 1.0, false),
    ('TransLogistique Congo', 'Carton d'expédition moyen format', 'Emballages', 'pièce', 450, 100, 1.0, false)
  ) AS p(supplier_name, name, category, unit, price_per_unit, threshold_alert, initial_quantity, batch_tracking)
)
INSERT INTO public.products (name, category, unit, price_per_unit, threshold_alert, quantity, batch_tracking, supplier_id, description)
SELECT p.name, p.category, p.unit, p.price_per_unit, p.threshold_alert, p.initial_quantity,
       p.batch_tracking, c.id,
       'Donnée démo phase 1 — produit associé à ' || c.name || '.'
FROM supplier_products p
JOIN public.clients c ON c.name = p.supplier_name AND c.type = 'fournisseur'
WHERE NOT EXISTS (SELECT 1 FROM public.products pr WHERE pr.name = p.name);

-- Lie le catalogue existant, encore non rattaché, aux fournisseurs démo.
WITH unlinked_products AS (
  SELECT p.id, row_number() OVER (ORDER BY p.created_at, p.id) AS rn
  FROM public.products p
  WHERE p.supplier_id IS NULL
), suppliers AS (
  SELECT c.id, row_number() OVER (ORDER BY c.name) AS rn
  FROM public.clients c
  WHERE c.type = 'fournisseur'
)
UPDATE public.products p
SET supplier_id = s.id
FROM unlinked_products u
JOIN suppliers s ON s.rn = ((u.rn - 1) % 4) + 1
WHERE p.id = u.id;

-- ── Effectif de démonstration, sans compte d'authentification lié : les
--    comptes réels sont ensuite reliés depuis le module RH.
INSERT INTO public.employees (
  employee_number, full_name, position, department, email, phone,
  hire_date, contract_type, salary, status, address, notes
)
SELECT v.employee_number, v.full_name, v.position, v.department, v.email, v.phone,
       v.hire_date::date, v.contract_type, v.salary, 'actif', v.address,
       'Donnée démo phase 1 — à relier au compte utilisateur correspondant.'
FROM (VALUES
  ('EMP-DEMO-001', 'Grâce Mavoungou', 'Responsable commerciale', 'Commercial', 'grace.mavoungou@hubdistribution.demo', '+242 06 700 11 01', '2024-02-01', 'cdi', 450000, 'Makélékélé, Brazzaville'),
  ('EMP-DEMO-002', 'Patrick Ndzié', 'Magasinier principal', 'Logistique', 'patrick.ndzie@hubdistribution.demo', '+242 06 700 11 02', '2024-04-15', 'cdi', 320000, 'Talangaï, Brazzaville'),
  ('EMP-DEMO-003', 'Estelle Ibata', 'Responsable qualité', 'Qualité', 'estelle.ibata@hubdistribution.demo', '+242 06 700 11 03', '2024-06-03', 'cdi', 420000, 'Bacongo, Brazzaville'),
  ('EMP-DEMO-004', 'Junior Okemba', 'Agent de livraison', 'Logistique', 'junior.okemba@hubdistribution.demo', '+242 06 700 11 04', '2025-01-10', 'cdd', 250000, 'Ouenzé, Brazzaville'),
  ('EMP-DEMO-005', 'Nadia Kamba', 'Comptable', 'Finance', 'nadia.kamba@hubdistribution.demo', '+242 06 700 11 05', '2023-09-18', 'cdi', 480000, 'Poto-Poto, Brazzaville'),
  ('EMP-DEMO-006', 'Loïc Mabiala', 'Opérateur de production', 'Production', 'loic.mabiala@hubdistribution.demo', '+242 06 700 11 06', '2025-03-03', 'cdi', 290000, 'Djoué, Brazzaville'),
  ('EMP-DEMO-007', 'Sonia Tati', 'Assistante RH', 'RH', 'sonia.tati@hubdistribution.demo', '+242 06 700 11 07', '2025-07-01', 'cdd', 300000, 'Mfilou, Brazzaville'),
  ('EMP-DEMO-008', 'Armel Mvouama', 'Technicien informatique', 'Informatique', 'armel.mvouama@hubdistribution.demo', '+242 06 700 11 08', '2024-11-04', 'freelance', 350000, 'Kintélé, Brazzaville')
) AS v(employee_number, full_name, position, department, email, phone, hire_date, contract_type, salary, address)
WHERE NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.employee_number = v.employee_number);

INSERT INTO public.leave_balances (employee_id, year, total_days, used_days)
SELECT e.id, 2026, 30, 0
FROM public.employees e
WHERE e.employee_number LIKE 'EMP-DEMO-%'
ON CONFLICT (employee_id, year) DO NOTHING;

-- ── Facturation : génère un client comptoir pour les factures orphelines,
--    assure le stock requis, puis valide chaque facture en attente. Un tiers
--    est soldé et les deux autres sont réglés à 60 %, avec références PH1.
INSERT INTO public.clients (name, type, email, phone, address, notes)
SELECT 'Vente comptoir — HUB Distribution', 'client', 'comptoir@hubdistribution.demo',
       '+242 06 000 00 00', 'Brazzaville',
       'Client technique démo phase 1 pour régulariser les factures sans client.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.clients WHERE name = 'Vente comptoir — HUB Distribution'
);

DO $$
DECLARE
  v_validator uuid;
  v_fallback_client uuid;
  v_item record;
  v_invoice record;
  v_available numeric;
  v_payment numeric;
  v_index integer := 0;
BEGIN
  SELECT id INTO v_validator
  FROM public.profiles
  WHERE role IN ('ceo', 'admin', 'manager')
  ORDER BY CASE role WHEN 'ceo' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at
  LIMIT 1;

  SELECT id INTO v_fallback_client
  FROM public.clients
  WHERE name = 'Vente comptoir — HUB Distribution'
  LIMIT 1;

  UPDATE public.invoices
  SET client_id = v_fallback_client,
      notes = concat_ws(E'\n', notes, 'Client technique attribué — phase 1 démo.')
  WHERE client_id IS NULL AND v_fallback_client IS NOT NULL;

  -- Les lignes rattachées à un lot doivent d'abord disposer du stock de lot.
  FOR v_item IN
    SELECT ii.product_id, ii.batch_id, SUM(ii.quantity) AS required_quantity
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE i.status = 'pending' AND ii.product_id IS NOT NULL AND ii.batch_id IS NOT NULL
    GROUP BY ii.product_id, ii.batch_id
  LOOP
    SELECT quantity INTO v_available FROM public.product_batches WHERE id = v_item.batch_id;
    IF COALESCE(v_available, 0) < v_item.required_quantity THEN
      INSERT INTO public.stock_movements (
        product_id, batch_id, type, quantity, reason, reference_type, user_id, date
      ) VALUES (
        v_item.product_id, v_item.batch_id, 'IN', v_item.required_quantity - COALESCE(v_available, 0),
        'Complément de stock démo phase 1 avant validation des factures', 'phase1_demo', v_validator, CURRENT_DATE
      );
    END IF;
  END LOOP;

  -- Puis le stock global produit, y compris les lignes sans lot.
  FOR v_item IN
    SELECT ii.product_id, SUM(ii.quantity) AS required_quantity
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE i.status = 'pending' AND ii.product_id IS NOT NULL
    GROUP BY ii.product_id
  LOOP
    SELECT quantity INTO v_available FROM public.products WHERE id = v_item.product_id;
    IF COALESCE(v_available, 0) < v_item.required_quantity THEN
      INSERT INTO public.stock_movements (
        product_id, type, quantity, reason, reference_type, user_id, date
      ) VALUES (
        v_item.product_id, 'IN', v_item.required_quantity - COALESCE(v_available, 0),
        'Complément de stock démo phase 1 avant validation des factures', 'phase1_demo', v_validator, CURRENT_DATE
      );
    END IF;
  END LOOP;

  FOR v_invoice IN
    SELECT id, invoice_number, date, total
    FROM public.invoices
    WHERE status = 'pending'
    ORDER BY date, created_at, id
  LOOP
    v_index := v_index + 1;
    BEGIN
      UPDATE public.invoices
      SET status = 'approved',
          validated_by = v_validator,
          notes = concat_ws(E'\n', notes, 'Validée lors de la stabilisation phase 1 (données démo).')
      WHERE id = v_invoice.id;

      IF COALESCE(v_invoice.total, 0) > 0 THEN
        v_payment := CASE
          WHEN v_index % 3 = 0 THEN v_invoice.total
          ELSE ROUND(v_invoice.total * 0.60, 2)
        END;

        INSERT INTO public.invoice_payments (
          invoice_id, amount, payment_date, method, reference, notes, created_by
        )
        SELECT v_invoice.id, v_payment,
               LEAST(CURRENT_DATE, v_invoice.date + 10),
               CASE WHEN v_index % 2 = 0 THEN 'virement' ELSE 'mobile_money' END,
               'PH1-DEMO-' || LPAD(v_index::text, 3, '0'),
               'Paiement généré pour la démonstration phase 1.', v_validator
        WHERE NOT EXISTS (
          SELECT 1 FROM public.invoice_payments p
          WHERE p.invoice_id = v_invoice.id AND p.reference = 'PH1-DEMO-' || LPAD(v_index::text, 3, '0')
        );

        UPDATE public.invoices
        SET status = CASE WHEN v_payment >= v_invoice.total THEN 'paid' ELSE 'partial' END,
            payment_method = CASE WHEN v_index % 2 = 0 THEN 'virement' ELSE 'mobile_money' END,
            updated_at = now()
        WHERE id = v_invoice.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Facture % non régularisée durant la phase 1 : %', v_invoice.invoice_number, SQLERRM;
    END;
  END LOOP;
END $$;
