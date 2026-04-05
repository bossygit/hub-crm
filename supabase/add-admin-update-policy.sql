-- ─────────────────────────────────────────────────────
-- Permettre aux admin/ceo de modifier les profils
-- (changement de rôle, permissions, etc.)
-- Exécuter dans Supabase → SQL Editor
-- ─────────────────────────────────────────────────────

CREATE POLICY "profiles_admin_update" ON profiles FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role IN ('ceo', 'admin')
  )
);
