-- Settings → Notifications: choose email, phone or both — GitHub issue #1.
--
--   1. staff.notify_email — whether the notify-volunteering Edge Function
--      emails this person. On by default, so nothing changes for anyone
--      until they turn it off. Phone (push) needs no column: it's on for
--      a device exactly when that device has a push_subscriptions row.
--
--   2. set_my_notify_email(staff_id, on) — staff can't update their own
--      staff row (only officers can, staff_update_officer), so this lets
--      someone change just this one setting on just their own row.
--      SECURITY DEFINER with search_path pinned, like the RLS helpers in
--      2026-08-21_rls_helper_functions.sql.
--
-- Run this whole file in the Supabase SQL Editor, BEFORE deploying the
-- updated notify-volunteering function (it reads notify_email). Safe to
-- re-run.

BEGIN;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION set_my_notify_email(p_staff_id uuid, p_on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE staff
  SET notify_email = p_on
  WHERE staff_id = p_staff_id
    AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You can only change your own notification settings';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_my_notify_email(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_my_notify_email(uuid, boolean) TO authenticated;

COMMIT;
