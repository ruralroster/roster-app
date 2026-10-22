-- Fixes for the Supabase Security Advisor warnings of 2026-10-22.
--
--   1. function_search_path_mutable — pin search_path on the three
--      functions that don't set it. copy_week_activities and
--      log_assignment_to_history predate migration tracking (their
--      definitions aren't in this repo), so this sets it on every
--      overload by name rather than guessing their signatures.
--      copy_week_activities is no longer called by the app (see
--      copyDayActivities in supabaseClient.js) but is left in place.
--
--   2. anon_security_definer_function_executable — Supabase grants EXECUTE
--      to anon on new functions by default, so a REVOKE ... FROM PUBLIC
--      alone doesn't stop it. Every function listed already does nothing
--      for someone signed out (each checks auth.uid()), so this is tidying
--      rather than closing a hole. is_department_member and
--      is_department_officer are deliberately left callable by anon: RLS
--      policies call them, and revoking would turn a signed-out query's
--      "no rows" into a permission error.
--
--   The authenticated_security_definer_function_executable warnings are
--   intended: these are the self-service functions signed-in staff call to
--   change their own row, and each only touches the caller's own data.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('copy_week_activities', 'log_assignment_to_history', 'validate_supervision')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION clear_my_must_reset_password() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION my_must_reset_password() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION get_staff_off_days(uuid, date, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION set_my_notify_email(uuid, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_my_activity_restrictions(uuid, text[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_my_coffee_order(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_my_phone(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_my_preferred_view(uuid, text) FROM anon, PUBLIC;

-- Signed-in users keep them (re-granted in case PUBLIC was their only route).
GRANT EXECUTE ON FUNCTION clear_my_must_reset_password() TO authenticated;
GRANT EXECUTE ON FUNCTION my_must_reset_password() TO authenticated;
GRANT EXECUTE ON FUNCTION get_staff_off_days(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION set_my_notify_email(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION update_my_activity_restrictions(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION update_my_coffee_order(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_my_phone(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_my_preferred_view(uuid, text) TO authenticated;

COMMIT;
