-- The weekly volunteering email (supabase/functions-src/offers-weekly.ts):
-- Mondays at 07:00 Brisbane (21:00 UTC on Sunday), each staff member gets
-- one email listing the offered shifts in the next fortnight they could
-- take. Offers themselves no longer email anyone; they still go to phones
-- (notify-volunteering).
--
-- Deploy the offers-weekly function first (named exactly that, JWT
-- verification off), then run this in the Supabase SQL Editor. Uses the
-- same Vault secret as the coffee and meeting timers. Safe to re-run.

SELECT cron.unschedule('offers-weekly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'offers-weekly');

SELECT cron.schedule(
  'offers-weekly',
  '0 21 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://cmchorwjojvihlahknxk.supabase.co/functions/v1/offers-weekly',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'coffee_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To try it now, sending every summary to you instead of the staff:
-- SELECT net.http_post(
--   url := 'https://cmchorwjojvihlahknxk.supabase.co/functions/v1/offers-weekly',
--   headers := jsonb_build_object('Content-Type', 'application/json',
--     'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'coffee_cron_secret')),
--   body := '{"preview": "you@example.com"}'::jsonb
-- );
