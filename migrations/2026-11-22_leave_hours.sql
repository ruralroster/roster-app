-- Leave blocks (Staff & Availability > Add leave): each day of a block
-- carries the hours it counts towards FTE, so a block counts the person's
-- FTE's worth: 44 hours a week x FTE, spread evenly over every day of it
-- (two weeks at 0.5 FTE = 44 hours; at 1.0 = 88). A day with no hours set
-- (the Planner's Leave box, imports, leave requests) counts as one of their
-- usual shifts, as before (fteFortnight.js).
--
-- Run in the Supabase SQL Editor. Safe to re-run.

ALTER TABLE staff_availability
  ADD COLUMN IF NOT EXISTS leave_hours numeric CHECK (leave_hours IS NULL OR leave_hours >= 0);
