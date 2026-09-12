-- =====================================================================
-- HUB Distribution CRM — Phase 3 « Optimisation »
--
-- (2) Graphiques      → aucune modification de schéma (calcul à la volée)
-- (3) Réappro. auto   → aucune modification (purchases / purchase_items existent)
-- (4) Segmentation    → colonnes de segmentation sur clients
-- (5) Portail         → voir les colonnes d'accès partenaire ci-dessous
--
-- Strictement additif et idempotent : aucune colonne supprimée, aucune
-- ligne existante réécrite (les nouvelles colonnes restent NULL tant que la
-- segmentation n'a pas été recalculée depuis l'interface).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. SEGMENTATION CLIENTS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS segment text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS segment_score integer;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS orders_count integer;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS lifetime_value numeric;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS last_order_at date;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS segment_updated_at timestamptz;

-- Le CHECK tolère NULL (clients pas encore segmentés) et n'accepte que les
-- segments connus de l'application.
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_segment_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_segment_check
  CHECK (segment IS NULL OR segment IN ('vip', 'fidele', 'actif', 'inactif', 'prospect'));

CREATE INDEX IF NOT EXISTS idx_clients_segment ON public.clients (segment);
CREATE INDEX IF NOT EXISTS idx_clients_last_order ON public.clients (last_order_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 2. PORTAIL PARTENAIRES — accès self-service par compte
-- ─────────────────────────────────────────────────────────────────────
-- Un partenaire (client / fournisseur / institution) peut être relié à un
-- compte utilisateur pour consulter SES commandes et documents depuis le
-- portail public. La colonne reste NULL pour les partenaires non rattachés.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS portal_enabled boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS clients_user_id_key
  ON public.clients (user_id)
  WHERE user_id IS NOT NULL;

-- Un partenaire ne voit que sa propre fiche dans le portail.
DROP POLICY IF EXISTS "self_clients_own_select" ON public.clients;
CREATE POLICY "self_clients_own_select"
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Ses propres factures.
DROP POLICY IF EXISTS "self_invoices_own_select" ON public.invoices;
CREATE POLICY "self_invoices_own_select"
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
  );

-- Ses propres bons de livraison et documents rattachés.
DROP POLICY IF EXISTS "self_documents_own_select" ON public.documents;
CREATE POLICY "self_documents_own_select"
  ON public.documents
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
  );

-- Lignes des factures accessibles (nécessaire à l'affichage du détail).
DROP POLICY IF EXISTS "self_invoice_items_own_select" ON public.invoice_items;
CREATE POLICY "self_invoice_items_own_select"
  ON public.invoice_items
  FOR SELECT
  TO authenticated
  USING (
    invoice_id IN (
      SELECT i.id FROM public.invoices i
      JOIN public.clients c ON c.id = i.client_id
      WHERE c.user_id = auth.uid()
    )
  );

-- Paiements de ses factures (justificatifs).
DROP POLICY IF EXISTS "self_invoice_payments_own_select" ON public.invoice_payments;
CREATE POLICY "self_invoice_payments_own_select"
  ON public.invoice_payments
  FOR SELECT
  TO authenticated
  USING (
    invoice_id IN (
      SELECT i.id FROM public.invoices i
      JOIN public.clients c ON c.id = i.client_id
      WHERE c.user_id = auth.uid()
    )
  );

-- Commandes portail : l'ancienne politique laissait TOUT compte authentifié
-- lire et modifier toutes les commandes. On la remplace par :
--   • direction/RH : accès complet (page interne « Commandes portail ») ;
--   • partenaire   : uniquement les commandes passées avec son e-mail.
DROP POLICY IF EXISTS "portal_orders_auth_select" ON public.portal_orders;
DROP POLICY IF EXISTS "portal_orders_manager_select" ON public.portal_orders;
CREATE POLICY "portal_orders_manager_select"
  ON public.portal_orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ceo', 'manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "self_portal_orders_own_select" ON public.portal_orders;
CREATE POLICY "self_portal_orders_own_select"
  ON public.portal_orders
  FOR SELECT
  TO authenticated
  USING (
    lower(coalesce(customer_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    AND coalesce(customer_email, '') <> ''
  );

DROP POLICY IF EXISTS "portal_orders_auth_update" ON public.portal_orders;
DROP POLICY IF EXISTS "portal_orders_manager_update" ON public.portal_orders;
CREATE POLICY "portal_orders_manager_update"
  ON public.portal_orders
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ceo', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ceo', 'manager', 'admin')
    )
  );
