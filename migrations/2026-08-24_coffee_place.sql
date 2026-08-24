-- The "Coffee Place" — the single café/shop the daily coffee order gets
-- called or texted through to. Stored on departments (one per department,
-- same shape as pay_centre_number) rather than as a phone_book_entries row,
-- since it's a distinct concept the Coffee Orders modal looks up directly
-- to build its "text the order" link, not just another number in the list.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE departments ADD COLUMN IF NOT EXISTS coffee_place_name TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS coffee_place_phone TEXT;

COMMIT;
