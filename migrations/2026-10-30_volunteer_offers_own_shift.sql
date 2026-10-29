-- An offer's shift must belong to the offer's department.
--
-- volunteer_offers' insert/update policies only checked that the caller is
-- an officer of the department_id written on the row, not that the
-- theatre_activity being offered is that department's. An officer could, in
-- principle, post another department's shift under their own department
-- (and escalation, which picks the DR Roster site from o.department_id,
-- would send it out under their site). Now both policies also require
-- theatre_activities.department_id to match. The app already only offers
-- its own department's cards, so nothing changes for normal use.
--
-- Column references are qualified: inside the EXISTS, a bare
-- theatre_activity_id / department_id would resolve to theatre_activities.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

DROP POLICY IF EXISTS "volunteer_offers_insert_officer" ON volunteer_offers;
CREATE POLICY "volunteer_offers_insert_officer" ON volunteer_offers
  FOR INSERT WITH CHECK (
    is_department_officer(volunteer_offers.department_id)
    AND EXISTS (
      SELECT 1 FROM theatre_activities ta
      WHERE ta.theatre_activity_id = volunteer_offers.theatre_activity_id
        AND ta.department_id = volunteer_offers.department_id
    )
  );

DROP POLICY IF EXISTS "volunteer_offers_update_officer" ON volunteer_offers;
CREATE POLICY "volunteer_offers_update_officer" ON volunteer_offers
  FOR UPDATE USING (is_department_officer(volunteer_offers.department_id))
  WITH CHECK (
    is_department_officer(volunteer_offers.department_id)
    AND EXISTS (
      SELECT 1 FROM theatre_activities ta
      WHERE ta.theatre_activity_id = volunteer_offers.theatre_activity_id
        AND ta.department_id = volunteer_offers.department_id
    )
  );

-- Check: any existing offers whose shift is another department's (expect none).
-- SELECT o.* FROM volunteer_offers o JOIN theatre_activities ta USING (theatre_activity_id)
-- WHERE ta.department_id <> o.department_id;

COMMIT;
