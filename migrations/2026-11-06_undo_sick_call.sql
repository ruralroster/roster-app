-- Undo a sick call: the person who called in, or an officer of the
-- department, can take back a Notify Sick report (pending or approved).
--
-- undo_sick_report() marks the report 'cancelled' and, for everyone it
-- alerted:
--   - a 07:30 notification not yet sent is called off (push_at cleared,
--     so sick_morning_due() no longer sees it),
--   - their in-app pop-up comes back, now saying the sick call was
--     cancelled (except for whoever pressed Undo).
-- The app then asks the notify-volunteering function ('sick_cancelled')
-- to email the officers and push anyone whose phone was already told,
-- once (cancel_notified_at is claimed first, like notified_at).
--
-- The person who called in can undo up to the day after the shift's date;
-- an officer at any time. Once cancelled, the person can Notify Sick for
-- that shift again.
--
-- Run this whole file in the Supabase SQL Editor, then redeploy
-- notify-volunteering. Safe to re-run.

BEGIN;

ALTER TABLE sick_reports DROP CONSTRAINT IF EXISTS sick_reports_status_check;
ALTER TABLE sick_reports ADD CONSTRAINT sick_reports_status_check
  CHECK (status IN ('pending', 'approved', 'denied', 'cancelled'));
ALTER TABLE sick_reports ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE sick_reports ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES staff(staff_id);
ALTER TABLE sick_reports ADD COLUMN IF NOT EXISTS cancel_notified_at timestamptz;
-- So the pop-up can show it as a cancellation, not a sick call.
ALTER TABLE sick_call_alerts ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE OR REPLACE FUNCTION undo_sick_report(p_sick_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report sick_reports%ROWTYPE;
  v_me uuid;
  v_reporter_name text;
  v_by_name text;
  v_message text;
BEGIN
  SELECT * INTO v_report FROM sick_reports WHERE sick_report_id = p_sick_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sick call not found';
  END IF;

  SELECT staff_id INTO v_me FROM staff
    WHERE user_id = auth.uid() AND department_id = v_report.department_id LIMIT 1;

  IF is_department_officer(v_report.department_id) THEN
    NULL;
  ELSIF v_me IS NOT NULL AND v_me = v_report.staff_id THEN
    IF v_report.date < (now() AT TIME ZONE 'Australia/Brisbane')::date - 1 THEN
      RAISE EXCEPTION 'This sick call is too old to undo; ask your officer';
    END IF;
  ELSE
    RAISE EXCEPTION 'Only the person who called in sick or an officer can undo it';
  END IF;

  IF v_report.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'This sick call is already %', v_report.status;
  END IF;

  UPDATE sick_reports
    SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_me
    WHERE sick_report_id = p_sick_report_id;

  SELECT name INTO v_reporter_name FROM staff WHERE staff_id = v_report.staff_id;
  SELECT name INTO v_by_name FROM staff WHERE staff_id = v_me;
  v_message := format('Sick call cancelled: %s is no longer off sick on %s.',
    coalesce(v_reporter_name, 'Someone'), to_char(v_report.date, 'Dy FMDD Mon'));
  IF v_by_name IS NOT NULL AND v_me <> v_report.staff_id THEN
    v_message := v_message || format(' Cancelled by %s.', v_by_name);
  END IF;

  UPDATE sick_call_alerts
    SET push_at = CASE WHEN pushed_at IS NULL THEN NULL ELSE push_at END,
        message = v_message,
        cancelled_at = now(),
        dismissed_at = CASE WHEN recipient_staff_id = v_me THEN now() ELSE NULL END
    WHERE sick_report_id = p_sick_report_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION undo_sick_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION undo_sick_report(uuid) TO authenticated;

COMMIT;

-- To check:
--   SELECT r.date, r.status, r.cancelled_at, s.name, b.name AS cancelled_by
--   FROM sick_reports r JOIN staff s USING (staff_id) LEFT JOIN staff b ON b.staff_id = r.cancelled_by
--   WHERE r.status = 'cancelled' ORDER BY r.cancelled_at DESC LIMIT 10;
