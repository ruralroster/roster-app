-- Rostering officers who aren't clinical staff (an admin officer who does
-- the roster): staff.non_clinical. They sign in to the officer side like
-- any officer, but are left out of everything that rosters people: the
-- Planner's people list and Suggest, the on-call pickers, fairness, and
-- the FTE totals. Invited from Settings > Staff Accounts as "Rostering
-- officer (not clinical)".
--
-- Run in the Supabase SQL Editor. Safe to re-run.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS non_clinical boolean NOT NULL DEFAULT false;
