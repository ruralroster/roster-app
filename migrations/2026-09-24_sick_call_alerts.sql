-- Sick-call alerts — when a staff member presses "Notify Sick", a pop-up
-- is queued for each supervisor who needs to know, shown the next time
-- that person opens the app (see SickCallAlerts.jsx) until they dismiss
-- it. Recipients (worked out client-side in getSickCallRecipients, since
-- "now" is the reporter's local time — the same toLocalDateStr convention
-- the rest of the app uses):
--   - every active officer in the department (the rostering officer),
--   - whoever holds a duty type flagged notify_on_sick_call whose on-call
--     window covers the moment the button's pressed (the ED on-call),
--   - the consultant(s) rostered at a location flagged
--     notify_on_sick_call at 08:00 the following day (the ED consultant).
--
-- This is an in-app pop-up, not a device push — see
-- push-notifications-deferred in project memory. Email/SMS to the
-- rostering officer is a separate follow-up (needs an email/SMS provider
-- and an Edge Function).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF NOT
-- EXISTS / DROP POLICY IF EXISTS throughout.

BEGIN;

-- Both default false: no one is alerted beyond the officers until an
-- officer ticks the ED on-call duty type and the ED location in Settings.
ALTER TABLE duty_types ADD COLUMN IF NOT EXISTS notify_on_sick_call boolean NOT NULL DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS notify_on_sick_call boolean NOT NULL DEFAULT false;

-- The reporter's own (possibly edited) message, stored on the report so
-- the officer's approval banner can show it too.
ALTER TABLE sick_reports ADD COLUMN IF NOT EXISTS message text;

CREATE TABLE IF NOT EXISTS sick_call_alerts (
  sick_call_alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  sick_report_id uuid NOT NULL REFERENCES sick_reports(sick_report_id) ON DELETE CASCADE,
  recipient_staff_id uuid NOT NULL REFERENCES staff(staff_id),
  -- Why this person got it, shown in the reporter's confirm modal:
  -- 'officer' | 'on_call' | 'next_day_consultant'.
  reason text NOT NULL,
  message text NOT NULL,
  created_at timestamptz DEFAULT now(),
  dismissed_at timestamptz,
  UNIQUE (sick_report_id, recipient_staff_id)
);

CREATE INDEX IF NOT EXISTS sick_call_alerts_recipient_undismissed
  ON sick_call_alerts (recipient_staff_id) WHERE dismissed_at IS NULL;

ALTER TABLE sick_call_alerts ENABLE ROW LEVEL SECURITY;

-- The reporter creates the alerts, but only for their OWN sick report and
-- only to people in that report's department.
DROP POLICY IF EXISTS "sick_call_alerts_reporter_insert" ON sick_call_alerts;
CREATE POLICY "sick_call_alerts_reporter_insert" ON sick_call_alerts
  FOR INSERT WITH CHECK (
    sick_report_id IN (
      SELECT sr.sick_report_id FROM sick_reports sr
      JOIN staff s ON s.staff_id = sr.staff_id
      WHERE s.user_id = auth.uid() AND sr.department_id = sick_call_alerts.department_id
    )
    AND recipient_staff_id IN (
      SELECT staff_id FROM staff WHERE department_id = sick_call_alerts.department_id
    )
  );

-- A recipient sees their own alerts; officers see the department's.
DROP POLICY IF EXISTS "sick_call_alerts_select" ON sick_call_alerts;
CREATE POLICY "sick_call_alerts_select" ON sick_call_alerts
  FOR SELECT USING (
    recipient_staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
    OR is_department_officer(department_id)
  );

-- Dismissing is an UPDATE of dismissed_at — recipient only.
DROP POLICY IF EXISTS "sick_call_alerts_recipient_update" ON sick_call_alerts;
CREATE POLICY "sick_call_alerts_recipient_update" ON sick_call_alerts
  FOR UPDATE USING (
    recipient_staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
  ) WITH CHECK (
    recipient_staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
  );

COMMIT;
