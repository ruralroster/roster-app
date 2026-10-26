-- A third kind of availability day: unavailable because working elsewhere.
--
--   available = true                      available (green)
--   available = false                     unavailable (red) — leave, a day
--                                         off. Still open to district
--                                         shifts in DR Roster: someone on
--                                         leave may want to pick one up.
--   available = false, working_elsewhere  unavailable because they're
--                                         working another job (dark grey).
--                                         DR Roster offers them nothing
--                                         that day either.
--
-- To roster-app itself both unavailable kinds are the same (available =
-- false), so nothing else here changes. The cycle on the availability
-- calendars is not set → available → unavailable → working elsewhere →
-- not set (availabilityUtils.js).
--
-- Run this whole file in the Supabase SQL Editor, before district-roster's
-- 2026-10-29_day_status.sql. Safe to re-run.

BEGIN;

ALTER TABLE staff_availability ADD COLUMN IF NOT EXISTS working_elsewhere boolean NOT NULL DEFAULT false;
ALTER TABLE staff_availability DROP CONSTRAINT IF EXISTS staff_availability_working_elsewhere_check;
ALTER TABLE staff_availability ADD CONSTRAINT staff_availability_working_elsewhere_check
  CHECK (NOT (working_elsewhere AND available));

COMMIT;
