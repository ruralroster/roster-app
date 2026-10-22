-- profiles had row level security switched off (Security Advisor ERROR
-- rls_disabled_in_public). 2026-08-21_profiles_and_staff_auth_columns.sql
-- deliberately left it off until staff were linked, and nothing turned it
-- on later. Without it, anyone with the app's public anon key — which is
-- in the website itself — could read every login's email and set
-- is_super_admin or must_reset_password on any row, signed in or not.
--
-- After this:
--   - a signed-in user can read only their own row (getMyMemberships reads
--     is_super_admin; the super-admin RLS checks read the caller's row);
--   - nobody can write from the browser. The invite-staff,
--     generate-temp-password and update-staff-email Edge Functions write
--     with the service role key, which bypasses RLS, and
--     my_must_reset_password / clear_my_must_reset_password are SECURITY
--     DEFINER, so all of those keep working.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_self" ON profiles;
CREATE POLICY "profiles_select_self" ON profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Belt and braces alongside RLS: no table privileges for the signed-out
-- role at all, and read-only for signed-in users.
REVOKE ALL ON profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON profiles FROM authenticated;

COMMIT;
