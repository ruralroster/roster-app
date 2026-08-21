-- Policies for the two tables staff genuinely self-edit (staff_availability,
-- volunteer_requests), plus SECURITY DEFINER RPCs for the specific fields on
-- `staff` itself that staff should be able to edit on their own row.
--
-- `staff` deliberately does NOT get a broad self-service UPDATE policy: that
-- row also carries fte/payroll_number/role/user_id/rank/active, none of
-- which a staff member should be able to touch. Postgres RLS is row-level,
-- not column-level, so the safe way to expose "edit just these columns,
-- only on your own row" is dedicated functions rather than a table-wide
-- policy — the same pattern the app already uses elsewhere for server-side
-- logic (validate_supervision, copy_week_activities in supabaseClient.js).
--
-- DO NOT RUN until 2026-08-21_rls_helper_functions.sql and
-- 2026-08-21_profiles_and_staff_auth_columns.sql have both run. Run this
-- whole file in the Supabase SQL Editor. Safe to re-run: DROP POLICY IF
-- EXISTS / CREATE OR REPLACE throughout.

BEGIN;

-- staff_availability: a staff member manages their own rows; an officer can
-- manage anyone's in their department (StaffAvailabilityTab.jsx already
-- lets officers set availability/leave on behalf of staff today).
ALTER TABLE staff_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_availability_self" ON staff_availability;
CREATE POLICY "staff_availability_self" ON staff_availability
  FOR ALL USING (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
  ) WITH CHECK (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "staff_availability_officer" ON staff_availability;
CREATE POLICY "staff_availability_officer" ON staff_availability
  FOR ALL USING (
    is_department_officer(department_id)
  ) WITH CHECK (
    is_department_officer(department_id)
  );

-- volunteer_requests: same self-or-officer shape as staff_availability, but
-- this table's base schema isn't tracked in this repo and wasn't confirmed
-- to have its own department_id column (it's reached via staff_id and
-- theatre_activity_id in supabaseClient.js, not a direct department_id
-- filter) — the officer-override policy below derives the department by
-- joining through theatre_activities. Verify the actual column list in the
-- Supabase dashboard before running; adjust if volunteer_requests does
-- carry its own department_id (simplify to match the staff_availability
-- policy above if so).
ALTER TABLE volunteer_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "volunteer_requests_self" ON volunteer_requests;
CREATE POLICY "volunteer_requests_self" ON volunteer_requests
  FOR ALL USING (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
  ) WITH CHECK (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "volunteer_requests_officer" ON volunteer_requests;
CREATE POLICY "volunteer_requests_officer" ON volunteer_requests
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM theatre_activities ta
      WHERE ta.theatre_activity_id = volunteer_requests.theatre_activity_id
        AND is_department_officer(ta.department_id)
    )
  );

-- update_my_*: the narrow, RPC-gated exceptions to "staff writes to `staff`
-- are officer-only". staffRosterView.jsx already lets a staff member
-- self-edit exactly four fields on their own row today — phone, email,
-- coffee_order, and activity_restrictions (opting out of activities they
-- can't/won't do) — via updateStaffPhone/updateStaffEmail/
-- updateStaffCoffeeOrder/updateStaffActivityRestrictions in
-- supabaseClient.js. Those go straight at the `staff` table, which becomes
-- officer-write-only once RLS is on, so each gets a matching self-service
-- RPC here, one per field (mirrors the existing one-function-per-field
-- shape rather than a single multi-field update, so a partial update never
-- has to guess whether an omitted param means "don't touch" or "clear to
-- null"). fte/payroll_number/cost_centre/position_id/role/user_id/
-- department_id/rank/active are deliberately NOT exposed here — those stay
-- officer-only. The WHERE ... AND user_id = auth.uid() guard on every
-- function is what stops someone passing another person's staff_id.

CREATE OR REPLACE FUNCTION update_my_phone(p_staff_id uuid, p_phone text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE staff SET phone = p_phone WHERE staff_id = p_staff_id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION update_my_email(p_staff_id uuid, p_email text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE staff SET email = p_email WHERE staff_id = p_staff_id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION update_my_coffee_order(p_staff_id uuid, p_coffee_order text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE staff SET coffee_order = p_coffee_order WHERE staff_id = p_staff_id AND user_id = auth.uid();
$$;

-- activity_restrictions stores activity *names* (text[]), not ids — matches
-- how updateStaffActivityRestrictions/handleRestrictionToggle already use
-- it in supabaseClient.js / staffRosterView.jsx (`.includes(activity.name)`).
CREATE OR REPLACE FUNCTION update_my_activity_restrictions(p_staff_id uuid, p_activity_names text[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE staff SET activity_restrictions = p_activity_names WHERE staff_id = p_staff_id AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION update_my_phone(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_my_email(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_my_coffee_order(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_my_activity_restrictions(uuid, text[]) TO authenticated;

COMMIT;
