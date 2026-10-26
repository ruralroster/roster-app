-- Visitors on a card without a place of their own — for district doctors
-- DR Roster books onto a roster-app card when they aren't staff here and
-- the job has no visitor place free (district-roster's
-- 2026-10-28d_book_on_card.sql). The officer approved them for the gap, so
-- the Planner fits them into an empty place for their role, or shows them
-- as an extra (layOutCard in src/plannerUtils.js).
--
--   place_id  now optional: NULL = no place of their own. The unique
--             (theatre_activity_id, place_id, slot) still holds for the
--             rest; NULLs never clash.
--   role      'consultant' / 'registrar' — which places they can take.
--   source    'dr_roster' for the ones DR Roster added, else NULL.
--
-- Run this whole file in the Supabase SQL Editor, before district-roster's
-- 2026-10-28d_book_on_card.sql. Safe to re-run.

BEGIN;

ALTER TABLE theatre_activity_visitors ALTER COLUMN place_id DROP NOT NULL;
ALTER TABLE theatre_activity_visitors ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE theatre_activity_visitors ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE theatre_activity_visitors DROP CONSTRAINT IF EXISTS theatre_activity_visitors_role_check;
ALTER TABLE theatre_activity_visitors ADD CONSTRAINT theatre_activity_visitors_role_check
  CHECK (role IS NULL OR role IN ('consultant', 'registrar'));

COMMIT;
