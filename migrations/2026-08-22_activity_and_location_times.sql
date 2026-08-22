-- Fixes the real gap behind the Morning/Afternoon/Night grouping bugs:
-- neither locations nor theatre_activities ever had their own explicit
-- times. Grouping was being inferred from a shared, reusable `shifts` row
-- (e.g. "Whole Day"), which can't represent reality once one location runs
-- different things at different times on the same day (e.g. Theatre 1 is
-- Endoscopy 08:00-12:00, then Dental 12:00-18:00 — one shared "Whole Day"
-- shift can't carry both).
--
-- locations.default_start_time / default_end_time: an optional per-location
-- default (Ward -> 08:00/18:00, Theatre -> 08:00/18:00, ED -> left NULL for
-- "always open") — purely a convenience pre-fill when creating a new
-- activity there, not an enforced constraint.
--
-- theatre_activities.start_time / end_time: the actual authority for which
-- Morning/Afternoon/Night section(s) an activity groups under (see
-- getSessionGroups in shiftSessionUtils.js) and directly editable per
-- activity from here on, independent of whatever shift template it's also
-- linked to (shift_id is kept — still used for shift naming, the
-- shift-pattern-rules engine, and the volunteer-shifts listing).
--
-- Existing activities get backfilled from their current shift's times so
-- nothing disappears from the day view — from then on, times are explicit
-- and independently editable per activity.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- IF NOT EXISTS / backfill only touches NULL rows.

BEGIN;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS default_start_time time,
  ADD COLUMN IF NOT EXISTS default_end_time time;

ALTER TABLE theatre_activities
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time;

UPDATE theatre_activities ta
SET start_time = s.start_time, end_time = s.end_time
FROM shifts s
WHERE ta.shift_id = s.shift_id AND ta.start_time IS NULL;

COMMIT;
