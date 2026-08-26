-- Adds an account-level "must change password" flag, set when an officer
-- generates a one-time temporary password for a staff member (a fallback
-- for when the normal invite email gets spam-filtered — see the
-- generate-temp-password Edge Function and the "One-Time Password" button
-- in StaffAccountsTab.jsx) and cleared once that person sets a real
-- password of their own via the existing SetPassword screen.
--
-- Lives on `profiles` (account-level) rather than `staff` (per-department)
-- since a single login can belong to more than one department's staff row.
--
-- `profiles` has no RLS policies at all (see
-- 2026-08-21_profiles_and_staff_auth_columns.sql), so reads/writes go
-- through SECURITY DEFINER functions scoped to auth.uid() — same pattern
-- as is_department_officer()/is_department_member() in
-- 2026-08-21_super_admin.sql — rather than relying on table-level grants.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- idempotent (IF NOT EXISTS / CREATE OR REPLACE).

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS must_reset_password boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION my_must_reset_password()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT must_reset_password FROM profiles WHERE user_id = auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION clear_my_must_reset_password()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE profiles SET must_reset_password = false WHERE user_id = auth.uid();
$$;

COMMIT;
