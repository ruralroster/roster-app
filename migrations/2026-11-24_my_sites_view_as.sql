-- All my sites follows the staff app being looked at: my_sites and
-- my_rostered_days take the staff record shown (p_staff_id). The person's
-- own record works as before; a super admin using View as gets that
-- person's sites, read-only like the rest of View as. Anyone else's record
-- is refused. With no p_staff_id, the signed-in person, as before.
--
-- Replaces the versions in 2026-11-21_multi_site.sql. Run in the Supabase
-- SQL Editor. Safe to re-run.

BEGIN;

DROP FUNCTION IF EXISTS my_sites();
DROP FUNCTION IF EXISTS my_sites(uuid);
DROP FUNCTION IF EXISTS my_rostered_days(date, date);
DROP FUNCTION IF EXISTS my_rostered_days(date, date, uuid);

-- Whose sites: the login behind p_staff_id, if the caller may see it.
CREATE OR REPLACE FUNCTION my_sites_user(p_staff_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF p_staff_id IS NULL THEN
    RETURN auth.uid();
  END IF;
  SELECT user_id INTO v_user FROM staff WHERE staff_id = p_staff_id;
  IF v_user IS NOT NULL AND (v_user = auth.uid() OR is_super_admin()) THEN
    RETURN v_user;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION my_sites_user(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION my_sites(p_staff_id uuid DEFAULT NULL)
RETURNS TABLE (department_id uuid, department_name text, staff_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.department_id, d.name, s.staff_id
  FROM staff s JOIN departments d ON d.department_id = s.department_id
  WHERE s.user_id = my_sites_user(p_staff_id) AND coalesce(s.active, true)
  ORDER BY d.name;
$$;
REVOKE EXECUTE ON FUNCTION my_sites(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_sites(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION my_rostered_days(p_from date, p_to date, p_staff_id uuid DEFAULT NULL)
RETURNS TABLE (
  kind text, ref_id uuid, department_id uuid, department_name text, date date,
  start_time time, end_time time, shift_name text, location_name text, activity_name text,
  role text, on_call boolean, leave_code text, duty_label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT s.staff_id, s.department_id, d.name AS department_name
    FROM staff s JOIN departments d ON d.department_id = s.department_id
    WHERE s.user_id = my_sites_user(p_staff_id) AND coalesce(s.active, true)
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
REVOKE EXECUTE ON FUNCTION my_rostered_days(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_rostered_days(date, date, uuid) TO authenticated;

COMMIT;
