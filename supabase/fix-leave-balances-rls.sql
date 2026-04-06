-- Correction RLS leave_balances : restreindre aux managers
-- A executer sur la base Supabase de production via le SQL Editor

DROP POLICY IF EXISTS "leave_balances_all" ON leave_balances;

CREATE POLICY "leave_balances_manager" ON leave_balances FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('ceo', 'manager', 'admin')
  )
);
