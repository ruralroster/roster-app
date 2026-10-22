-- Email + push for Notify Sick — the notify-volunteering Edge Function's
-- 'sick' event. Rostering officers are emailed; whoever's on call now
-- (a duty type ticked notify_on_sick_call) gets a phone notification.
-- Recipients are the report's sick_call_alerts rows, which the reporter's
-- app already writes (see migrations/2026-09-24_sick_call_alerts.sql).
--
-- sick_reports.notified_at — the Edge Function claims a report by setting
-- this (only while it's still null) before sending anything, the same as
-- volunteer_offers / volunteer_requests, so nobody is told twice.
--
-- Run this whole file in the Supabase SQL Editor, BEFORE deploying the
-- updated notify-volunteering function. Safe to re-run.

BEGIN;

ALTER TABLE sick_reports ADD COLUMN IF NOT EXISTS notified_at timestamptz;

COMMIT;
