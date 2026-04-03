-- =====================================================
-- HUB Distribution — Migration Notifications
-- Table notifications + RLS
-- A executer dans Supabase SQL Editor
-- =====================================================

CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('invoice_pending','bl_pending','leave_pending','quote_pending')),
  title text NOT NULL,
  message text,
  reference_id uuid,
  reference_type text,
  link text,
  is_read boolean DEFAULT false,
  recipient_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (recipient_id = auth.uid());

CREATE POLICY "notifications_update" ON notifications
  FOR UPDATE USING (recipient_id = auth.uid());

CREATE POLICY "notifications_insert" ON notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
