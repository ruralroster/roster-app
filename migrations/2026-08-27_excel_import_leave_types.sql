-- Adds the leave type codes the Excel roster importer writes
-- (src/rosterExcelImport.js): AL, SL, GP, PDL. These never existed —
-- the original leave_types seed (2026-08-13_payroll_export.sql) used the
-- full name as the code (e.g. code 'Annual Leave', not 'AL'), so every
-- leave day the importer wrote matched no leave_types row and silently
-- left leave_type_id null.
--
-- Idempotent (ON CONFLICT on the department_id+code unique constraint) —
-- safe to re-run. Scoped to the real department only (see
-- migrations/README or ask — the department_id below is
-- 5f83d0f0-27f7-4089-8037-8f13259b2132, not the demo/seed departments
-- the original seed targeted).

BEGIN;

INSERT INTO leave_types (department_id, name, code)
VALUES
  ('5f83d0f0-27f7-4089-8037-8f13259b2132', 'Annual Leave', 'AL'),
  ('5f83d0f0-27f7-4089-8037-8f13259b2132', 'Study Leave', 'SL'),
  ('5f83d0f0-27f7-4089-8037-8f13259b2132', 'GP', 'GP'),
  ('5f83d0f0-27f7-4089-8037-8f13259b2132', 'Professional Development Leave', 'PDL')
ON CONFLICT (department_id, code) DO NOTHING;

COMMIT;
