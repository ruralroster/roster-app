-- Adds the "LSL" (Long Service Leave) leave type code the Excel roster
-- importer writes (src/rosterExcelImport.js) — confirmed with the
-- department 2026-09-15. Without this row, LSL days the importer
-- resolves would match no leave_types row and silently leave
-- leave_type_id null, same failure mode 2026-08-27_excel_import_leave_types.sql
-- fixed for AL/SL/GP/PDL.
--
-- Idempotent (ON CONFLICT on the department_id+code unique constraint) —
-- safe to re-run. Scoped to the real department only: department_id
-- 5f83d0f0-27f7-4089-8037-8f13259b2132.

BEGIN;

INSERT INTO leave_types (department_id, name, code)
VALUES
  ('5f83d0f0-27f7-4089-8037-8f13259b2132', 'Long Service Leave', 'LSL')
ON CONFLICT (department_id, code) DO NOTHING;

COMMIT;
