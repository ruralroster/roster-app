-- On call goes with a shift: it follows on from one that day (the ED late
-- into ED on call) or comes before one the next morning. Each on-call
-- duty type can list those shifts; the Day view's on-call picker then puts
-- whoever is on one of them first, then the fairest pick (fairness.js).
-- Set in Settings → Duty Types → Shifts.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE duty_types ADD COLUMN IF NOT EXISTS lead_in_shift_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE duty_types ADD COLUMN IF NOT EXISTS follow_on_shift_ids uuid[] NOT NULL DEFAULT '{}';

COMMIT;
