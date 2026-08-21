-- Adds a super-admin escape hatch for a handful of real people (you) who
-- need officer access across every department, including ones that don't
-- exist yet — not modeled as a `staff` row per department (that only
-- covers departments that already exist at invite time), but as a flag on
-- the auth identity itself.
--
-- Run this after 2026-08-21_profiles_and_staff_auth_columns.sql and
-- 2026-08-21_rls_helper_functions.sql (both must exist first). Safe to
-- re-run: IF NOT EXISTS / CREATE OR REPLACE throughout.

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION is_department_member(dept_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND is_super_admin)
    OR EXISTS (
      SELECT 1 FROM staff
      WHERE user_id = auth.uid() AND department_id = dept_id AND active = true
    );
$$;

CREATE OR REPLACE FUNCTION is_department_officer(dept_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND is_super_admin)
    OR EXISTS (
      SELECT 1 FROM staff
      WHERE user_id = auth.uid() AND department_id = dept_id AND role = 'officer' AND active = true
    );
$$;

COMMIT;

-- To make yourself a super admin after accepting your invite:
--   UPDATE profiles SET is_super_admin = true WHERE email = 'you@example.com';
-- No `staff` row is needed — supabaseClient.js's getMyMemberships()
-- synthesizes a membership list straight from `departments` for anyone
-- with is_super_admin = true, so the flag alone is enough to log in and
-- see every department.
