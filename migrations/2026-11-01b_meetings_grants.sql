-- Meetings tables: Data API grants.
--
-- From 30 October 2026 Supabase no longer grants the Data API access to
-- new tables in public automatically. The meetings tables
-- (2026-10-31_meetings.sql) were created around then, so the app may get
-- "permission denied" on them. These grants put them on the same footing as
-- every older table; RLS still decides which rows each person can see or
-- change.
--
-- authenticated: the app (signed-in staff and officers).
-- service_role: the meeting-reminder Edge Function.
-- No anon: nothing reads meetings before signing in.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_types TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_sends TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.week_template_meetings TO authenticated, service_role;

COMMIT;
