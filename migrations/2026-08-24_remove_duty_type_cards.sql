-- Run this AFTER migrations/2026-08-24_backfill_duty_assignments_from_cards.sql
-- (that one must run first, or the information on these cards is lost
-- rather than carried over to duty_assignments).
--
-- assignStaffFortnight was still creating a normal theatre_activities card
-- whenever a duty type's auto-created activity (e.g. "ED On-Call") was
-- picked in the Fortnight wizard — that's a real card, so it still showed
-- up grouped into Morning/Afternoon/Night, the exact thing duty types were
-- supposed to stop doing. That's now fixed going forward (assignStaffFortnight
-- only writes to duty_assignments for these, no card), but doesn't touch
-- cards already created that way.
--
-- This is broader than the earlier
-- migrations/2026-08-24_remove_synced_oncall_cards.sql cleanup, which only
-- caught cards at a location literally named "On Call" (the old duty->card
-- projection always used that one location) — Fortnight lets an officer
-- pick ANY location, so this matches purely on the activity instead:
-- wherever a theatre_activities row's activity_id is one a duty type
-- auto-created for itself, regardless of location.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

DELETE FROM staff_assignments
WHERE theatre_activity_id IN (
  SELECT ta.theatre_activity_id
  FROM theatre_activities ta
  JOIN duty_types dt ON dt.activity_type_id = ta.activity_id AND dt.department_id = ta.department_id
);

DELETE FROM theatre_activities ta
USING duty_types dt
WHERE dt.activity_type_id = ta.activity_id
  AND dt.department_id = ta.department_id;

COMMIT;
