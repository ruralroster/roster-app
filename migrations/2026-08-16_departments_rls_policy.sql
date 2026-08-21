-- Fix: Row Level Security was enabled on `departments` at some point without
-- a policy granting the app's anon key access — so the app can no longer
-- see or write department rows (Pay Centre Number, department name in the
-- payroll export header, etc.), even though the rows are very likely still
-- there underneath. Run this in the Supabase SQL Editor.
--
-- This grants the same open access the app already relies on for every
-- other table it touches (staff, staff_assignments, leave_types, etc.).
-- If you deliberately locked down `departments` and want it to STAY locked
-- down from the anon key, don't run this — instead tell the app to go
-- through an authenticated/service role for that table specifically, which
-- would need a larger change.

DROP POLICY IF EXISTS "departments_anon_all" ON departments;
CREATE POLICY "departments_anon_all" ON departments
  FOR ALL USING (true) WITH CHECK (true);
