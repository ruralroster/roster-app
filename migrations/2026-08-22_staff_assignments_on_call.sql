-- Lets a consultant assignment be marked "on call" (rostered as the
-- supervising consultant for a location, but not physically present) rather
-- than only ever "present". Supports the new multi-person-per-location
-- staffing model in officer-roster-view-supabase.jsx, where the "is there a
-- supervising consultant?" check at Complete Allocation counts an on-call
-- consultant as satisfying supervision, same as a present one.
--
-- Meaningless for non-consultant rows — nothing enforces that; the app
-- simply never sets it true for role != 'consultant'.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF NOT
-- EXISTS.

BEGIN;

ALTER TABLE staff_assignments
  ADD COLUMN IF NOT EXISTS on_call boolean NOT NULL DEFAULT false;

COMMIT;
