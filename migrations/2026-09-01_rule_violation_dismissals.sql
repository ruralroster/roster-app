-- Lets an officer dismiss ("accept") a specific rule violation from the
-- Rule Violations report (src/RuleViolationsReport.jsx) so it stops
-- showing up on future checks, without needing to actually change the
-- roster to make the checker happy — some violations are a deliberate,
-- reviewed exception, not a mistake to fix.
--
-- staff_id is null for a staffing-level (day-wide) violation, which has
-- no single person at fault — see edRuleChecks.js's checkEdStaffingLevels.
-- violation_key is a stable identifier per violation instance (e.g.
-- "night-spacing:2026-06-19"), generated alongside each violation in
-- edRuleChecks.js, so re-running the check can recognize "this exact one
-- was already dismissed" regardless of message wording.
--
-- Same officer-write RLS shape as every other reference table (see
-- migrations/2026-08-21_rls_policies_core_tables.sql).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS rule_violation_dismissals (
  dismissal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff(staff_id) ON DELETE CASCADE,
  violation_key text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, staff_id, violation_key)
);

ALTER TABLE rule_violation_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rule_violation_dismissals_select_department" ON rule_violation_dismissals;
CREATE POLICY "rule_violation_dismissals_select_department" ON rule_violation_dismissals
  FOR SELECT USING (is_department_member(department_id));

DROP POLICY IF EXISTS "rule_violation_dismissals_insert_officer" ON rule_violation_dismissals;
CREATE POLICY "rule_violation_dismissals_insert_officer" ON rule_violation_dismissals
  FOR INSERT WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "rule_violation_dismissals_delete_officer" ON rule_violation_dismissals;
CREATE POLICY "rule_violation_dismissals_delete_officer" ON rule_violation_dismissals
  FOR DELETE USING (is_department_officer(department_id));

COMMIT;
