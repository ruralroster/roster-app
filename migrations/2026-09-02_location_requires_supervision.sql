-- Adds a per-location "requires senior supervision" flag, confirmed
-- 2026-09-02 — lets an officer roster junior staff onto a location (e.g. a
-- junior-only clinic, or a rural site with no consultant structure at all)
-- without the "no consultant on site" warnings that assume every location
-- always needs one. Defaults to true and every existing row is backfilled
-- to true, so every department's current behavior is unchanged until an
-- officer explicitly unchecks it for a specific location.
--
-- Run this whole file in the Supabase SQL Editor.

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS requires_supervision boolean NOT NULL DEFAULT true;
