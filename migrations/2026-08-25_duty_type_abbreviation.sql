-- Short abbreviation for a duty type (e.g. "A" for Anaesthetics On Call, "O"
-- for Obstetrics On Call) — shown on the main Calendar's orange "on-call
-- short" indicator, so an officer can see at a glance which of the
-- department's on-call slots isn't filled without opening the day.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: ADD
-- COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE duty_types ADD COLUMN IF NOT EXISTS abbreviation TEXT;

COMMIT;
