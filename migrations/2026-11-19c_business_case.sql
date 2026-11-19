-- Business case measures (Reports > Business case):
--
--   1. screen_time: how long people actively spend on each screen, a day
--      at a time. The app adds a minute or so at a time while a screen is
--      open, in front, and in use (a key, click, tap or scroll in the last
--      two minutes), so a screen left open isn't counted. Officers'
--      rostering screens (Calendar, Day, Fortnight, Planner, Import) give
--      the rostering officer's time; the staff app gives adoption.
--   2. business_case_report(): per pay fortnight, for a department:
--      officer rostering hours, active staff users, shifts rostered, 10-hour
--      rest breaches, the spread of weekends and nights across staff, and
--      overtime / callbacks logged. Totals only; no names.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS screen_time (
  department_id uuid NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  screen text NOT NULL,
  day date NOT NULL,
  seconds integer NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id, screen, day)
);

ALTER TABLE screen_time ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "screen_time_select_officer" ON screen_time;
CREATE POLICY "screen_time_select_officer" ON screen_time
  FOR SELECT TO authenticated USING (is_department_officer(department_id));
-- Written only through log_screen_time.
GRANT SELECT ON screen_time TO authenticated;
GRANT ALL ON screen_time TO service_role;

-- Adds p_seconds (at most 5 minutes a call) to today's row for the caller,
-- in Brisbane time. Only for a department they belong to.
CREATE OR REPLACE FUNCTION log_screen_time(p_department_id uuid, p_screen text, p_seconds integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT is_department_member(p_department_id) THEN
    RETURN;
  END IF;
  IF p_screen !~ '^[a-z_]{1,32}$' OR p_seconds IS NULL OR p_seconds <= 0 THEN
    RETURN;
  END IF;
  INSERT INTO screen_time (department_id, user_id, screen, day, seconds)
  VALUES (p_department_id, auth.uid(), p_screen, (now() AT TIME ZONE 'Australia/Brisbane')::date, least(p_seconds, 300))
  ON CONFLICT (department_id, user_id, screen, day)
  DO UPDATE SET seconds = screen_time.seconds + least(p_seconds, 300), updated_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION log_screen_time(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION log_screen_time(uuid, text, integer) TO authenticated;

-- One row per pay fortnight (Mondays 14 days on from 2026-06-08, as the
-- app's FTE cap) overlapping p_from..p_to.
CREATE OR REPLACE FUNCTION business_case_report(p_department_id uuid, p_from date, p_to date)
RETURNS TABLE (
  fortnight_from date,
  fortnight_to date,
  officer_rostering_hours numeric,
  admin_rostering_hours numeric,
  active_staff_users integer,
  shifts_rostered integer,
  rest_breaches integer,
  weekend_shifts_min integer,
  weekend_shifts_max integer,
  night_shifts_min integer,
  night_shifts_max integer,
  overtime_logged integer,
  callbacks_logged integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_department_officer(p_department_id) THEN
    RAISE EXCEPTION 'Only an officer of this department can see its business case report';
  END IF;

  RETURN QUERY
  WITH fortnights AS (
    SELECT f::date AS f_from, (f + interval '13 days')::date AS f_to
    FROM generate_series(
      date '2026-06-08' + 14 * floor((p_from - date '2026-06-08') / 14.0)::int,
      p_to, interval '14 days') AS f
  ),
  -- Each person's worked shifts (not on call, not leave), once per
  -- person/day/shift, with real start and end times.
  worked AS (
    SELECT DISTINCT ON (a.staff_id, a.date, a.shift_id)
      a.staff_id, a.date,
      (a.date + sh.start_time) AS starts,
      (a.date + sh.end_time + CASE WHEN sh.end_time <= sh.start_time THEN interval '1 day' ELSE interval '0' END) AS ends,
      extract(isodow FROM a.date) IN (6, 7) AS weekend,
      sh.start_time >= time '19:00' AS night
    FROM staff_assignments a
    JOIN shifts sh ON sh.shift_id = a.shift_id
    WHERE a.department_id = p_department_id
      AND a.date BETWEEN p_from - 14 AND p_to + 14
      AND NOT coalesce(a.on_call, false)
      AND a.leave_code IS NULL
      AND sh.start_time IS NOT NULL AND sh.end_time IS NOT NULL
  ),
  gaps AS (
    SELECT w.staff_id, w.date, w.starts,
      lag(w.ends) OVER (PARTITION BY w.staff_id ORDER BY w.starts) AS prev_ends,
      lag(w.date) OVER (PARTITION BY w.staff_id ORDER BY w.starts) AS prev_date
    FROM worked w
  ),
  regulars AS (
    SELECT staff_id FROM staff
    WHERE department_id = p_department_id AND coalesce(active, true) AND coalesce(fte, 1) > 0
  ),
  per_person AS (
    SELECT f.f_from, r.staff_id,
      count(w.*) FILTER (WHERE w.weekend) AS weekends,
      count(w.*) FILTER (WHERE w.night) AS nights
    FROM fortnights f
    CROSS JOIN regulars r
    LEFT JOIN worked w ON w.staff_id = r.staff_id AND w.date BETWEEN f.f_from AND f.f_to
    GROUP BY f.f_from, r.staff_id
  )
  SELECT
    f.f_from, f.f_to,
    round(coalesce((SELECT sum(t.seconds) FROM screen_time t
      WHERE t.department_id = p_department_id AND t.day BETWEEN f.f_from AND f.f_to
        AND t.screen IN ('calendar', 'day', 'fortnight', 'planner', 'import')
        AND NOT coalesce((SELECT p.is_super_admin FROM profiles p WHERE p.user_id = t.user_id), false)), 0) / 3600.0, 1),
    round(coalesce((SELECT sum(t.seconds) FROM screen_time t
      WHERE t.department_id = p_department_id AND t.day BETWEEN f.f_from AND f.f_to
        AND t.screen IN ('calendar', 'day', 'fortnight', 'planner', 'import')
        AND coalesce((SELECT p.is_super_admin FROM profiles p WHERE p.user_id = t.user_id), false)), 0) / 3600.0, 1),
    (SELECT count(DISTINCT t.user_id)::int FROM screen_time t
      WHERE t.department_id = p_department_id AND t.day BETWEEN f.f_from AND f.f_to AND t.screen = 'staff_app'),
    (SELECT count(*)::int FROM worked w WHERE w.date BETWEEN f.f_from AND f.f_to),
    (SELECT count(*)::int FROM gaps g
      WHERE g.date BETWEEN f.f_from AND f.f_to AND g.prev_date IS NOT NULL AND g.prev_date <> g.date
        AND g.starts - g.prev_ends < interval '10 hours'),
    (SELECT min(pp.weekends)::int FROM per_person pp WHERE pp.f_from = f.f_from),
    (SELECT max(pp.weekends)::int FROM per_person pp WHERE pp.f_from = f.f_from),
    (SELECT min(pp.nights)::int FROM per_person pp WHERE pp.f_from = f.f_from),
    (SELECT max(pp.nights)::int FROM per_person pp WHERE pp.f_from = f.f_from),
    (SELECT count(*)::int FROM callbacks c WHERE c.department_id = p_department_id AND c.kind = 'overtime' AND c.duty_date BETWEEN f.f_from AND f.f_to),
    (SELECT count(*)::int FROM callbacks c WHERE c.department_id = p_department_id AND c.kind = 'callback' AND c.duty_date BETWEEN f.f_from AND f.f_to)
  FROM fortnights f
  ORDER BY f.f_from;
END;
$$;
REVOKE EXECUTE ON FUNCTION business_case_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION business_case_report(uuid, date, date) TO authenticated;

COMMIT;

-- Check: Innisfail's last three pay fortnights.
SELECT * FROM business_case_report('5f83d0f0-27f7-4089-8037-8f13259b2132', current_date - 42, current_date);
