-- Lets a super admin create new departments from the app. `departments`
-- currently has SELECT (member/officer) and UPDATE (officer) policies from
-- 2026-08-21_departments_rls_tighten.sql, but no INSERT policy at all —
-- meaning nobody, not even a super admin, can create one today.
--
-- Reuses is_department_officer() rather than inventing a new check: its
-- super-admin bypass (EXISTS ... profiles.is_super_admin) only reads
-- `profiles`, not `departments`, so it evaluates fine even for a
-- department_id that doesn't exist yet — a real (non-super-admin) officer
-- can never satisfy this for a brand-new department_id, since no `staff`
-- row can reference a department that doesn't exist yet. Net effect: only
-- super admins can create departments, with no separate admin-only check
-- needed.
--
-- Run this after 2026-08-21_departments_rls_tighten.sql. Run this whole
-- file in the Supabase SQL Editor. Safe to re-run: DROP POLICY IF EXISTS
-- before CREATE POLICY.

BEGIN;

DROP POLICY IF EXISTS "departments_insert_super_admin" ON departments;
CREATE POLICY "departments_insert_super_admin" ON departments
  FOR INSERT WITH CHECK (is_department_officer(department_id));

COMMIT;
