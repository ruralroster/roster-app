-- theatre_activities.required_grade — the level of doctor an unfilled
-- card needs, so a slot advertised for volunteering only reaches staff at
-- that level or above. Confirmed with the department 2026-10-13: "an SMO
-- shift should never be advertised to registrar or intern".
--
-- Set by the Excel import's "Add unnamed shifts as unfilled" option (a
-- row with shifts but no name becomes an empty card, graded by the sheet
-- section the row sits in — see importRosterWeek in supabaseClient.js).
-- NULL — every existing card, and every card created by hand — keeps
-- today's behaviour: eligibility decided by the offer's role alone.
--
--   'smo'       — only seniors (a rank with requires_supervision = false)
--   'registrar' — seniors and registrars, never interns
--   'intern'    — anyone
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE theatre_activities
  ADD COLUMN IF NOT EXISTS required_grade text;

ALTER TABLE theatre_activities DROP CONSTRAINT IF EXISTS theatre_activities_required_grade_check;
ALTER TABLE theatre_activities
  ADD CONSTRAINT theatre_activities_required_grade_check
  CHECK (required_grade IS NULL OR required_grade IN ('smo', 'registrar', 'intern'));

COMMIT;
