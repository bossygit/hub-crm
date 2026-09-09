-- =====================================================================
-- HUB Distribution CRM — Self-service employé « Mes congés »
-- Liaison employé <-> compte auth + RLS additive, minimal et sécurisé
--
-- À exécuter UNE FOIS dans le SQL Editor Supabase (ou psql).
-- Idempotent : peut être relancé sans erreur.
--
-- ADDITIF STRICT : ne modifie ni ne supprime AUCUNE politique existante
-- (employees_manager, emp_docs_manager, leave_balances_manager, ...).
-- Les nouvelles politiques sont préfixées self_ et n'accordent que :
--   • à un employé la LECTURE de SA propre fiche employé ;
--   • à un employé la LECTURE de SES documents RH et SES soldes de congés ;
--   • à un employé la CRÉATION de demandes de congé (type='conge',
--     statut='pending') rattachées à SA propre fiche uniquement.
-- Toute écriture, approbation ou suppression reste réservée aux rôles RH
-- (ceo, manager, admin) via les politiques existantes.
--
-- NOTE : si la création de l'index unique échoue (doublons user_id
-- existants), corriger les doublons d'abord, puis relancer ce fichier.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Unicité de la liaison employé <-> compte utilisateur
--    (la colonne employees.user_id existe déjà via setup.sql ;
--     on garantit ici 1 compte <=> 1 fiche employé)
-- ─────────────────────────────────────────────────────────────
-- Garde-fou : s'assure que la colonne existe avant l'index (idempotent).
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employees_user_id_key
  ON public.employees (user_id)
  WHERE user_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. employees — un employé peut lire SA propre fiche.
--    (ceo/manager/admin gardent l'accès complet « employees_manager »)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "self_employees_own_select" ON public.employees;
CREATE POLICY "self_employees_own_select"
  ON public.employees
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 3. employee_documents — lecture de SES documents +
--    création de SES demandes de congé (statut bloqué à 'pending',
--    type bloqué à 'conge', fiche forcée à la sienne).
--    Les documents des autres employés restent invisibles.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "self_emp_docs_own_select" ON public.employee_documents;
CREATE POLICY "self_emp_docs_own_select"
  ON public.employee_documents
  FOR SELECT
  TO authenticated
  USING (
    employee_id IN (
      SELECT id FROM public.employees WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "self_emp_docs_own_insert" ON public.employee_documents;
CREATE POLICY "self_emp_docs_own_insert"
  ON public.employee_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    type = 'conge'
    AND status = 'pending'
    AND employee_id IN (
      SELECT id FROM public.employees WHERE user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 4. leave_balances — un employé consulte SES soldes de congés.
--    (ceo/manager/admin gardent l'accès complet « leave_balances_manager »)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "self_leave_balances_own_select" ON public.leave_balances;
CREATE POLICY "self_leave_balances_own_select"
  ON public.leave_balances
  FOR SELECT
  TO authenticated
  USING (
    employee_id IN (
      SELECT id FROM public.employees WHERE user_id = auth.uid()
    )
  );
