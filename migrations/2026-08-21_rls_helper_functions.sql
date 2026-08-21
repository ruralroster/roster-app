-- Two helper functions used by every RLS policy added in the migrations
-- that follow, and also called via RPC from the invite-staff Edge Function
-- (so the Edge Function's "is this caller allowed to invite for this
-- department" check reuses the exact same logic as the database policies,
-- instead of re-deriving it in TypeScript).
--
-- Both are SECURITY DEFINER (so they can read `staff` regardless of the
-- caller's own row-level access) with `SET search_path = public` pinned
-- explicitly — required on SECURITY DEFINER functions to avoid the
-- classic Postgres search-path-hijack risk (a caller creating an object
-- earlier in their search_path that shadows a table this function
-- queries).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- CREATE OR REPLACE.

BEGIN;

CREATE OR REPLACE FUNCTION is_department_member(dept_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
    WHERE user_id = auth.uid()
      AND department_id = dept_id
      AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION is_department_officer(dept_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
    WHERE user_id = auth.uid()
      AND department_id = dept_id
      AND role = 'officer'
      AND active = true
  );
$$;

GRANT EXECUTE ON FUNCTION is_department_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_department_officer(uuid) TO authenticated;

COMMIT;
