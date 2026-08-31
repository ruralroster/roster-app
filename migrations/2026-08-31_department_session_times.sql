-- Makes the Morning/Afternoon/Night boundary times (previously hardcoded
-- in src/shiftSessionUtils.js: 09:00-12:00 / 12:30-18:00 / 20:00-08:00)
-- configurable per department, same "plain columns on departments" shape
-- as pay_centre_number/coffee_place_name/coffee_place_phone (see
-- migrations/2026-08-24_coffee_place.sql).
--
-- DEFAULT here does double duty: it seeds every existing department with
-- the exact values already hardcoded (so nobody's Morning/Afternoon/Night
-- Allocations sections change until an officer edits Settings), and it
-- means a brand-new department gets sane values automatically too.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS morning_start time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS morning_end time NOT NULL DEFAULT '12:00',
  ADD COLUMN IF NOT EXISTS afternoon_start time NOT NULL DEFAULT '12:30',
  ADD COLUMN IF NOT EXISTS afternoon_end time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS night_start time NOT NULL DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS night_end time NOT NULL DEFAULT '08:00';

COMMIT;
