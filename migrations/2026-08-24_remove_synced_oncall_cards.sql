-- Reverts the "duty types project themselves onto a Day-view card"
-- feature (see migrations/2026-08-23_duty_types_on_call_activity.sql) —
-- it was meant to show an on-call person under whichever
-- Morning/Afternoon/Night section their duty type's hours fell into, but
-- ended up showing under all three regardless of the actual times, and
-- cluttered the Day view. The Duty Assignments panel gets an on-call
-- summary (name + which duty types they cover) instead — see
-- officer-roster-view-supabase.jsx — so a Day-view card is no longer
-- needed at all.
--
-- This deletes any theatre_activities rows (and their staff_assignments)
-- that the old syncDutyOnCallActivity function created — identified
-- precisely as: at a location named "On Call", whose activity_id is one of
-- the activity_types a duty type auto-created for itself. Scoped this way
-- rather than "everything at the On Call location" so a location an
-- officer genuinely renamed to "On Call" for unrelated use, or manually
-- assigned some other activity to, is left untouched.
--
-- The app itself no longer creates these going forward — this is purely
-- cleaning up ones already created. duty_types.start_time/end_time/
-- shift_id/activity_type_id and the "On Call" location itself are left in
-- place (harmless unused metadata) rather than torn out.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

DELETE FROM staff_assignments
WHERE theatre_activity_id IN (
  SELECT ta.theatre_activity_id
  FROM theatre_activities ta
  JOIN locations l ON l.location_id = ta.location_id
  WHERE l.name = 'On Call'
    AND ta.activity_id IN (
      SELECT activity_type_id FROM duty_types WHERE activity_type_id IS NOT NULL
    )
);

DELETE FROM theatre_activities ta
USING locations l
WHERE ta.location_id = l.location_id
  AND l.name = 'On Call'
  AND ta.activity_id IN (
    SELECT activity_type_id FROM duty_types WHERE activity_type_id IS NOT NULL
  );

COMMIT;
