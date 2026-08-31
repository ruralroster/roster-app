-- rank_supervision_rules has Row Level Security enabled but was never
-- added to the officer-write policy list in
-- migrations/2026-08-21_rls_policies_core_tables.sql — it predates that
-- migration (rows there go back to 2026-08-06) and was missed. Confirmed
-- 2026-08-31 via a failed officer-side insert: "new row violates row-level
-- security policy for table rank_supervision_rules".
--
-- Same shape as every other table in that migration's loop: members can
-- read their department's ranks, only officers can create/edit/delete them.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE rank_supervision_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rank_supervision_rules_select_department" ON rank_supervision_rules;
CREATE POLICY "rank_supervision_rules_select_department" ON rank_supervision_rules
  FOR SELECT USING (is_department_member(department_id));

DROP POLICY IF EXISTS "rank_supervision_rules_insert_officer" ON rank_supervision_rules;
CREATE POLICY "rank_supervision_rules_insert_officer" ON rank_supervision_rules
  FOR INSERT WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "rank_supervision_rules_update_officer" ON rank_supervision_rules;
CREATE POLICY "rank_supervision_rules_update_officer" ON rank_supervision_rules
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "rank_supervision_rules_delete_officer" ON rank_supervision_rules;
CREATE POLICY "rank_supervision_rules_delete_officer" ON rank_supervision_rules
  FOR DELETE USING (is_department_officer(department_id));

COMMIT;
