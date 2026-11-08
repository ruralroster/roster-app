-- Specialty work anyone can cover: for an advanced skill whose own work
-- isn't locked to it (ED for an ED AST — any AST or consultant can fill the
-- ED spot), the activities that count as that skill's specialty. Fairness
-- (src/fairness.js) then counts a holder's shifts on those activities, up
-- to the least service-bound other specialty's share of shifts, as their
-- specialist time, the same as anaesthetics for an anaesthetic AST.
-- Empty = the skill's work is only what requires it (the usual case).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

ALTER TABLE advanced_skills
  ADD COLUMN IF NOT EXISTS specialty_activity_ids uuid[] NOT NULL DEFAULT '{}';
