-- Fortnight view: staff-to-shift allocation, independent of location/role.
-- Run this whole file in the Supabase SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run: idempotent (IF NOT EXISTS).

BEGIN;

-- One shift per staff member per day. Deliberately has no location_id or
-- role, unlike staff_assignments (which the Day/theatre view uses) — this
-- table is for blocking out "who's on what shift" at a glance before/without
-- assigning them to a specific theatre or location.
CREATE TABLE IF NOT EXISTS staff_shift_allocations (
  allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  staff_id uuid NOT NULL REFERENCES staff(staff_id),
  date date NOT NULL,
  shift_id uuid NOT NULL REFERENCES shifts(shift_id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(staff_id, date)
);

COMMIT;

-- NOTE on Row Level Security: if RLS is enabled on your other tables with
-- policies that grant the anon role read/write, apply the same shape here
-- so the app's anon key can read/write this table too. This file can't see
-- your existing policies from outside the database — check
-- Database > Policies in the Supabase dashboard after running this, e.g.:
--
-- ALTER TABLE staff_shift_allocations ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "staff_shift_allocations_anon_all" ON staff_shift_allocations
--   FOR ALL USING (true) WITH CHECK (true);
