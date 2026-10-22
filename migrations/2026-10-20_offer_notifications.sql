-- Email + push notifications for the volunteering flow — GitHub issue #1.
--
--   1. rank_supervision_rules.can_cover_senior — "Can cover senior shifts
--      (advanced trainee)" in Settings → Ranks. A rank with it ticked is
--      offered, and notified about, senior shifts put out for volunteering
--      (consultant offers, SMO-graded cards) while still requiring
--      supervision for normal rostering. See canCoverSenior in
--      src/offerEligibility.js.
--
--   2. push_subscriptions — one row per staff member per device/browser
--      that turned notifications on (Settings → Notifications). Written by
--      the person themselves; read by the notify-volunteering Edge
--      Function with the service role key, which bypasses RLS. Keyed on
--      (staff_id, endpoint) because one browser can be signed in to more
--      than one department, each with its own staff row.
--
--   3. notified_at on volunteer_offers / volunteer_requests — the Edge
--      Function claims a row by setting this (only while it's still null)
--      before sending anything, so a double-click or a retried call never
--      emails everyone twice.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE rank_supervision_rules
  ADD COLUMN IF NOT EXISTS can_cover_senior boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  push_subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_staff_idx ON push_subscriptions (staff_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions_self" ON push_subscriptions;
CREATE POLICY "push_subscriptions_self" ON push_subscriptions
  FOR ALL USING (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
  ) WITH CHECK (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
  );

ALTER TABLE volunteer_offers ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE volunteer_requests ADD COLUMN IF NOT EXISTS notified_at timestamptz;

COMMIT;
