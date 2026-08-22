-- Adds 'intern' as a third valid staff.role value, alongside 'staff' and
-- 'officer'. Purely a label — App.js only ever branches on role === 'officer'
-- (everything else, including 'intern', already gets the plain staff view
-- and staff-level access; no other code or RLS policy keys off 'staff'
-- specifically), so no other change is needed for this to behave exactly
-- like 'staff' except for how it's displayed/selected in Staff Accounts.
--
-- CHECK constraints can't be altered in place — drop and recreate.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role IN ('staff', 'officer', 'intern'));

COMMIT;
