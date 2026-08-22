-- Lets an officer default to the plain staff view (their own schedule)
-- instead of the officer/admin view, since most officers are also working
-- staff, not purely administrative — App.js still lets them switch to the
-- other view for the rest of the session; this just controls what they see
-- right after login. Defaults to 'officer' so nobody's current behavior
-- changes until they explicitly pick 'staff'. Meaningless for staff-role
-- rows (App.js only ever shows them the staff view regardless), so no
-- constraint ties it to role.
--
-- Run this after 2026-08-21_rls_policies_self_service.sql (reuses its
-- self-service-RPC pattern). Run this whole file in the Supabase SQL
-- Editor. Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE throughout.

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS preferred_view text NOT NULL DEFAULT 'officer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_preferred_view_check'
  ) THEN
    ALTER TABLE staff ADD CONSTRAINT staff_preferred_view_check CHECK (preferred_view IN ('staff', 'officer'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION update_my_preferred_view(p_staff_id uuid, p_view text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE staff SET preferred_view = p_view WHERE staff_id = p_staff_id AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION update_my_preferred_view(uuid, text) TO authenticated;

COMMIT;
