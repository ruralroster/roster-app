-- A doctor who works at more than one site on Rstar (a staff row in each
-- department, all linked to the same login):
--
--   1. my_sites(): the departments the signed-in person is staff in, for
--      the staff app's "All my sites" switch (shown with two or more).
--   2. my_rostered_days(from, to): their shifts, leave and on call at every
--      one of those sites, for the combined calendar and its export.
--   3. other_site_bookings(department, from, to): for an officer, when this
--      department's staff are working at ANOTHER Rstar site: the site's
--      name and the hours only, so booking and Suggest keep 10 hours'
--      rest across sites. Nothing else about the other site is shown.
--
-- All three read through these functions only (security definer), each
-- limited to the caller. Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION my_sites()
RETURNS TABLE (department_id uuid, department_name text, staff_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.department_id, d.name, s.staff_id
  FROM staff s JOIN departments d ON d.department_id = s.department_id
  WHERE s.user_id = auth.uid() AND coalesce(s.active, true)
  ORDER BY d.name;
$$;
REVOKE EXECUTE ON FUNCTION my_sites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_sites() TO authenticated;

CREATE OR REPLACE FUNCTION my_rostered_days(p_from date, p_to date)
RETURNS TABLE (
  kind text,              -- 'shift', 'leave' or 'duty' (an on-call slot)
  ref_id uuid,
  department_id uuid,
  department_name text,
  date date,
  start_time time,
  end_time time,
  shift_name text,
  location_name text,
  activity_name text,
  role text,
  on_call boolean,
  leave_code text,
  duty_label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT s.staff_id, s.department_id, d.name AS department_name
    FROM staff s JOIN departments d ON d.department_id = s.department_id
    WHERE s.user_id = auth.uid() AND coalesce(s.active, true)
  )
  SELECT
    CASE WHEN a.leave_code IS NOT NULL THEN 'leave' ELSE 'shift' END,
    a.assignment_id, me.department_id, me.department_name, a.date,
    coalesce(sh.start_time, ta.start_time), coalesce(sh.end_time, ta.end_time),
    sh.name, l.name, act.name, a.role, coalesce(a.on_call, false), a.leave_code, NULL
  FROM me
  JOIN staff_assignments a ON a.staff_id = me.staff_id
  LEFT JOIN shifts sh ON sh.shift_id = a.shift_id
  LEFT JOIN theatre_activities ta ON ta.theatre_activity_id = a.theatre_activity_id
  LEFT JOIN locations l ON l.location_id = a.location_id
  LEFT JOIN activity_types act ON act.activity_id = ta.activity_id
  WHERE a.date BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'duty', da.duty_id, me.department_id, me.department_name, da.date,
    dt.start_time, dt.end_time, NULL, NULL, NULL, NULL, true, NULL, dt.label
  FROM me
  JOIN duty_assignments da ON da.staff_id = me.staff_id AND da.department_id = me.department_id
  JOIN duty_types dt ON dt.department_id = da.department_id AND dt.key = da.duty_type
  WHERE da.date BETWEEN p_from AND p_to
  ORDER BY 5, 6;
$$;
REVOKE EXECUTE ON FUNCTION my_rostered_days(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_rostered_days(date, date) TO authenticated;

-- staff_id is THIS department's staff row for the person.
CREATE OR REPLACE FUNCTION other_site_bookings(p_department_id uuid, p_from date, p_to date)
RETURNS TABLE (staff_id uuid, date date, start_time time, end_time time, site_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_department_officer(p_department_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT DISTINCT here.staff_id, a.date, sh.start_time, sh.end_time, d.name
  FROM staff here
  JOIN staff there ON there.user_id = here.user_id AND there.department_id <> here.department_id
  JOIN departments d ON d.department_id = there.department_id
  JOIN staff_assignments a ON a.staff_id = there.staff_id
  JOIN shifts sh ON sh.shift_id = a.shift_id
  WHERE here.department_id = p_department_id AND here.user_id IS NOT NULL
    AND a.date BETWEEN p_from AND p_to
    AND NOT coalesce(a.on_call, false) AND a.leave_code IS NULL
    AND sh.start_time IS NOT NULL AND sh.end_time IS NOT NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION other_site_bookings(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION other_site_bookings(uuid, date, date) TO authenticated;

COMMIT;
