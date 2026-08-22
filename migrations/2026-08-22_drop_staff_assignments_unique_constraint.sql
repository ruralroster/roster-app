-- Drops staff_assignments_date_location_id_shift_id_role_key — a leftover
-- from the old fixed one-consultant/one-registrar-per-activity model,
-- enforcing exactly one row per (date, location_id, shift_id, role). That's
-- incompatible with the multi-person-per-location model added in "Allow
-- multiple staff per location, with on-call consultants": two consultants
-- on the same location/date/shift is now a legitimate, intended case, and
-- this constraint was blocking Complete Allocation from ever inserting the
-- second one ("duplicate key value violates unique constraint
-- staff_assignments_date_location_id_shift_id_role_key").
--
-- No replacement constraint — each row is already uniquely identified by
-- assignment_id, and the app's own add-picker already excludes staff
-- already on the activity in that role from being re-added.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF
-- EXISTS.

BEGIN;

ALTER TABLE staff_assignments
  DROP CONSTRAINT IF EXISTS staff_assignments_date_location_id_shift_id_role_key;

COMMIT;
