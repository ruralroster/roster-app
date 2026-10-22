-- Offering a shift from the Planner — volunteer_offers.filled_baseline.
--
-- An offer used to count as filled as soon as anyone held its role on the
-- card. A Planner job can need two seniors with one already booked, so an
-- offer for the second would have been hidden from staff at once. Now the
-- offer records how many held the role when it was made, and it's filled
-- once there are more than that (offerIsFilled in src/offerEligibility.js).
-- 0 for every existing offer and every Day view offer, which are only made
-- for an empty role, so nothing about them changes.
--
-- Run this whole file in the Supabase SQL Editor, BEFORE deploying the
-- updated notify-volunteering function (it reads filled_baseline). Safe to
-- re-run.

BEGIN;

ALTER TABLE volunteer_offers ADD COLUMN IF NOT EXISTS filled_baseline integer NOT NULL DEFAULT 0;

COMMIT;
