-- Pay variations to the department's ESO (executive support officer), with
-- no patient details ever stored by Rstar:
--   - departments.variations_email: where a department's variations go
--     (Settings). Set, and the doctor's completion screen offers Email to
--     ESO: their own email app, addressed, with the times and the patient
--     details they've just typed. Rstar never sees the details.
--   - callbacks.details_sent_at: when the doctor sent (or said they sent)
--     that variation's email. Times only; it's what the weekly reminder
--     and the ESO's Monday list read.
--   - mark_my_variations_sent(): a doctor marks their own as sent.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE departments ADD COLUMN IF NOT EXISTS variations_email text;
ALTER TABLE callbacks ADD COLUMN IF NOT EXISTS details_sent_at timestamptz;

CREATE OR REPLACE FUNCTION mark_my_variations_sent(p_callback_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE callbacks SET details_sent_at = now()
  WHERE callback_id = ANY(p_callback_ids)
    AND staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid());
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION mark_my_variations_sent(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_my_variations_sent(uuid[]) TO authenticated;

COMMIT;
