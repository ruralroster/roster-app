-- One-time backfill for migrations/2026-08-24 (Sync Fortnight on-call card
-- assignments into duty_assignments, see supabaseClient.js's
-- assignStaffFortnight) — that fix only runs on NEW Fortnight assignments
-- going forward, so any on-call card created via Fortnight before the fix
-- shipped still has no matching duty_assignments row. This finds every
-- such gap and fills it in.
--
-- For each (date, duty_type) that has staff_assignments on a card whose
-- activity matches that duty type's auto-created activity, picks the most
-- recently created assignment as the one to backfill (there should
-- normally be only one — an on-call slot is meant to hold one person —
-- but if more than one somehow ended up there, this doesn't silently
-- guess which is "right").
--
-- Deliberately ON CONFLICT DO NOTHING: this only fills in gaps, it never
-- overwrites a duty_assignments row that's already set (e.g. via the Duty
-- Assignments panel directly) — an officer's existing explicit assignment
-- always wins over whatever a card implies.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run (rows it
-- already backfilled will just conflict-skip the second time).

BEGIN;

INSERT INTO duty_assignments (department_id, date, duty_type, staff_id)
SELECT DISTINCT ON (ta.date, dt.key)
  ta.department_id, ta.date, dt.key, sa.staff_id
FROM staff_assignments sa
JOIN theatre_activities ta ON ta.theatre_activity_id = sa.theatre_activity_id
JOIN duty_types dt ON dt.activity_type_id = ta.activity_id AND dt.department_id = ta.department_id
ORDER BY ta.date, dt.key, sa.assignment_id DESC
ON CONFLICT (date, duty_type) DO NOTHING;

COMMIT;
