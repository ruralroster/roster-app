-- Lets each location restrict which activities can be picked there — e.g.
-- Ward locations (Maternity, Ward 1, Ward 2) always only offer "Ward
-- Cover", while Theatre offers Obstetrics/Paediatric Dental/General
-- Surgery/Gynae etc. Configured via a new "Activities" button next to each
-- location in Settings → Locations.
--
-- allowed_activity_ids: NULL or empty = no restriction, every activity in
-- the department is offered (so nothing changes for a location an officer
-- hasn't configured yet). A non-empty array narrows the Activity picker —
-- in the Fortnight assignment wizard, the Day view's Add Activity dialog,
-- and an existing card's own Activity dropdown — to just those activities.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF NOT
-- EXISTS.

BEGIN;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS allowed_activity_ids uuid[];

COMMIT;
