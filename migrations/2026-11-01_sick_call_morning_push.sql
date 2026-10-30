-- Notify Sick: a phone notification at 07:30 on the day of the missed
-- shift, to
--   - the 08:00 ED consultant that day (next_day_consultant), who until now
--     only got the in-app pop-up, and
--   - whoever was ED on call when the sick call was made (on_call), who
--     was already pushed at the time of the call and now is again at 07:30.
-- One notification each, even if they're both. If 07:30 has already passed
-- when the call is made, the consultant is pushed straight away instead and
-- the on-call isn't pushed again (they've just been told).
--
-- 1. sick_call_alerts.push_at / pushed_at: when that alert's 07:30
--    notification is due, and when it went. A trigger sets push_at on
--    insert from the alert's reasons (the reporter's app picks the
--    consultant for the shift's own date, see getSickCallRecipients), so
--    the reporter's app can't set it.
--
-- 2. sick_morning_due(): any such notification due and not yet sent.
--
-- 3. The meeting-reminders cron job now also runs when sick_morning_due(),
--    and the same Edge Function (deployed as meeting-reminder) sends these
--    too. Redeploy it with the new index.ts BEFORE running this file.
--
-- An alert on a sick call the officer has already denied is marked sent
-- without notifying anyone.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE sick_call_alerts ADD COLUMN IF NOT EXISTS push_at timestamptz;
ALTER TABLE sick_call_alerts ADD COLUMN IF NOT EXISTS pushed_at timestamptz;
CREATE INDEX IF NOT EXISTS sick_call_alerts_push_due_idx ON sick_call_alerts(push_at) WHERE pushed_at IS NULL;

CREATE OR REPLACE FUNCTION sick_call_alerts_set_push_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reasons text[] := string_to_array(NEW.reason, ',');
  v_at timestamptz;
BEGIN
  NEW.pushed_at := NULL;
  NEW.push_at := NULL;
  SELECT (r.date + time '07:30') AT TIME ZONE 'Australia/Brisbane' INTO v_at
    FROM sick_reports r WHERE r.sick_report_id = NEW.sick_report_id;
  IF v_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_at > now() AND ('next_day_consultant' = ANY (v_reasons) OR 'on_call' = ANY (v_reasons)) THEN
    NEW.push_at := v_at;
  ELSIF 'next_day_consultant' = ANY (v_reasons) AND NOT ('on_call' = ANY (v_reasons)) THEN
    NEW.push_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS sick_call_alerts_set_push_at ON sick_call_alerts;
CREATE TRIGGER sick_call_alerts_set_push_at
  BEFORE INSERT ON sick_call_alerts
  FOR EACH ROW EXECUTE FUNCTION sick_call_alerts_set_push_at();

CREATE OR REPLACE FUNCTION sick_morning_due()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM sick_call_alerts
    WHERE pushed_at IS NULL AND push_at IS NOT NULL AND push_at <= now()
  );
$fn$;
REVOKE EXECUTE ON FUNCTION sick_morning_due() FROM PUBLIC, anon, authenticated;

-- Same job as migrations/2026-10-31_meetings.sql, now also woken for
-- these. Re-running replaces it.
SELECT cron.schedule(
  'meeting-reminders',
  '* * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://cmchorwjojvihlahknxk.supabase.co/functions/v1/meeting-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'coffee_cron_secret')
    ),
    body := '{}'::jsonb
  )
  WHERE meetings_due() OR sick_morning_due();
  $job$
);

COMMIT;

-- To check:
--   SELECT a.push_at, a.pushed_at, s.name AS consultant, a.message
--   FROM sick_call_alerts a JOIN staff s ON s.staff_id = a.recipient_staff_id
--   WHERE a.push_at IS NOT NULL ORDER BY a.push_at DESC LIMIT 10;
