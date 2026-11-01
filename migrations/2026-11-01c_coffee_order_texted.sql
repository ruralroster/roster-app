-- Coffee: stop the "Coffee order update" emails once the order has been
-- texted to the coffee place.
--
-- Tapping Pick up or Delivery in the app's Coffee popup (which opens the
-- text to the coffee place) now records a 'texted' row in
-- coffee_order_sends through mark_coffee_order_texted(). The coffee-order
-- Edge Function sends no more update emails that day once it's there, and
-- none after 10:15 in any case.
--
-- coffee_order_sends stays closed to the app (no grants); the function
-- below is the only way in, and only for someone in that department.
--
-- Run this whole file in the Supabase SQL Editor, then redeploy the
-- coffee-order function. Safe to re-run.

BEGIN;

ALTER TABLE coffee_order_sends DROP CONSTRAINT IF EXISTS coffee_order_sends_kind_check;
ALTER TABLE coffee_order_sends ADD CONSTRAINT coffee_order_sends_kind_check
  CHECK (kind IN ('reminder', 'daily', 'update', 'texted'));

CREATE OR REPLACE FUNCTION mark_coffee_order_texted(p_department_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_department_member(p_department_id) THEN
    RAISE EXCEPTION 'Not a member of this department';
  END IF;
  INSERT INTO coffee_order_sends (department_id, date, kind, staff_id)
  VALUES (
    p_department_id, p_date, 'texted',
    (SELECT staff_id FROM staff WHERE user_id = auth.uid() AND department_id = p_department_id LIMIT 1)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION mark_coffee_order_texted(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_coffee_order_texted(uuid, date) TO authenticated;

COMMIT;

-- To see who texted it and when:
--   SELECT c.date, c.sent_at, s.name FROM coffee_order_sends c LEFT JOIN staff s USING (staff_id)
--   WHERE c.kind = 'texted' ORDER BY c.sent_at DESC LIMIT 10;
