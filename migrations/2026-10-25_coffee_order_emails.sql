-- Coffee order emails, replacing the Apps Script and its preferences sheet.
-- The coffee-order Edge Function, run every 5 minutes from 8:00 to 17:00
-- Brisbane time by pg_cron:
--   8:15  push to whoever was ED on call overnight, if anyone working this
--         morning has no coffee order (opens the Coffee popup).
--   9:00  "Daily Coffee Order" email to the consultant on today's ED late.
--   after "Coffee order update" email to them whenever the order changes
--   9:00  (until 17:00), with what changed and the full order.
--
--   1. departments.coffee_emails: on for the real department only.
--   2. coffee_order_sends: what was sent, so nothing goes twice and each
--      update can say what changed since the last email.
--   3. coffee_cron_secret_ok(): how the function checks a call came from
--      the timer. The secret lives in Supabase Vault and never leaves the
--      database, so there's nothing to copy into the function's settings.
--   4. The pg_cron job.
--
-- Run this whole file in the Supabase SQL Editor, then deploy the
-- function: `supabase functions deploy coffee-order --no-verify-jwt`.
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

BEGIN;

ALTER TABLE departments ADD COLUMN IF NOT EXISTS coffee_emails boolean NOT NULL DEFAULT false;
UPDATE departments SET coffee_emails = true WHERE department_id = '5f83d0f0-27f7-4089-8037-8f13259b2132';

CREATE TABLE IF NOT EXISTS coffee_order_sends (
  send_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reminder', 'daily', 'update')),
  staff_id uuid REFERENCES staff(staff_id) ON DELETE SET NULL,
  snapshot jsonb,
  sent_at timestamptz NOT NULL DEFAULT now()
);

-- One 8:15 reminder and one 9:00 email per department per day; the
-- function claims each by inserting before it sends.
CREATE UNIQUE INDEX IF NOT EXISTS coffee_order_sends_once_idx
  ON coffee_order_sends (department_id, date, kind) WHERE kind IN ('reminder', 'daily');
CREATE INDEX IF NOT EXISTS coffee_order_sends_day_idx ON coffee_order_sends (department_id, date, sent_at);

-- Only the Edge Function (service role, which bypasses RLS) uses it.
ALTER TABLE coffee_order_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coffee_order_sends FROM anon, authenticated;

COMMIT;

-- The timer's secret, made once.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'coffee_cron_secret') THEN
    PERFORM vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'coffee_cron_secret');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION coffee_cron_secret_ok(p_secret text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'coffee_cron_secret' AND decrypted_secret = p_secret);
$$;

REVOKE EXECUTE ON FUNCTION coffee_cron_secret_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION coffee_cron_secret_ok(text) TO service_role;

-- Every 5 minutes, 8:00-16:55 Brisbane (UTC+10, no daylight saving) =
-- 22:00-06:55 UTC. Re-running replaces the job of the same name.
SELECT cron.schedule(
  'coffee-order',
  '*/5 22,23,0-6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://cmchorwjojvihlahknxk.supabase.co/functions/v1/coffee-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'coffee_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check it's running:
--   SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'coffee-order') ORDER BY start_time DESC LIMIT 5;
--   SELECT kind, sent_at, snapshot->>'sentTo' FROM coffee_order_sends ORDER BY sent_at DESC LIMIT 10;
-- To stop it:
--   SELECT cron.unschedule('coffee-order');
--
-- To test: email yourself today's order as it stands right now (records
-- nothing, so the real 9:00 email still goes):
--   SELECT net.http_post(
--     url := 'https://cmchorwjojvihlahknxk.supabase.co/functions/v1/coffee-order',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--       'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'coffee_cron_secret')),
--     body := '{"preview": "you@example.com"}'::jsonb
--   );
-- then, a few seconds later, to see whether it worked:
--   SELECT status_code, content FROM net._http_response ORDER BY created DESC LIMIT 1;
