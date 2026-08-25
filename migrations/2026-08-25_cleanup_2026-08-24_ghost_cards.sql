-- One-time cleanup of 5 legacy duplicate/ghost theatre_activities cards
-- from 2026-08-24, found via the overlap-diagnostic query run in chat.
-- Each has NULL start_time/end_time and either no staff, or staff who are
-- already present (same person, same role) on a separate, properly-timed
-- card for the same location+activity+date:
--
--   Clinic / Anaesthetics Clinic   — e55a6a8b duplicates 9b0b3fb7
--   Emergency / ED Cover           — 018bb1e3 duplicates ac34bc05
--   Emergency / ED Cover           — 6827dcc3 is empty (nobody on it)
--   Ward 1 / Ward Care Cover       — cf72f331 duplicates e8660e30
--   Ward 2 / Ward Care Cover       — 3d4ebe95 duplicates 2044660f
--
-- Confirmed by ruralroster as legacy errors, not intentional duplicate
-- coverage — unlike Emergency Department Cover's genuine staggered
-- (08:00-18:00 / 10:30-21:00) shift overlaps elsewhere, which are real
-- and untouched by this cleanup.
--
-- Nothing is reattached: every person on a removed card already has a
-- matching (same person, same role) staff_assignments row on the card
-- being kept, so deleting the removed card's rows loses no roster data.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run —
-- deleting an already-deleted row is a no-op.

BEGIN;

DELETE FROM volunteer_requests WHERE theatre_activity_id IN (
  'e55a6a8b-fa27-4f72-89c0-0a861798185a',
  '018bb1e3-21ca-414c-92f1-9d65769ac6bb',
  '6827dcc3-7c3b-4a35-8178-ac2d8e060b61',
  'cf72f331-6ef8-476b-b8d5-f2f29036f82f',
  '3d4ebe95-e267-4007-916f-02650ed80e53'
);

DELETE FROM staff_assignments WHERE theatre_activity_id IN (
  'e55a6a8b-fa27-4f72-89c0-0a861798185a',
  '018bb1e3-21ca-414c-92f1-9d65769ac6bb',
  '6827dcc3-7c3b-4a35-8178-ac2d8e060b61',
  'cf72f331-6ef8-476b-b8d5-f2f29036f82f',
  '3d4ebe95-e267-4007-916f-02650ed80e53'
);

DELETE FROM theatre_activities WHERE theatre_activity_id IN (
  'e55a6a8b-fa27-4f72-89c0-0a861798185a',
  '018bb1e3-21ca-414c-92f1-9d65769ac6bb',
  '6827dcc3-7c3b-4a35-8178-ac2d8e060b61',
  'cf72f331-6ef8-476b-b8d5-f2f29036f82f',
  '3d4ebe95-e267-4007-916f-02650ed80e53'
);

COMMIT;
