-- Flips the practical default for staff_availability from "unset = not
-- available" (the existing convention — see src/availabilityUtils.js
-- getAvailabilityState and src/supabaseClient.js getStaffAvailabilityForDate/
-- getAvailableShiftsForStaff, both of which deliberately treat a missing
-- row as unconfirmed/unavailable, never as available) to "available
-- unless someone explicitly says otherwise," for staff that already exist
-- today.
--
-- One-time backfill only: every current staff member, every department,
-- gets available=true rows from 2026-10-01 through 2031-10-01 (5 years) —
-- ON CONFLICT DO NOTHING, so any date already explicitly set (true OR
-- false, e.g. imported leave, a recurring day-off template, a manually
-- marked unavailable day) is left untouched.
--
-- New staff created after this runs get the same 5-years-of-available
-- seeding from application code instead of a DB trigger — see createStaff
-- in src/supabaseClient.js and the staff-insert branch of
-- supabase/functions/invite-staff/index.ts. The DROP statements below
-- clean up an earlier version of this migration that used a trigger, in
-- case that version was already applied.
--
-- "Always" is approximated as a 5-year rolling window (same kind of edge
-- the app's own recurring-availability materialization already has, see
-- MATERIALIZATION_MONTHS_AHEAD in src/availabilityUtils.js) — re-run the
-- backfill below periodically (or extend it) before 2031-10-01 to keep
-- the horizon rolling forward for staff created before this file existed;
-- it's safe to re-run any time.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

DROP TRIGGER IF EXISTS trg_default_staff_availability ON staff;
DROP FUNCTION IF EXISTS public.seed_default_staff_availability();

INSERT INTO staff_availability (department_id, staff_id, date, available)
SELECT s.department_id, s.staff_id, d::date, true
FROM staff s
CROSS JOIN generate_series(
  '2026-10-01'::timestamp,
  '2026-10-01'::timestamp + interval '5 years',
  interval '1 day'
) AS d
ON CONFLICT (staff_id, date) DO NOTHING;

COMMIT;
