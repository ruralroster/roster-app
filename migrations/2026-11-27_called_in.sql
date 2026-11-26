-- Called in when not on call (2026-11-27): some people (in Gastro, a few
-- at Innisfail) get called in without being on call or on shift. A
-- department can allow it (off by default), and the officer ticks who;
-- those people get a "Called in (not on call)" timer on Variations, any
-- time. Recorded as its own kind, 'callin', with no on-call slot or shift.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE departments ADD COLUMN IF NOT EXISTS allow_called_in boolean NOT NULL DEFAULT false;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS can_be_called_in boolean NOT NULL DEFAULT false;

ALTER TABLE callbacks DROP CONSTRAINT IF EXISTS callbacks_kind_check;
ALTER TABLE callbacks ADD CONSTRAINT callbacks_kind_check CHECK (
  (kind = 'callback' AND duty_type IS NOT NULL)
  OR (kind = 'overtime' AND shift_id IS NOT NULL)
  OR (kind = 'callin')
);

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
      -- Called in: only someone the officer has ticked, in a department
      -- that allows it.
      OR (kind = 'callin' AND EXISTS (
        SELECT 1 FROM staff s JOIN departments d ON d.department_id = s.department_id
        WHERE s.staff_id = callbacks.staff_id
          AND s.department_id = callbacks.department_id
          AND s.can_be_called_in AND d.allow_called_in
      ))
    )
  );

COMMIT;
