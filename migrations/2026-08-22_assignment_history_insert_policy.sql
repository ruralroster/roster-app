-- Fixes: "new row violates row-level security policy for table
-- assignment_history" on every staff_assignments write (Complete
-- Allocation, and anything before it too). 2026-08-21_rls_policies_core_tables.sql
-- deliberately gave assignment_history read-only access for officers,
-- assuming its populating trigger would insert as some privileged bypass —
-- it doesn't; it runs as the calling user, so it's subject to RLS same as
-- a direct client insert, and there was never an INSERT policy for it.
--
-- Only officers can write staff_assignments in the first place
-- (staff_assignments_insert_officer/update_officer/delete_officer), so
-- only officers can ever cause this trigger to fire — this INSERT policy
-- mirrors that same check, matching the existing
-- assignment_history_select_officer policy's shape.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: DROP
-- POLICY IF EXISTS before CREATE POLICY.

BEGIN;

DROP POLICY IF EXISTS "assignment_history_insert_officer" ON assignment_history;
CREATE POLICY "assignment_history_insert_officer" ON assignment_history
  FOR INSERT WITH CHECK (is_department_officer(department_id));

COMMIT;
