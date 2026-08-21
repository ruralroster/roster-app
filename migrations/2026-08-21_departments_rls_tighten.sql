-- Replaces the wide-open `departments_anon_all` policy added in
-- 2026-08-16_departments_rls_policy.sql (a deliberate stopgap at the time,
-- per that file's own comment) with real department-scoped access now that
-- is_department_member/is_department_officer exist.
--
-- DO NOT RUN until 2026-08-21_rls_helper_functions.sql has run and every
-- real staff member has a linked account — this removes the open-access
-- fallback the app currently relies on for the departments table.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: DROP
-- POLICY IF EXISTS before each CREATE POLICY.

BEGIN;

DROP POLICY IF EXISTS "departments_anon_all" ON departments;

DROP POLICY IF EXISTS "departments_select_member" ON departments;
CREATE POLICY "departments_select_member" ON departments
  FOR SELECT USING (
    is_department_member(department_id) OR is_department_officer(department_id)
  );

DROP POLICY IF EXISTS "departments_update_officer" ON departments;
CREATE POLICY "departments_update_officer" ON departments
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));

COMMIT;
