-- "Notify Sick" — a staff member with a shift today can flag themselves
-- sick from the staff view's Variation tab. An officer approves or denies
-- it; approval is meant to alert whoever is on call at the time (real push
-- notifications aren't wired up yet — see push-notifications-deferred in
-- project memory — so for now approval just needs to be visible in the
-- app, not pushed to a device).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- IF NOT EXISTS / DROP POLICY IF EXISTS throughout.

BEGIN;

CREATE TABLE IF NOT EXISTS sick_reports (
  sick_report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  staff_id uuid NOT NULL REFERENCES staff(staff_id),
  date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES staff(staff_id)
);

ALTER TABLE sick_reports ENABLE ROW LEVEL SECURITY;

-- A staff member can report themselves sick and see their own reports, but
-- can't approve/deny their own — only an officer can change status (see the
-- officer policies below). Officers can also see every report in their
-- department, not just their own.
DROP POLICY IF EXISTS "sick_reports_self_insert" ON sick_reports;
CREATE POLICY "sick_reports_self_insert" ON sick_reports
  FOR INSERT WITH CHECK (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "sick_reports_self_select" ON sick_reports;
CREATE POLICY "sick_reports_self_select" ON sick_reports
  FOR SELECT USING (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
    OR is_department_officer(department_id)
  );

DROP POLICY IF EXISTS "sick_reports_officer_update" ON sick_reports;
CREATE POLICY "sick_reports_officer_update" ON sick_reports
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "sick_reports_officer_delete" ON sick_reports;
CREATE POLICY "sick_reports_officer_delete" ON sick_reports
  FOR DELETE USING (is_department_officer(department_id));

COMMIT;
