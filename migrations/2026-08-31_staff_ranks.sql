-- Generalizes the hardcoded 5-value staff.rank enum into a real
-- per-department, orderable list — built on the EXISTING rank_supervision_
-- rules table (department_id, rank, requires_supervision, max_per_consultant,
-- can_share_supervisor), not a new one. An earlier draft of this migration
-- created a separate `staff_ranks` table before rank_supervision_rules was
-- known to exist; this supersedes that draft entirely (safe to run even if
-- the earlier version already ran — see the DROP TABLE below).
--
-- Also fixes a pre-existing bug confirmed 2026-08-31: rank_supervision_rules
-- and validate_supervision both spell the intern rank 'in_term', but the
-- actual staff.rank value (per staff_rank_check) is 'intern' — meaning the
-- intern-specific 1:1-exclusive-supervision rule has never actually matched
-- a real intern.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING throughout).

BEGIN;

-- Supersede the earlier draft, if it was ever run — staff.rank's FK has to
-- come off staff_ranks before that table can be dropped (confirmed
-- 2026-08-31: it was run once, before rank_supervision_rules was found).
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_rank_fkey;
DROP TABLE IF EXISTS staff_ranks;

ALTER TABLE rank_supervision_rules
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- This table originally had its own CHECK constraint limiting `rank` to
-- a fixed set of literal values — directly incompatible with the entire
-- point of this migration (letting an officer create arbitrary rank names
-- like "TS4" in Settings). Dropped in favor of the composite FK from
-- staff.rank, which validates against real configured rows instead of a
-- hardcoded list.
ALTER TABLE rank_supervision_rules DROP CONSTRAINT IF EXISTS rank_supervision_rules_rank_check;

UPDATE rank_supervision_rules SET rank = 'intern' WHERE rank = 'in_term';

-- The UNIQUE(department_id, rank) constraint the FK below needs already
-- exists (confirmed 2026-08-31: rank_supervision_rules_department_id_rank_key)
-- — nothing to add here.

-- Give every department's existing rows a stable order matching the
-- classic seniority sequence, so Settings → Ranks has something sane to
-- show before anyone reorders manually.
UPDATE rank_supervision_rules SET sort_order = CASE rank
  WHEN 'consultant' THEN 0
  WHEN 'fellow' THEN 1
  WHEN 'advanced_trainee' THEN 2
  WHEN 'basic_trainee' THEN 3
  WHEN 'intern' THEN 4
  ELSE 5
END;

-- Seed the classic 5 ranks (with the same supervision numbers already used
-- for every other department in this table) for any department that has
-- zero rows today — including the real one, which had none.
INSERT INTO rank_supervision_rules (department_id, rank, requires_supervision, max_per_consultant, can_share_supervisor, sort_order)
SELECT d.department_id, v.rank, v.requires_supervision, v.max_per_consultant, v.can_share_supervisor, v.sort_order
FROM departments d
CROSS JOIN (VALUES
  ('consultant', false, NULL::int, false, 0),
  ('fellow', false, NULL::int, false, 1),
  ('advanced_trainee', true, 2, true, 2),
  ('basic_trainee', true, 1, true, 3),
  ('intern', true, 1, false, 4)
) AS v(rank, requires_supervision, max_per_consultant, can_share_supervisor, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM rank_supervision_rules r WHERE r.department_id = d.department_id)
ON CONFLICT (department_id, rank) DO NOTHING;

-- Safety net for any staff.rank value that isn't in rank_supervision_rules
-- yet (shouldn't exist today, since staff_rank_check enforced exactly the
-- classic 5) — gives the FK below something to reference instead of
-- rejecting real data. Defaults conservatively to "requires supervision,
-- 1 at a time, no sharing" — an officer can loosen this in Settings.
INSERT INTO rank_supervision_rules (department_id, rank, requires_supervision, max_per_consultant, can_share_supervisor, sort_order)
SELECT DISTINCT s.department_id, s.rank, true, 1, false,
  COALESCE((SELECT MAX(sort_order) + 1 FROM rank_supervision_rules r WHERE r.department_id = s.department_id), 0)
FROM staff s
WHERE s.rank IS NOT NULL
ON CONFLICT (department_id, rank) DO NOTHING;

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_rank_check;

ALTER TABLE staff
  ADD CONSTRAINT staff_rank_fkey
  FOREIGN KEY (department_id, rank)
  REFERENCES rank_supervision_rules (department_id, rank)
  ON UPDATE CASCADE;

COMMIT;
