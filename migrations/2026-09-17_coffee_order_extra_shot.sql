-- Adds an "Xtra shot" option next to coffee selection everywhere it's
-- offered. Personal staff.coffee_order stays a single free-text column
-- (see src/coffeeUtils.js — extra shot is now just a " + Xtra Shot" suffix
-- on that same string, no schema change needed there). Extras added to the
-- daily Coffee Orders modal (see migrations/2026-09-09_coffee_order_day_adjustments.sql)
-- are structured rows though, so those need an actual column. Defaults to
-- false, so every existing extras row is unaffected.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE coffee_order_extras
  ADD COLUMN IF NOT EXISTS extra_shot boolean NOT NULL DEFAULT false;

COMMIT;
