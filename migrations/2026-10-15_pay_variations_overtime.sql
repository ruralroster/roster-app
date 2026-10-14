-- Turns the on-call callbacks table (2026-10-14_callbacks.sql) into a
-- general "pay variations" log with two kinds:
--   'callback' — called in while on call; tied to a duty_assignments row
--                (duty_date + duty_type), as before
--   'overtime' — stayed back past a rostered shift; tied to a
--                staff_assignments row (duty_date + shift_id)
-- Same timer, same table, categorised by `kind` so the officer's Pay
-- Variations report can tell them apart. Existing rows become 'callback'.
--
-- Table keeps its name (callbacks) — internal only. Still times only, never
-- patient data.
--
-- Run after 2026-10-14_callbacks.sql and 2026-10-14b_callbacks_edited_at.sql.
-- Safe to re-run: IF NOT EXISTS / DROP ... IF EXISTS throughout.

BEGIN;

ALTER TABLE callbacks
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'callback',
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(shift_id);

-- Overtime rows have no duty type. duty_date now means "the date the
-- on-call or shift started" for both kinds.
ALTER TABLE callbacks ALTER COLUMN duty_type DROP NOT NULL;

ALTER TABLE callbacks DROP CONSTRAINT IF EXISTS callbacks_kind_check;
ALTER TABLE callbacks ADD CONSTRAINT callbacks_kind_check CHECK (
  (kind = 'callback' AND duty_type IS NOT NULL)
  OR (kind = 'overtime' AND shift_id IS NOT NULL)
);

-- A staff member can only log a callback against one of their own duty
-- assignments, or overtime against one of their own rostered shifts.
DROP POLICY IF EXISTS "callbacks_self_insert" ON callbacks;
CREATE POLICY "callbacks_self_insert" ON callbacks
  FOR INSERT WITH CHECK (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
    AND (
      (kind = 'callback' AND EXISTS (
        SELECT 1 FROM duty_assignments da
        WHERE da.department_id = callbacks.department_id
          AND da.staff_id = callbacks.staff_id
          AND da.date = callbacks.duty_date
          AND da.duty_type = callbacks.duty_type
      ))
      OR (kind = 'overtime' AND EXISTS (
        SELECT 1 FROM staff_assignments sa
        WHERE sa.department_id = callbacks.department_id
          AND sa.staff_id = callbacks.staff_id
          AND sa.date = callbacks.duty_date
          AND sa.shift_id = callbacks.shift_id
      ))
    )
  );

COMMIT;
