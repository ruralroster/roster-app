-- Tully's seven standard shifts, and Planner jobs to match them
-- (src/tullyRosterExcelImport.js TULLY_SHIFTS). The import now puts every
-- shift on the nearest standard one for its rank, weekday or weekend and
-- time of day, instead of a shift for every variation on the sheet.
--
--   Weekday Day SMO   08:00-17:00    Weekday Day RMO  08:00-16:30
--   Weekday Late SMO  12:00-22:00    Weekday ED RMO   10:00-21:30
--   Weekend SMO       08:00-18:00    Weekend RMO      10:30-22:00
--                                    Night RMO        21:00-08:30
--
-- Also renames the first setup's jobs (2026-11-18_tully_setup.sql) to the
-- standard hours, adds the two it was missing, and switches off ("active =
-- false") any other Tully shift nothing uses (the odd times an earlier
-- import made). Run it, re-import, then run it again to switch off the
-- rest. Safe to re-run.

BEGIN;

DO $$
DECLARE
  v_dept uuid := (SELECT department_id FROM departments WHERE name = 'Tully Hospital');
  v_job uuid;
  r record;
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'No Tully Hospital department. Run 2026-11-18_tully_setup.sql first.';
  END IF;

  -- The standard shifts: an existing shift at those hours is renamed,
  -- otherwise one is made.
  FOR r IN
    SELECT * FROM (VALUES
      ('Weekday Day SMO',  '08:00', '17:00', 'full'),
      ('Weekday Late SMO', '12:00', '22:00', 'PM'),
      ('Weekend SMO',      '08:00', '18:00', 'full'),
      ('Weekday Day RMO',  '08:00', '16:30', 'full'),
      ('Weekday ED RMO',   '10:00', '21:30', 'PM'),
      ('Weekend RMO',      '10:30', '22:00', 'PM'),
      ('Night RMO',        '21:00', '08:30', 'night')
    ) AS x(name, start_time, end_time, session)
  LOOP
    UPDATE shifts SET name = r.name, active = true
    WHERE shift_id = (
      SELECT shift_id FROM shifts
      WHERE department_id = v_dept AND start_time = r.start_time::time AND end_time = r.end_time::time
        AND name NOT ILIKE '%on call%'
      ORDER BY active DESC LIMIT 1
    );
    IF NOT FOUND THEN
      INSERT INTO shifts (department_id, name, day_type, start_time, end_time, session, active)
      VALUES (v_dept, r.name, 'weekday', r.start_time::time, r.end_time::time, r.session, true);
    END IF;
  END LOOP;

  -- The first setup's jobs, renamed and put on the standard hours.
  FOR r IN
    SELECT * FROM (VALUES
      ('ED Day SMO',    'Weekday ED SMO',             '08:00', '17:00'),
      ('ED Late SMO',   'Weekday ED Late SMO',        '12:00', '22:00'),
      ('Ward SMO',      'Weekday Ward SMO',           '08:00', '17:00'),
      ('Ward & ED SMO', 'Weekend Ward & ED SMO',      '08:00', '18:00'),
      ('GP SMO',        'Weekday GP SMO',             '08:00', '17:00'),
      ('Jumbun SMO',    'Weekday Jumbun SMO',         '08:00', '17:00'),
      ('ED RMO',        'Weekday ED RMO',             '10:00', '21:30'),
      ('RMO Day',       'Weekday Ward, ED & GP RMO',  '08:00', '16:30'),
      ('RMO Weekend',   'Weekend Ward & ED RMO',      '10:30', '22:00'),
      ('RMO Night',     'Night RMO',                  '21:00', '08:30'),
      ('GP RMO',        'Weekday GP RMO',             '08:00', '16:30'),
      ('Jumbun RMO',    'Weekday Jumbun RMO',         '08:00', '16:30')
    ) AS x(old_name, new_name, start_time, end_time)
  LOOP
    UPDATE job_types SET name = r.new_name, start_time = r.start_time::time, end_time = r.end_time::time
    WHERE department_id = v_dept AND name = r.old_name
      AND NOT EXISTS (SELECT 1 FROM job_types WHERE department_id = v_dept AND name = r.new_name);
  END LOOP;

  -- The two jobs the first setup didn't have.
  FOR r IN
    SELECT * FROM (VALUES
      ('Weekday Ward & ED SMO', 'Ward & ED',            'SMO Cover', '08:00', '17:00', 'senior', 'SMO', 3),
      ('Weekday ED Day RMO',    'Emergency Department', 'RMO Cover', '08:00', '16:30', 'junior', 'RMO', 7)
    ) AS x(name, location, activity, start_time, end_time, grade, role, ord)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM job_types WHERE department_id = v_dept AND name = r.name) THEN
      INSERT INTO job_types (department_id, name, location_id, activity_id, start_time, end_time, sort_order)
      VALUES (
        v_dept, r.name,
        (SELECT location_id FROM locations WHERE department_id = v_dept AND name = r.location),
        (SELECT activity_id FROM activity_types WHERE department_id = v_dept AND name = r.activity),
        r.start_time::time, r.end_time::time, r.ord
      )
      RETURNING job_type_id INTO v_job;
      INSERT INTO job_places (department_id, job_type_id, role, kind, grade, min_count, sort_order)
      VALUES (v_dept, v_job, r.role, 'staff', r.grade, 1, 0);
    END IF;
  END LOOP;

  -- Any other Tully shift that nothing uses: switched off, so the pickers
  -- show just the standard seven (and the SBOC on-call one).
  UPDATE shifts s SET active = false
  WHERE s.department_id = v_dept AND s.active
    AND s.name NOT IN ('Weekday Day SMO', 'Weekday Late SMO', 'Weekend SMO', 'Weekday Day RMO', 'Weekday ED RMO', 'Weekend RMO', 'Night RMO')
    AND s.name NOT ILIKE '%on call%'
    AND NOT EXISTS (SELECT 1 FROM staff_assignments a WHERE a.shift_id = s.shift_id)
    AND NOT EXISTS (SELECT 1 FROM theatre_activities t WHERE t.shift_id = s.shift_id)
    AND NOT EXISTS (SELECT 1 FROM duty_types d WHERE d.shift_id = s.shift_id);
END $$;

COMMIT;

-- Tully's shifts now, and how much each is used:
SELECT s.name, to_char(s.start_time, 'HH24:MI') AS starts, to_char(s.end_time, 'HH24:MI') AS ends, s.active,
  (SELECT count(*) FROM staff_assignments a WHERE a.shift_id = s.shift_id) AS bookings
FROM shifts s
WHERE s.department_id = (SELECT department_id FROM departments WHERE name = 'Tully Hospital')
ORDER BY s.active DESC, s.start_time;
