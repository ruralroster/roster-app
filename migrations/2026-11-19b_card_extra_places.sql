-- Planner: a card's own extra places (the + on a card), on top of its
-- job's places — e.g. a third RMO on today's GP RMO card. Each is an
-- ordinary empty place: fill it, offer it, or let Suggest fill it. Only
-- that card has them; the job, and other days, are unchanged.
--
-- Run in the Supabase SQL Editor. Safe to re-run. No new table, so no new
-- grants; theatre_activities' own policies cover it.

ALTER TABLE theatre_activities
  ADD COLUMN IF NOT EXISTS extra_senior_places integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_junior_places integer NOT NULL DEFAULT 0;

ALTER TABLE theatre_activities DROP CONSTRAINT IF EXISTS theatre_activities_extra_places_check;
ALTER TABLE theatre_activities ADD CONSTRAINT theatre_activities_extra_places_check
  CHECK (extra_senior_places BETWEEN 0 AND 10 AND extra_junior_places BETWEEN 0 AND 10);
