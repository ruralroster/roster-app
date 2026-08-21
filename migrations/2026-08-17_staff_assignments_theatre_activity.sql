-- Fix: staff_assignments could only be looked up by (location_id, role),
-- with no link to which theatre_activity they belonged to. That's fine when
-- a location only ever has one activity a day, but breaks as soon as it has
-- two (e.g. a Day activity and a separate Night activity at the same
-- location) — assigning a consultant to the night one silently overwrote
-- the day one's assignment instead of creating an independent one, and
-- deleting either activity wiped BOTH their staff. This column gives each
-- assignment an explicit link to its activity so the two stay independent.
-- Run this whole file in the Supabase SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run: idempotent (IF NOT EXISTS).

BEGIN;

ALTER TABLE staff_assignments
  ADD COLUMN IF NOT EXISTS theatre_activity_id uuid REFERENCES theatre_activities(theatre_activity_id) ON DELETE CASCADE;

COMMIT;

-- NOTE on existing rows: this column is nullable, and rows created before
-- this migration will have it NULL. The app code falls back to the old
-- location+role matching for those specific rows so they don't disappear
-- from the roster — but that fallback can't disambiguate two activities at
-- the same location for a NULL row, so if you have any of those, re-assign
-- the staff on the affected day(s) once after running this. Any assignment
-- made or edited from that point on is stamped with theatre_activity_id
-- automatically and behaves correctly.
--
-- NOTE on Row Level Security: if RLS is enabled on staff_assignments with a
-- policy granting the anon role read/write, adding a column doesn't change
-- that — no policy changes needed here.
