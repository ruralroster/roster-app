-- Sets up Mareeba Hospital as an Rstar department, ready for its roster to
-- be imported (Import tab, the "Days down, people across (e.g. Mareeba)"
-- format: src/mareebaRosterExcelImport.js).
--
--   - The department, with the Mareeba import format.
--   - Ranks: SMO (senior); PHO, Intern and Nurse Practitioner (junior).
--   - Locations: Emergency, Ward, East and West wards, the remote and
--     outreach places (Lotus Glen, Dimbulah, OST Remote), GP, Maternity,
--     Theatre, the surgical, PAC and dental clinics, and Non-clinical.
--   - Activities: SMO Cover and PHO Cover (separate jobs and fairness for
--     each grade), Admin Time, and Visiting Surgeon.
--   - Leave: AL, LSL, ML (maternity), PDL, CL (carer's).
--   - On call: ED, Obs and Anaesthetic Back-up, 17:00 to 08:00 (seniors).
--   - The standard shifts: SMO Day 07:45-17:15, SMO ED Late 12:30-22:00,
--     PHO Day 07:45-16:45, PHO Late 12:30-21:30, PHO Night 21:00-08:30.
--   - Planner jobs, one place each, for the main shifts, so imports land
--     on them and Suggest can fill new weeks.
--
-- Staff come from the roster file (Import tab > Check for Missing Staff),
-- so no names are in here.
--
-- Run in the Supabase SQL Editor. Safe to re-run: nothing is added twice.

BEGIN;

DO $$
DECLARE
  v_dept uuid := (SELECT department_id FROM departments WHERE name = 'Mareeba Hospital');
  v_activity uuid;
  v_shift uuid;
  v_job uuid;
  r record;
BEGIN
  IF v_dept IS NULL THEN
    v_dept := gen_random_uuid();
    INSERT INTO departments (department_id, name) VALUES (v_dept, 'Mareeba Hospital');
  END IF;
  UPDATE departments SET roster_import_format = 'mareeba' WHERE department_id = v_dept;

  INSERT INTO rank_supervision_rules (department_id, rank, requires_supervision, sort_order)
  SELECT v_dept, x.rank, x.req, x.ord
  FROM (VALUES ('SMO', false, 0), ('PHO', true, 1), ('Intern', true, 2), ('Nurse Practitioner', true, 3)) AS x(rank, req, ord)
  WHERE NOT EXISTS (SELECT 1 FROM rank_supervision_rules WHERE department_id = v_dept AND rank = x.rank);

  INSERT INTO locations (department_id, name)
  SELECT v_dept, x.name
  FROM (VALUES ('Emergency'), ('Ward'), ('East Ward'), ('West Ward'), ('Lotus Glen'), ('Dimbulah'), ('OST Remote'),
    ('GP Clinic'), ('Maternity'), ('Theatre'), ('Surgical Clinic'), ('PAC Clinic'), ('Dental'), ('Non-clinical')) AS x(name)
  WHERE NOT EXISTS (SELECT 1 FROM locations WHERE department_id = v_dept AND name = x.name);

  INSERT INTO activity_types (department_id, name, abbreviation)
  SELECT v_dept, x.name, x.abbr
  FROM (VALUES ('SMO Cover', 'SMO'), ('PHO Cover', 'PHO'), ('Admin Time', 'CST'), ('Visiting Surgeon', 'VS')) AS x(name, abbr)
  WHERE NOT EXISTS (SELECT 1 FROM activity_types WHERE department_id = v_dept AND name = x.name);

  INSERT INTO leave_types (department_id, name, code)
  SELECT v_dept, x.name, x.code
  FROM (VALUES ('Annual Leave', 'AL'), ('Long Service Leave', 'LSL'), ('Maternity Leave', 'ML'),
    ('Professional Development Leave', 'PDL'), ('Carer''s Leave', 'CL')) AS x(name, code)
  WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE department_id = v_dept AND code = x.code);

  FOR r IN SELECT * FROM (VALUES
    ('ed_back_up', 'ED Back-up', 'ED BU', 0),
    ('obs_back_up', 'Obs Back-up', 'Obs BU', 1),
    ('anaesthetic_back_up', 'Anaesthetic Back-up', 'Anaes BU', 2)
  ) AS x(key, label, abbr, ord)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM duty_types WHERE department_id = v_dept AND key = r.key) THEN
      INSERT INTO activity_types (department_id, name) VALUES (v_dept, r.label) RETURNING activity_id INTO v_activity;
      INSERT INTO shifts (department_id, name, day_type, start_time, end_time, session, active)
      VALUES (v_dept, r.label || ' On Call', 'weekday', '17:00', '08:00', 'night', true) RETURNING shift_id INTO v_shift;
      INSERT INTO duty_types (department_id, key, label, counts_as_on_call, sort_order, start_time, end_time, activity_type_id, shift_id, abbreviation)
      VALUES (v_dept, r.key, r.label, true, r.ord, '17:00', '08:00', v_activity, v_shift, r.abbr);
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
    ('SMO Day', '07:45', '17:15', 'full'),
    ('SMO ED Late', '12:30', '22:00', 'PM'),
    ('PHO Day', '07:45', '16:45', 'full'),
    ('PHO Late', '12:30', '21:30', 'PM'),
    ('PHO Night', '21:00', '08:30', 'night')
  ) AS x(name, start_time, end_time, session)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM shifts WHERE department_id = v_dept AND start_time = r.start_time::time AND end_time = r.end_time::time AND active) THEN
      INSERT INTO shifts (department_id, name, day_type, start_time, end_time, session, active)
      VALUES (v_dept, r.name, 'weekday', r.start_time::time, r.end_time::time, r.session, true);
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
    ('SMO ED Early',   'Emergency',  'SMO Cover', '07:45', '17:15', 'senior', 'SMO', 0),
    ('SMO ED Late',    'Emergency',  'SMO Cover', '12:30', '22:00', 'senior', 'SMO', 1),
    ('SMO Ward',       'Ward',       'SMO Cover', '07:45', '17:15', 'senior', 'SMO', 2),
    ('SMO Lotus Glen', 'Lotus Glen', 'SMO Cover', '07:45', '17:15', 'senior', 'SMO', 3),
    ('SMO GP',         'GP Clinic',  'SMO Cover', '07:45', '17:15', 'senior', 'SMO', 4),
    ('SMO Maternity',  'Maternity',  'SMO Cover', '07:45', '17:15', 'senior', 'SMO', 5),
    ('PHO ED Day',     'Emergency',  'PHO Cover', '07:45', '16:45', 'junior', 'PHO', 6),
    ('PHO ED Late',    'Emergency',  'PHO Cover', '12:30', '21:30', 'junior', 'PHO', 7),
    ('PHO Night',      'Emergency',  'PHO Cover', '21:00', '08:30', 'junior', 'PHO', 8),
    ('PHO East Ward',  'East Ward',  'PHO Cover', '07:45', '16:45', 'junior', 'PHO', 9),
    ('PHO West Ward',  'West Ward',  'PHO Cover', '07:45', '16:45', 'junior', 'PHO', 10),
    ('Admin (CST)',    'Non-clinical', 'Admin Time', '07:45', '17:15', 'any', 'Doctor', 11)
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

  RAISE NOTICE 'Mareeba Hospital is department %', v_dept;
END $$;

COMMIT;

SELECT d.name, d.department_id, d.roster_import_format,
  (SELECT count(*) FROM locations l WHERE l.department_id = d.department_id) AS locations,
  (SELECT count(*) FROM activity_types a WHERE a.department_id = d.department_id) AS activities,
  (SELECT count(*) FROM rank_supervision_rules r WHERE r.department_id = d.department_id) AS ranks,
  (SELECT count(*) FROM leave_types t WHERE t.department_id = d.department_id) AS leave_types,
  (SELECT count(*) FROM duty_types t WHERE t.department_id = d.department_id) AS on_call,
  (SELECT count(*) FROM job_types j WHERE j.department_id = d.department_id) AS jobs
FROM departments d WHERE d.name = 'Mareeba Hospital';
