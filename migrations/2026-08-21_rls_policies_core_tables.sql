-- Enables Row Level Security and adds department-scoped policies for every
-- table that isn't self-service or the special departments/staff_availability
-- cases (handled in their own migrations). Shape, for every table below:
--   - SELECT: anyone active in the department can read (is_department_member)
--   - INSERT/UPDATE/DELETE: officers only (is_department_officer)
-- `assignment_history` is the one exception — it's a permanent audit log
-- (per existing code comments in supabaseClient.js), so it gets read-only
-- access for officers and no write policy for anon/authenticated at all.
--
-- DO NOT RUN THIS until every real staff member who needs access has a
-- linked account (staff.user_id populated) and correct role — see the
-- Sequencing section of the auth/PWA plan. Running this before that point
-- locks everyone out, since every policy below checks user_id = auth.uid()
-- via is_department_member/is_department_officer (added in
-- 2026-08-21_rls_helper_functions.sql, which must run first).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- DROP POLICY IF EXISTS before each CREATE POLICY.

BEGIN;

-- staff: read by department members, write by officers only. Everyone in
-- the department can see everyone else's name/rank (needed to render the
-- roster), but only officers can add/edit/deactivate staff records.
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_select_department" ON staff;
CREATE POLICY "staff_select_department" ON staff
  FOR SELECT USING (is_department_member(department_id));

DROP POLICY IF EXISTS "staff_write_officer" ON staff;
CREATE POLICY "staff_write_officer" ON staff
  FOR INSERT WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "staff_update_officer" ON staff;
CREATE POLICY "staff_update_officer" ON staff
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "staff_delete_officer" ON staff;
CREATE POLICY "staff_delete_officer" ON staff
  FOR DELETE USING (is_department_officer(department_id));

-- Repeat the "read = member, write = officer" shape for every other
-- roster/reference table.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'staff_assignments',
    'duty_assignments',
    'theatre_activities',
    'locations',
    'shifts',
    'activity_types',
    'leave_types',
    'staff_shift_allocations',
    'shift_pattern_rules'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_select_department" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s_select_department" ON %I FOR SELECT USING (is_department_member(department_id))',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS "%s_insert_officer" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s_insert_officer" ON %I FOR INSERT WITH CHECK (is_department_officer(department_id))',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS "%s_update_officer" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s_update_officer" ON %I FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id))',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS "%s_delete_officer" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s_delete_officer" ON %I FOR DELETE USING (is_department_officer(department_id))',
      t, t
    );
  END LOOP;
END $$;

-- assignment_history: officer-readable audit log, no policy-based writes at
-- all (rows are inserted by the app's service-level operations, not by a
-- broad authenticated-role policy).
ALTER TABLE assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignment_history_select_officer" ON assignment_history;
CREATE POLICY "assignment_history_select_officer" ON assignment_history
  FOR SELECT USING (is_department_officer(department_id));

COMMIT;

-- NOTE: this migration assumes every table listed has a `department_id`
-- column (confirmed by existing query patterns in supabaseClient.js for
-- all except assignment_history, whose base schema isn't in this repo —
-- verify assignment_history has department_id before running; if it
-- doesn't, that policy needs adjusting to derive the department some other
-- way, e.g. via a join).
