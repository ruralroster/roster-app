-- Two additions for the volunteering rework confirmed 2026-09-23:
--
-- 1. locations.requires_both_senior_and_junior — a new per-location flag,
--    independent of the existing requires_supervision (which only says a
--    junior can't be rostered here ALONE, with no consultant). This one
--    says the location needs BOTH a consultant and a registrar rostered,
--    not just one or the other — e.g. a theatre list needing an assistant
--    as well as a supervisor. Defaults false: no behavior change for a
--    department that hasn't opted a location into this.
--
-- 2. volunteer_offers — previously, getAvailableShiftsForStaff showed
--    EVERY unfilled theatre_activity role in the next 30 days to every
--    eligible staff member automatically, with no officer action needed.
--    That turned out to be too noisy to be useful. Now a slot only
--    appears to staff once an officer has explicitly opened it — from the
--    missing-role indicator this migration's locations flag drives (see
--    officer-roster-view-supabase.jsx's card rendering) or from any other
--    unfilled slot the officer chooses to offer. One row per
--    (theatre_activity, role); deleted once that role is actually filled
--    (see clearVolunteerOfferForRole in supabaseClient.js, mirroring the
--    existing clearVolunteerRequestsForRole for volunteer_requests).
--
-- Same officer-write/department-read RLS shape as rule_violation_
-- dismissals (migrations/2026-09-01_rule_violation_dismissals.sql).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS requires_both_senior_and_junior boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS volunteer_offers (
  volunteer_offer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  theatre_activity_id uuid NOT NULL REFERENCES theatre_activities(theatre_activity_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('consultant', 'registrar')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (theatre_activity_id, role)
);

ALTER TABLE volunteer_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "volunteer_offers_select_department" ON volunteer_offers;
CREATE POLICY "volunteer_offers_select_department" ON volunteer_offers
  FOR SELECT USING (is_department_member(department_id));

DROP POLICY IF EXISTS "volunteer_offers_insert_officer" ON volunteer_offers;
CREATE POLICY "volunteer_offers_insert_officer" ON volunteer_offers
  FOR INSERT WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "volunteer_offers_delete_officer" ON volunteer_offers;
CREATE POLICY "volunteer_offers_delete_officer" ON volunteer_offers
  FOR DELETE USING (is_department_officer(department_id));

COMMIT;
