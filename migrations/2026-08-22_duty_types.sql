-- Configurable duty/on-call roster slots (the "Duty Assignments" panel at
-- the top of the Day view in officer-roster-view-supabase.jsx). Previously
-- hardcoded to exactly four types for every department (am_coordinator,
-- pm_coordinator, first_on_call, second_on_call), which doesn't fit
-- reality: a single-specialty department (e.g. Anaesthetics) just needs one
-- "On Call" slot; a rural generalist roster needs a separate on-call slot
-- per specialty it covers overnight (ED / Obstetrics / Anaesthetics), with
-- a combination covered by assigning the same person to more than one
-- slot; a full Emergency Department wants First/Second On Call plus
-- separate Tox and Paeds on-call slots. This table lets each department
-- define its own list in Settings instead.
--
-- duty_assignments.duty_type stays a free-text column that just happens to
-- match a duty_types.key for the same department — no FK, same loose
-- coupling as the shift_id-by-name lookups already used elsewhere in this
-- schema (e.g. the "Day Off" shift in shift_pattern_rules).
--
-- counts_as_on_call marks which slots should count toward the Fairness
-- Report's on-call tally and next-day fatigue-risk flagging
-- (getFairnessReport / getStaffFatigueStatus in supabaseClient.js, which
-- previously hardcoded first_on_call/second_on_call for this) — true for
-- actual overnight on-call slots, false for day-coordination roles like
-- AM/PM Coordinator.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF NOT
-- EXISTS / ON CONFLICT-guarded seed / DROP POLICY IF EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS duty_types (
  duty_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  key text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  counts_as_on_call boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(department_id, key)
);

-- Seed every existing department with the four types the app previously
-- hardcoded, so no existing roster changes until an officer deliberately
-- customises it in Settings.
INSERT INTO duty_types (department_id, key, label, sort_order, counts_as_on_call)
SELECT d.department_id, v.key, v.label, v.sort_order, v.counts_as_on_call
FROM departments d
CROSS JOIN (VALUES
  ('am_coordinator', 'AM Coordinator', 0, false),
  ('pm_coordinator', 'PM Coordinator', 1, false),
  ('first_on_call', 'First On Call', 2, true),
  ('second_on_call', 'Second On Call', 3, true)
) AS v(key, label, sort_order, counts_as_on_call)
ON CONFLICT (department_id, key) DO NOTHING;

-- Same "read = member, write = officer" shape as the other roster/reference
-- tables (see 2026-08-21_rls_policies_core_tables.sql).
ALTER TABLE duty_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "duty_types_select_department" ON duty_types;
CREATE POLICY "duty_types_select_department" ON duty_types
  FOR SELECT USING (is_department_member(department_id));

DROP POLICY IF EXISTS "duty_types_insert_officer" ON duty_types;
CREATE POLICY "duty_types_insert_officer" ON duty_types
  FOR INSERT WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "duty_types_update_officer" ON duty_types;
CREATE POLICY "duty_types_update_officer" ON duty_types
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "duty_types_delete_officer" ON duty_types;
CREATE POLICY "duty_types_delete_officer" ON duty_types
  FOR DELETE USING (is_department_officer(department_id));

COMMIT;
