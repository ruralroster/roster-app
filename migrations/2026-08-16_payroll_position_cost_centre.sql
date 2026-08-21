-- Payroll export: Position ID + Cost Centre per staff member.
-- Run this whole file in the Supabase SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run: idempotent (IF NOT EXISTS).

BEGIN;

-- Per-staff, like payroll_number — distinct from departments.pay_centre_number,
-- which is the export's header-row value. Cost Centre can differ between
-- staff in the same department (e.g. different funding sources).
ALTER TABLE staff ADD COLUMN IF NOT EXISTS position_id TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS cost_centre TEXT;

COMMIT;
