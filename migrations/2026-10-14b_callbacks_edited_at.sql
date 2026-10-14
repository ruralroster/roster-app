-- Lets a staff member correct a recorded callback's start/end times from My
-- Callbacks (e.g. they forgot to tap Call Complete until the morning).
-- edited_at marks that the times were changed by hand after recording, so
-- the officer's On-Call Callbacks report can flag it. Still times only — no
-- patient data (see migrations/2026-10-14_callbacks.sql).
--
-- Run after 2026-10-14_callbacks.sql. Safe to re-run: IF NOT EXISTS.

BEGIN;

ALTER TABLE callbacks
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

COMMIT;
