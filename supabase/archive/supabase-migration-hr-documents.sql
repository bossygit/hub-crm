-- =====================================================
-- HUB Distribution — Migration Documents RH
-- Contrats, Attestations, Fiches de paie, Conges
-- A executer dans Supabase SQL Editor
-- =====================================================

-- 1. Colonnes supplementaires sur employee_documents
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS content jsonb DEFAULT '{}';
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft';
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_status_check;
ALTER TABLE employee_documents ADD CONSTRAINT employee_documents_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected'));

-- 2. Table leave_balances (soldes conge par employe et par annee)
CREATE TABLE IF NOT EXISTS leave_balances (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  year integer NOT NULL DEFAULT extract(year FROM now())::integer,
  total_days integer NOT NULL DEFAULT 30,
  used_days integer NOT NULL DEFAULT 0,
  remaining_days integer GENERATED ALWAYS AS (total_days - used_days) STORED,
  created_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, year)
);

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leave_balances_all" ON leave_balances FOR ALL USING (auth.role() = 'authenticated');

-- 3. Trigger : mise a jour solde conge quand demande approuvee/rejetee
CREATE OR REPLACE FUNCTION process_leave_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  days_count integer;
  current_yr integer;
BEGIN
  IF OLD.type != 'conge' OR NEW.type != 'conge' THEN
    RETURN NEW;
  END IF;

  current_yr := extract(year FROM COALESCE(NEW.start_date, now()))::integer;

  -- Calculer jours ouvres (approximation : jours calendaires sans weekends)
  IF NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL THEN
    days_count := 0;
    FOR i IN 0..(NEW.end_date - NEW.start_date) LOOP
      IF extract(dow FROM NEW.start_date + i) NOT IN (0, 6) THEN
        days_count := days_count + 1;
      END IF;
    END LOOP;
  ELSE
    days_count := 1;
  END IF;

  -- Creer le solde de l'annee s'il n'existe pas
  INSERT INTO leave_balances (employee_id, year) VALUES (NEW.employee_id, current_yr)
  ON CONFLICT (employee_id, year) DO NOTHING;

  -- Approbation : incrementer jours utilises
  IF (OLD.status IS DISTINCT FROM 'approved') AND NEW.status = 'approved' THEN
    UPDATE leave_balances SET used_days = used_days + days_count
    WHERE employee_id = NEW.employee_id AND year = current_yr;
  END IF;

  -- Rejet apres approbation : restaurer les jours
  IF OLD.status = 'approved' AND NEW.status = 'rejected' THEN
    UPDATE leave_balances SET used_days = GREATEST(0, used_days - days_count)
    WHERE employee_id = NEW.employee_id AND year = current_yr;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_approval ON employee_documents;
CREATE TRIGGER on_leave_approval
  BEFORE UPDATE ON employee_documents
  FOR EACH ROW EXECUTE FUNCTION process_leave_approval();

-- 4. Index
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_type ON employee_documents(type);
CREATE INDEX IF NOT EXISTS idx_employee_documents_status ON employee_documents(status);
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances(employee_id);
