-- A leaving date for staff: their last working day. Up to it they're
-- bookable as normal; after it no picker offers them (Planner, Day view,
-- Fortnight tab, on call, volunteering), and the day after it they're
-- deactivated the next time an officer opens the app (which also ends
-- their access to the department). Setting it lists anything they're
-- booked on after it, to clear. Null = not leaving.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS leaving_date date;
