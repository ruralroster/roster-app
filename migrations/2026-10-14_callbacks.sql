-- On-call callbacks — a staff member who is currently inside one of their
-- own on-call duty windows (duty_assignments + duty_types.start_time/
-- end_time, counts_as_on_call) can tap "Call Active" in the staff view's
-- Variation tab, then "Call Complete" when they're done. Each row is one
-- call's start/end, for filling in the payroll variation (recall) form
-- later.
--
-- Deliberately NO patient details here: the MRN / patient name entered at
-- Call Complete is only ever written into a text file downloaded to the
-- staff member's own phone (see CallbackPanel.jsx) — never sent to the
-- database — so no patient identifiers are stored by the app at all.
--
-- ended_at NULL = call still in progress. Stored server-side (not just in
-- the browser) so the timer survives the app closing, the phone dying or
-- switching device mid-call.
--
-- Also requires every on-call duty type to have a start/end time from now
-- on (NOT VALID: existing rows without times are left alone until next
-- edited — Settings enforces the same rule in the UI).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- IF NOT EXISTS / DROP ... IF EXISTS throughout.

BEGIN;

CREATE TABLE IF NOT EXISTS callbacks (
  callback_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  staff_id uuid NOT NULL REFERENCES staff(staff_id),
  -- The duty_assignments row this call was made under. duty_date is the
  -- date the on-call *started* (an overnight 21:00-08:00 slot's 03:00 call
  -- still belongs to the previous evening's assignment).
  duty_date date NOT NULL,
  duty_type text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- At most one call in progress per person.
CREATE UNIQUE INDEX IF NOT EXISTS callbacks_one_open_per_staff
  ON callbacks (staff_id) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS callbacks_department_started
  ON callbacks (department_id, started_at);

ALTER TABLE callbacks ENABLE ROW LEVEL SECURITY;

-- A staff member can only log a call against one of their own on-call
-- duty assignments, and can see/edit/delete their own calls. Officers can
-- see every call in their department (read-only).
DROP POLICY IF EXISTS "callbacks_self_insert" ON callbacks;
CREATE POLICY "callbacks_self_insert" ON callbacks
  FOR INSERT WITH CHECK (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM duty_assignments da
      WHERE da.department_id = callbacks.department_id
        AND da.staff_id = callbacks.staff_id
        AND da.date = callbacks.duty_date
        AND da.duty_type = callbacks.duty_type
    )
  );

DROP POLICY IF EXISTS "callbacks_select" ON callbacks;
CREATE POLICY "callbacks_select" ON callbacks
  FOR SELECT USING (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
    OR is_department_officer(department_id)
  );

DROP POLICY IF EXISTS "callbacks_self_update" ON callbacks;
CREATE POLICY "callbacks_self_update" ON callbacks
  FOR UPDATE
  USING (staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid()))
  WITH CHECK (staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "callbacks_self_delete" ON callbacks;
CREATE POLICY "callbacks_self_delete" ON callbacks
  FOR DELETE USING (staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid()));

ALTER TABLE duty_types DROP CONSTRAINT IF EXISTS duty_types_on_call_needs_times;
ALTER TABLE duty_types ADD CONSTRAINT duty_types_on_call_needs_times
  CHECK (NOT counts_as_on_call OR (start_time IS NOT NULL AND end_time IS NOT NULL)) NOT VALID;

COMMIT;
