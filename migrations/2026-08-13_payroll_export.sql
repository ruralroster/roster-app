-- Payroll export feature.
-- Run this whole file in the Supabase SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).

BEGIN;

-- 1. Staff payroll number
ALTER TABLE staff ADD COLUMN IF NOT EXISTS payroll_number TEXT;

-- 2. Department pay centre number
ALTER TABLE departments ADD COLUMN IF NOT EXISTS pay_centre_number TEXT;

-- 3. Leave types (per department, e.g. "Cairns Leave", "Study Leave")
CREATE TABLE IF NOT EXISTS leave_types (
  leave_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(department_id, code)
);

-- 3b. The `departments` table exists (staff.department_id and others already
-- reference it) but has zero rows in this project — nothing has ever written
-- to it. leave_types.department_id has a NOT NULL FK to departments, and the
-- payroll export needs a pay_centre_number to attach to each department, so
-- both need an actual row to point at. This backfills the 4 department IDs
-- already in use elsewhere in the app (see src/DemoSelector.jsx) with a
-- name, assuming `departments` has a `name` column like every other
-- reference table in this schema (locations, activity_types, shifts all do).
-- If departments does NOT have a `name` column, this INSERT will fail with
-- an "unknown column" error — in that case drop the `name` column/value
-- below and re-run just this block.
INSERT INTO departments (department_id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Emergency Department'),
  ('22222222-2222-2222-2222-222222222222', 'Theatre Setup'),
  ('33333333-3333-3333-3333-333333333333', 'Rural Hospital'),
  ('835c81c1-09cf-409f-96c9-12c5c2e103ef', 'Cairns Hospital')
ON CONFLICT (department_id) DO NOTHING;

-- 4. Leave/special code recorded against an assignment. Free text — can hold
-- a leave_types.code value or a custom entry the officer types directly.
ALTER TABLE staff_assignments ADD COLUMN IF NOT EXISTS leave_code TEXT;

-- 5. Seed default leave types for every existing department. code == name
-- for the defaults, since the payroll export writes the code value verbatim
-- into the exported cell and it should read the same as the officer sees it
-- in the assignment picker (e.g. "Cairns Leave").
INSERT INTO leave_types (department_id, name, code)
SELECT d.department_id, v.name, v.name
FROM departments d
CROSS JOIN (VALUES
  ('Cairns Leave'),
  ('Study Leave'),
  ('Mat B'),
  ('DCA Volunteer'),
  ('Annual Leave'),
  ('Sick Leave')
) AS v(name)
ON CONFLICT (department_id, code) DO NOTHING;

COMMIT;

-- NOTE on Row Level Security: if RLS is enabled on your other tables (staff,
-- departments, staff_assignments) with policies that grant the anon role
-- read/write, apply the same policy shape to leave_types so the app's anon
-- key can read/write it too. This file doesn't touch RLS/grants because it
-- can't see your existing policies from outside the database — check
-- Database > Policies in the Supabase dashboard after running this, and add
-- a matching policy for leave_types if the other tables have one, e.g.:
--
-- ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "leave_types_anon_all" ON leave_types
--   FOR ALL USING (true) WITH CHECK (true);
