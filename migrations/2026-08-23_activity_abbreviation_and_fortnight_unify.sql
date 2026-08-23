-- Two changes to unify the Fortnight view with the Day view's real
-- staff_assignments/theatre_activities data instead of the separate,
-- disconnected staff_shift_allocations table (which only the Fortnight
-- view ever read or wrote — confirmed nothing else in the app touches it).
--
-- activity_types.abbreviation: a short display code (e.g. "A" for
-- Anaesthetics, "ED" for Emergency, "W" for Ward, "M" for Maternity), set
-- per activity in Settings → Activities. Used by the Fortnight grid's
-- abridged day cells (shift session code + this abbreviation) so a
-- person's day reads as e.g. "AM/ED" without needing to show the full
-- location/activity name or open the Day view. Optional — a NULL
-- abbreviation just means the cell shows the shift code alone.
--
-- staff_shift_allocations: dropped outright rather than migrated —
-- confirmed with the department there's only ever been one staff member's
-- worth of data in it, and it's being fully superseded by the Fortnight
-- view now reading/writing staff_assignments directly (see
-- assignStaffFortnight in supabaseClient.js). Postgres drops the table's
-- own RLS policies automatically along with it.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF NOT
-- EXISTS / IF EXISTS.

BEGIN;

ALTER TABLE activity_types
  ADD COLUMN IF NOT EXISTS abbreviation text;

DROP TABLE IF EXISTS staff_shift_allocations;

COMMIT;
