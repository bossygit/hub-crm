-- =====================================================================
-- HUB Distribution CRM — RH lot 1 : présences + fiabilisation des soldes
-- de congés.
--
-- À exécuter UNE FOIS dans le SQL Editor Supabase (ou `supabase db push`).
-- Idempotent : peut être relancé sans erreur.
--
-- Contenu :
--   1. attendance : FK corrigée (employees et non profiles), colonnes de
--      pointage (check_in/check_out/hours_worked/overtime_hours) et RLS
--      (RH = accès complet, salarié = lecture de SES pointages).
--   2. Congés : le solde n'est débité QUE par le congé annuel ; le calcul
--      est idempotent et se recalcule à l'insertion, la modification et la
--      suppression (corrige : suppression d'un congé approuvé, modification
--      des dates, types maladie / sans solde / maternité qui débitaient).
--   3. RPC `hr_ensure_leave_balances` : initialise le droit annuel de tous
--      les employés actifs pour une année.
--
-- Les fonctions exposées sont préfixées hr_ et n'entrent pas en conflit
-- avec l'existant.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. TABLE ATTENDANCE
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid,
  date date NOT NULL DEFAULT CURRENT_DATE,
  status text DEFAULT 'present'
    CHECK (status IN ('present', 'absent', 'late', 'leave', 'holiday')),
  check_in time,
  check_out time,
  hours_worked numeric(6,2),
  overtime_hours numeric(6,2) DEFAULT 0,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (employee_id, date)
);

-- Colonnes manquantes sur une table déjà déployée.
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS check_in time;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS check_out time;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS hours_worked numeric(6,2);
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS overtime_hours numeric(6,2) DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- La table historique référençait profiles(id) alors que tout le RH
-- s'appuie sur employees(id) : on rebranche sur les fiches employés.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.attendance'::regclass
      AND contype = 'f'
      AND confrelid = 'public.profiles'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.attendance DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_employee_id_fkey;
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE NOT VALID;

-- (l'unicité (employee_id, date) est portée par la contrainte de la table)
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_employee ON public.attendance(employee_id);

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

-- L'ancienne politique ouvrait l'écriture à tout compte authentifié.
DROP POLICY IF EXISTS "attendance_all" ON public.attendance;

DROP POLICY IF EXISTS "attendance_manager" ON public.attendance;
CREATE POLICY "attendance_manager"
  ON public.attendance
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

-- Un salarié peut consulter ses propres pointages (aucune écriture).
DROP POLICY IF EXISTS "self_attendance_own_select" ON public.attendance;
CREATE POLICY "self_attendance_own_select"
  ON public.attendance
  FOR SELECT
  TO authenticated
  USING (
    employee_id IN (
      SELECT id FROM public.employees WHERE user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 2. CONGÉS — SOURCE UNIQUE DE VÉRITÉ DU SOLDE
-- ─────────────────────────────────────────────────────────────────────
-- Types de congé qui débitent le solde annuel.
-- ⚠️ Doit rester synchronisé avec `consumesBalance` dans lib/hr/leaves.ts.
-- Pour ajouter le congé exceptionnel au débit : = 'annuel' OR = 'exceptionnel'.
CREATE OR REPLACE FUNCTION public.hr_is_balance_leave(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(NULLIF(p_type, ''), 'annuel') = 'annuel';
$$;

-- Jours ouvrés (lundi→vendredi) bornes incluses, hors jours fériés.
CREATE OR REPLACE FUNCTION public.hr_working_days(p_start date, p_end date)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN 0
    ELSE (
      SELECT COUNT(*)::integer
      FROM generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') AS d
      WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    )
  END;
$$;

-- Recalcule intégralement used_days pour un employé et une année.
-- Idempotent : pas de delta, donc pas de dérive possible.
CREATE OR REPLACE FUNCTION public.hr_recalc_leave_balance(p_employee uuid, p_year integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used integer;
BEGIN
  IF p_employee IS NULL OR p_year IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN (d.content ->> 'days') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN GREATEST(ROUND((d.content ->> 'days')::numeric), 0)::integer
      ELSE public.hr_working_days(d.start_date, d.end_date)
    END
  ), 0)::integer
  INTO v_used
  FROM public.employee_documents d
  WHERE d.employee_id = p_employee
    AND d.type = 'conge'
    AND d.status = 'approved'
    AND public.hr_is_balance_leave(d.content ->> 'leave_type')
    AND EXTRACT(YEAR FROM COALESCE(d.start_date, d.created_at::date, CURRENT_DATE))::integer = p_year;

  -- Crée la ligne de solde si absente (droit annuel par défaut : 30 jours).
  INSERT INTO public.leave_balances (employee_id, year, used_days)
  VALUES (p_employee, p_year, v_used)
  ON CONFLICT (employee_id, year)
  DO UPDATE SET used_days = EXCLUDED.used_days;
END;
$$;

-- Trigger unique INSERT / UPDATE / DELETE : recalcule les années impactées
-- (ancienne et nouvelle), y compris à la suppression d'un congé approuvé.
CREATE OR REPLACE FUNCTION public.process_leave_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.type = 'conge' THEN
      PERFORM public.hr_recalc_leave_balance(
        OLD.employee_id,
        EXTRACT(YEAR FROM COALESCE(OLD.start_date, OLD.created_at::date, CURRENT_DATE))::integer
      );
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.type = 'conge' THEN
    PERFORM public.hr_recalc_leave_balance(
      NEW.employee_id,
      EXTRACT(YEAR FROM COALESCE(NEW.start_date, NEW.created_at::date, CURRENT_DATE))::integer
    );
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.type = 'conge' THEN
    PERFORM public.hr_recalc_leave_balance(
      OLD.employee_id,
      EXTRACT(YEAR FROM COALESCE(OLD.start_date, OLD.created_at::date, CURRENT_DATE))::integer
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_approval ON public.employee_documents;
CREATE TRIGGER on_leave_approval
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_documents
  FOR EACH ROW EXECUTE FUNCTION public.process_leave_approval();

-- ─────────────────────────────────────────────────────────────────────
-- 3. BACKFILL — réaligne les soldes sur les congés réellement approuvés.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT employee_id, year FROM public.leave_balances
    UNION
    SELECT employee_id,
           EXTRACT(YEAR FROM COALESCE(start_date, created_at::date, CURRENT_DATE))::integer AS year
    FROM public.employee_documents
    WHERE type = 'conge' AND status = 'approved'
  LOOP
    PERFORM public.hr_recalc_leave_balance(r.employee_id, r.year);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. RPC — initialisation du droit annuel pour tous les employés actifs.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_ensure_leave_balances(
  p_year integer DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::integer,
  p_total_days integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_count integer;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('ceo', 'manager', 'admin') THEN
    RAISE EXCEPTION 'Acces refuse';
  END IF;

  INSERT INTO public.leave_balances (employee_id, year, total_days)
  SELECT e.id, p_year, GREATEST(COALESCE(p_total_days, 30), 0)
  FROM public.employees e
  WHERE e.status <> 'sorti'
  ON CONFLICT (employee_id, year) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_ensure_leave_balances(integer, integer) TO authenticated;
