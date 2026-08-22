-- Adds 'intern' as a valid staff.rank value. staff_rank_check predates the
-- tracked migrations (same situation as staff_role_check before
-- 2026-08-22_staff_role_intern.sql) — it wasn't visible by grepping this
-- migrations folder, only discovered when an invite actually failed against
-- it: "new row for relation staff violates check constraint
-- staff_rank_check". Existing allowed values taken from RANK_OPTIONS in
-- src/StaffAvailabilityTab.jsx.
--
-- CHECK constraints can't be altered in place — drop and recreate.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_rank_check;
ALTER TABLE staff ADD CONSTRAINT staff_rank_check
  CHECK (rank IN ('consultant', 'fellow', 'advanced_trainee', 'basic_trainee', 'intern'));

COMMIT;
