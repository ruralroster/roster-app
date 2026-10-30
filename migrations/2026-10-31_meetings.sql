-- Meetings: named, timed sessions (Junior teaching, ID meeting, SMO
-- meeting) that sit on a day in the Planner like the on-call slots do.
-- They don't touch anyone's shift: they only remind the people they apply
-- to, by a phone notification shortly before and/or an email that morning.
--
-- 1. meeting_types: the department's list (Settings → Locations &
--    Activities → Meetings): name, usual time, optional location, who it's
--    for, the reminders, and how to join remotely (a Teams/Zoom link and/or
--    a dial-in number).
--
-- 2. meetings: one meeting on one day. Copies its type's settings when
--    it's put on the Planner, so a single day can be changed (time,
--    audience, link) without touching the type. meeting_type_id is kept
--    for templates and colour; name is stored too, so a deleted type
--    doesn't blank old meetings.
--
--    audience (jsonb), see src/meetingAudience.js:
--      { "mode": "everyone" | "on_shift" | "seniors" | "juniors" }
--      { "mode": "custom", "ranks": [...], "scope": "all" | "working" | "people", "staffIds": [...] }
--    push_minutes_before: null = no phone notification.
--    email_morning: the 08:00 email (07:00 for meetings before 08:30).
--
-- 3. meeting_sends: one row per meeting and reminder kind, inserted by the
--    meeting-reminders Edge Function to claim the send, so each reminder
--    goes once. Officers can read it (who was reminded); nobody writes it
--    from the app.
--
-- 4. week_template_meetings: meetings saved in a week template from the
--    Planner, laid out again when the template is applied.
--
-- 5. meetings_due(): true when any meeting today has a reminder due and
--    not yet sent. The pg_cron job below checks it every minute and only
--    calls the Edge Function when it's true, so the function isn't woken
--    1,440 times a day for nothing.
--
-- The cron job reuses the coffee job's secret (coffee_cron_secret in
-- Vault, checked by coffee_cron_secret_ok), so there's nothing new to set
-- up there. Deploy the function first, named meeting-reminder (singular,
-- the name it's live under); see supabase/functions-src/meeting-reminders.ts.
--
-- Same "read = member, write = officer" RLS as job_types.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS meeting_types (
  meeting_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  name text NOT NULL,
  location_id uuid REFERENCES locations(location_id) ON DELETE SET NULL,
  start_time time NOT NULL DEFAULT '08:00',
  end_time time NOT NULL DEFAULT '08:30',
  audience jsonb NOT NULL DEFAULT '{"mode": "on_shift"}',
  push_minutes_before integer DEFAULT 10 CHECK (push_minutes_before IS NULL OR push_minutes_before BETWEEN 0 AND 240),
  email_morning boolean NOT NULL DEFAULT true,
  join_url text,
  dial_in text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (department_id, name)
);

CREATE TABLE IF NOT EXISTS meetings (
  meeting_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  meeting_type_id uuid REFERENCES meeting_types(meeting_type_id) ON DELETE SET NULL,
  name text NOT NULL,
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  location_id uuid REFERENCES locations(location_id) ON DELETE SET NULL,
  audience jsonb NOT NULL DEFAULT '{"mode": "on_shift"}',
  push_minutes_before integer DEFAULT 10 CHECK (push_minutes_before IS NULL OR push_minutes_before BETWEEN 0 AND 240),
  email_morning boolean NOT NULL DEFAULT true,
  join_url text,
  dial_in text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meetings_department_date_idx ON meetings(department_id, date);

CREATE TABLE IF NOT EXISTS meeting_sends (
  meeting_id uuid NOT NULL REFERENCES meetings(meeting_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('push', 'email')),
  department_id uuid NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_to jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (meeting_id, kind)
);

CREATE TABLE IF NOT EXISTS week_template_meetings (
  week_template_meeting_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_template_id uuid NOT NULL REFERENCES week_templates(week_template_id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  meeting_type_id uuid NOT NULL REFERENCES meeting_types(meeting_type_id) ON DELETE CASCADE,
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS week_template_meetings_template_idx ON week_template_meetings(week_template_id);

-- New tables need explicit Data API grants since 30 October 2026
-- (see 2026-11-01b_meetings_grants.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_types, meetings, meeting_sends, week_template_meetings TO authenticated, service_role;

ALTER TABLE meeting_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE week_template_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_types_select_department" ON meeting_types;
CREATE POLICY "meeting_types_select_department" ON meeting_types
  FOR SELECT USING (is_department_member(department_id));
DROP POLICY IF EXISTS "meeting_types_insert_officer" ON meeting_types;
CREATE POLICY "meeting_types_insert_officer" ON meeting_types
  FOR INSERT WITH CHECK (is_department_officer(department_id));
DROP POLICY IF EXISTS "meeting_types_update_officer" ON meeting_types;
CREATE POLICY "meeting_types_update_officer" ON meeting_types
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));
DROP POLICY IF EXISTS "meeting_types_delete_officer" ON meeting_types;
CREATE POLICY "meeting_types_delete_officer" ON meeting_types
  FOR DELETE USING (is_department_officer(department_id));

DROP POLICY IF EXISTS "meetings_select_department" ON meetings;
CREATE POLICY "meetings_select_department" ON meetings
  FOR SELECT USING (is_department_member(department_id));
DROP POLICY IF EXISTS "meetings_insert_officer" ON meetings;
CREATE POLICY "meetings_insert_officer" ON meetings
  FOR INSERT WITH CHECK (is_department_officer(department_id));
DROP POLICY IF EXISTS "meetings_update_officer" ON meetings;
CREATE POLICY "meetings_update_officer" ON meetings
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));
DROP POLICY IF EXISTS "meetings_delete_officer" ON meetings;
CREATE POLICY "meetings_delete_officer" ON meetings
  FOR DELETE USING (is_department_officer(department_id));

DROP POLICY IF EXISTS "meeting_sends_select_officer" ON meeting_sends;
CREATE POLICY "meeting_sends_select_officer" ON meeting_sends
  FOR SELECT USING (is_department_officer(department_id));

-- Template rows go through their template's department, like
-- week_template_entries.
DROP POLICY IF EXISTS "week_template_meetings_select_department" ON week_template_meetings;
CREATE POLICY "week_template_meetings_select_department" ON week_template_meetings
  FOR SELECT USING (EXISTS (SELECT 1 FROM week_templates t WHERE t.week_template_id = week_template_meetings.week_template_id AND is_department_member(t.department_id)));
DROP POLICY IF EXISTS "week_template_meetings_insert_officer" ON week_template_meetings;
CREATE POLICY "week_template_meetings_insert_officer" ON week_template_meetings
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM week_templates t WHERE t.week_template_id = week_template_meetings.week_template_id AND is_department_officer(t.department_id)));
DROP POLICY IF EXISTS "week_template_meetings_delete_officer" ON week_template_meetings;
CREATE POLICY "week_template_meetings_delete_officer" ON week_template_meetings
  FOR DELETE USING (EXISTS (SELECT 1 FROM week_templates t WHERE t.week_template_id = week_template_meetings.week_template_id AND is_department_officer(t.department_id)));

-- Any reminder due now (Brisbane time) and not yet sent. Mirrors
-- reminderTimes() in src/meetingAudience.js; the Edge Function makes the
-- real decision, this only saves waking it when there's nothing to do.
CREATE OR REPLACE FUNCTION meetings_due()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH now_b AS (
    SELECT (now() AT TIME ZONE 'Australia/Brisbane') AS t
  ),
  today AS (
    SELECT m.*, (extract(hour FROM m.start_time) * 60 + extract(minute FROM m.start_time))::int AS start_min,
           (extract(hour FROM n.t) * 60 + extract(minute FROM n.t))::int AS now_min
    FROM meetings m, now_b n
    WHERE m.date = n.t::date
  )
  SELECT EXISTS (
    SELECT 1 FROM today m
    WHERE m.now_min <= m.start_min
      AND (
        (m.push_minutes_before IS NOT NULL
         AND m.now_min >= m.start_min - m.push_minutes_before
         AND NOT EXISTS (SELECT 1 FROM meeting_sends s WHERE s.meeting_id = m.meeting_id AND s.kind = 'push'))
        OR
        (m.email_morning
         AND m.now_min >= CASE WHEN m.start_min < 510 THEN greatest(0, least(420, m.start_min - 30)) ELSE 480 END
         AND NOT EXISTS (SELECT 1 FROM meeting_sends s WHERE s.meeting_id = m.meeting_id AND s.kind = 'email'))
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION meetings_due() FROM PUBLIC, anon, authenticated;

-- Every minute; only calls the function when meetings_due(). Re-running
-- replaces the job of the same name.
SELECT cron.schedule(
  'meeting-reminders',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://cmchorwjojvihlahknxk.supabase.co/functions/v1/meeting-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'coffee_cron_secret')
    ),
    body := '{}'::jsonb
  )
  WHERE meetings_due();
  $$
);

COMMIT;

-- To check it's running:
--   SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'meeting-reminders') ORDER BY start_time DESC LIMIT 5;
--   SELECT m.date, m.start_time, m.name, s.kind, s.sent_at, jsonb_array_length(s.sent_to) AS people
--   FROM meeting_sends s JOIN meetings m USING (meeting_id) ORDER BY s.sent_at DESC LIMIT 10;
-- To stop it:
--   SELECT cron.unschedule('meeting-reminders');
