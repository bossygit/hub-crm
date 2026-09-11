-- =====================================================================
-- HUB Distribution CRM — Phase 2 « Activation »
--
-- Quatre chantiers, hors connexion e-commerce :
--   1. Bons de livraison liés aux factures  → aucune modif de schéma
--      (le lien documents.invoice_id existe déjà) ; voir l'UI.
--   2. Notifications stock bas + factures en retard → élargissement du
--      CHECK notifications.type.
--   3. Relances clients → table invoice_reminders + RLS.
--   4. Planification d'inventaire → colonnes de planification sur
--      inventory_sessions + statut 'planned'.
--
-- Strictement additif et idempotent : aucune colonne supprimée, aucune
-- ligne existante réécrite (les CHECK sont élargis, jamais restreints).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. NOTIFICATIONS — nouveaux types d'alerte
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    -- types existants (validation de documents)
    'invoice_pending', 'bl_pending', 'leave_pending', 'quote_pending',
    'quote_approved', 'quote_rejected', 'quote_converted',
    -- nouveaux types phase 2 (alerte + automatisation)
    'stock_low', 'invoice_overdue', 'reminder_sent', 'inventory_planned'
  ));

-- ─────────────────────────────────────────────────────────────────────
-- 2. RELANCES CLIENTS — historique des relances envoyées
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  level integer NOT NULL DEFAULT 1,
  channel text NOT NULL DEFAULT 'email',
  recipient_email text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  amount_due numeric,
  days_overdue integer,
  error text,
  sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminders_invoice
  ON public.invoice_reminders (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_client
  ON public.invoice_reminders (client_id, created_at DESC);

ALTER TABLE public.invoice_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_reminders_manager" ON public.invoice_reminders;
CREATE POLICY "invoice_reminders_manager"
  ON public.invoice_reminders
  FOR ALL
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

-- ─────────────────────────────────────────────────────────────────────
-- 3. INVENTAIRE — planification d'une séance
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.inventory_sessions ADD COLUMN IF NOT EXISTS scheduled_date date;
ALTER TABLE public.inventory_sessions
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_sessions ADD COLUMN IF NOT EXISTS schedule_notes text;

-- Le statut 'planned' s'ajoute sans retirer les valeurs existantes.
ALTER TABLE public.inventory_sessions DROP CONSTRAINT IF EXISTS inventory_sessions_status_check;
ALTER TABLE public.inventory_sessions
  ADD CONSTRAINT inventory_sessions_status_check
  CHECK (status IN ('planned', 'draft', 'approved', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_inventory_sessions_scheduled
  ON public.inventory_sessions (scheduled_date)
  WHERE status = 'planned';

-- ─────────────────────────────────────────────────────────────────────
-- 4. INDEX DE SCAN — factures ouvertes par échéance (alertes/relances)
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_invoices_due_open
  ON public.invoices (due_date)
  WHERE status IN ('pending', 'approved', 'partial');
