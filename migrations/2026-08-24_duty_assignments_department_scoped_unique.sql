-- Fixes a real cross-tenant data corruption bug: duty_assignments has only
-- ever enforced uniqueness on (date, duty_type), with no department_id in
-- that constraint. Every department (including the seeded demo ones) gets
-- duty types with the same default keys (first_on_call, second_on_call,
-- am_coordinator, pm_coordinator) — so if a demo department and a real
-- department both ever upsert a duty assignment for the same key on the
-- same calendar date, whichever writes last silently overwrites the
-- other's row's department_id, making the earlier one disappear from that
-- department entirely. This is what happened: a demo department
-- (33333333-3333-3333-3333-333333333333) ended up owning a row that had
-- been a real department's first_on_call assignment.
--
-- This finds the existing 2-column (date, duty_type) unique constraint
-- (found dynamically rather than by a guessed name — the original
-- migration didn't name it explicitly) and replaces it with one scoped by
-- department_id too, matching how updateDutyAssignment's and
-- assignStaffFortnight's upserts now target it (see the matching app-code
-- change).
--
-- This does NOT recover data already overwritten by the collision — there
-- is no history to recover it from, upsert overwrote it in place. Any
-- duty assignment that "disappeared" needs to be re-entered once this is
-- applied. Going forward, a collision like this becomes physically
-- impossible.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

DO $$
DECLARE
  old_constraint_name text;
BEGIN
  SELECT con.conname INTO old_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'duty_assignments'
    AND con.contype = 'u'
    AND array_length(con.conkey, 1) = 2;

  IF old_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE duty_assignments DROP CONSTRAINT %I', old_constraint_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'duty_assignments'
      AND con.contype = 'u'
      AND array_length(con.conkey, 1) = 3
  ) THEN
    ALTER TABLE duty_assignments
      ADD CONSTRAINT duty_assignments_department_date_type_key
      UNIQUE (department_id, date, duty_type);
  END IF;
END $$;

COMMIT;
