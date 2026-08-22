-- Drops theatre_activities_date_location_id_shift_id_key — a leftover from
-- before a location could run more than one activity on the same day (see
-- migrations/2026-08-22_activity_and_location_times.sql: "Theatre 1 is
-- Endoscopy 08:00-12:00, then Dental 12:00-18:00"). It enforced exactly one
-- theatre_activities row per (date, location_id, shift_id), but shift_id
-- here is only the session-matched shift used for naming/pattern-rules
-- (see handleAddActivity's comment in officer-roster-view-supabase.jsx) —
-- so two different activities added to the same location under the same
-- session (e.g. an ED activity and a separate On Call activity, both
-- landing on the "night" shift) collide on insert: "duplicate key value
-- violates unique constraint theatre_activities_date_location_id_shift_id_key".
--
-- Same fix, same reasoning, as
-- migrations/2026-08-22_drop_staff_assignments_unique_constraint.sql: no
-- replacement constraint needed — each row is already uniquely identified
-- by theatre_activity_id, and createTheatreActivity is a plain insert (no
-- onConflict anywhere in supabaseClient.js targets this constraint).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF
-- EXISTS.

BEGIN;

ALTER TABLE theatre_activities
  DROP CONSTRAINT IF EXISTS theatre_activities_date_location_id_shift_id_key;

COMMIT;
