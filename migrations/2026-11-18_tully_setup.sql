-- Sets up Tully Hospital as a new Rstar department, ready for its roster
-- to be imported (Import tab, the "Fortnight tabs (e.g. Tully)" format:
-- src/tullyRosterExcelImport.js).
--
--   - The department, with the Tully import format.
--   - Ranks: SMO (senior) and RMO (junior).
--   - Locations: the Work Areas on the roster. Ward/ED, ED/ward and
--     Ward/ED/GP are cover of more than one area, each its own location.
--     Non-clinical (CST = admin time, orientation, travel, meetings) is
--     clash-free and doesn't count towards FTE, like admin elsewhere.
--   - Activities: SMO Cover and RMO Cover (so SMO and RMO shifts in the
--     same place are separate jobs and fairness records), plus the
--     non-clinical ones.
--   - Leave types: AL, PDL, LWOP, SL (sick), CL (carer's), PHSD (stddown:
--     rostered leave on a public holiday, for reduced staffing).
--   - On call: Senior Back-up On Call (SBOC), 17:00 to 08:00.
--   - Planner jobs, one place each, from the shifts the roster actually
--     uses (counted over the last ten fortnights), so imported shifts land
--     on job cards and Suggest can fill new weeks.
--   (No "Day Off" shift: shifts now need times, and it's only for Shift
--   Pattern Rules, which Tully hasn't set up. Add one with the rules.)
--
-- Staff come from the roster file itself (Import tab > Check for Missing
-- Staff, from the three latest fortnights), so no names are in here.
--
-- Run in the Supabase SQL Editor. Safe to re-run: nothing is added twice.

BEGIN;

DO $$
DECLARE
  v_dept uuid := (SELECT department_id FROM departments WHERE name = 'Tully Hospital');
  v_activity uuid;
  v_shift uuid;
  v_job uuid;
  r record;
BEGIN
  IF v_dept IS NULL THEN
    v_dept := gen_random_uuid();
    INSERT INTO departments (department_id, name) VALUES (v_dept, 'Tully Hospital');
  END IF;
  UPDATE departments SET roster_import_format = 'tully' WHERE department_id = v_dept;

  -- Ranks.
  INSERT INTO rank_supervision_rules (department_id, rank, requires_supervision, sort_order)
  SELECT v_dept, x.rank, x.req, x.ord
  FROM (VALUES ('SMO', false, 0), ('RMO', true, 1)) AS x(rank, req, ord)
  WHERE NOT EXISTS (SELECT 1 FROM rank_supervision_rules WHERE department_id = v_dept AND rank = x.rank);

  -- Locations.
  INSERT INTO locations (department_id, name)
  SELECT v_dept, x.name
  FROM (VALUES ('Emergency Department'), ('Ward'), ('Ward & ED'), ('Ward, ED & GP'), ('GP Clinic'), ('Jumbun Clinic'), ('Non-clinical')) AS x(name)
  WHERE NOT EXISTS (SELECT 1 FROM locations WHERE department_id = v_dept AND name = x.name);

  -- Activities.
  INSERT INTO activity_types (department_id, name, abbreviation)
  SELECT v_dept, x.name, x.abbr
  FROM (VALUES ('SMO Cover', 'SMO'), ('RMO Cover', 'RMO'), ('Admin Time', 'CST'), ('Orientation', NULL), ('Travel', NULL), ('Meeting', NULL)) AS x(name, abbr)
  WHERE NOT EXISTS (SELECT 1 FROM activity_types WHERE department_id = v_dept AND name = x.name);

  -- Leave types.
  INSERT INTO leave_types (department_id, name, code)
  SELECT v_dept, x.name, x.code
  FROM (VALUES
    ('Annual Leave', 'AL'),
    ('Professional Development Leave', 'PDL'),
    ('Leave Without Pay', 'LWOP'),
    ('Sick Leave', 'SL'),
    ('Carer''s Leave', 'CL'),
    ('Public Holiday Stand-down', 'PHSD')
  ) AS x(name, code)
  WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE department_id = v_dept AND code = x.code);

  -- SBOC on call, set up as Settings > Duty Types would: its own activity
  -- and shift.
  IF NOT EXISTS (SELECT 1 FROM duty_types WHERE department_id = v_dept AND key = 'senior_back_up_on_call_sboc') THEN
    INSERT INTO activity_types (department_id, name) VALUES (v_dept, 'Senior Back-up On Call (SBOC)')
    RETURNING activity_id INTO v_activity;
    INSERT INTO shifts (department_id, name, day_type, start_time, end_time, session, active)
    VALUES (v_dept, 'Senior Back-up On Call (SBOC) On Call', 'weekday', '17:00', '08:00', 'night', true)
    RETURNING shift_id INTO v_shift;
    INSERT INTO duty_types (department_id, key, label, counts_as_on_call, sort_order, start_time, end_time, activity_type_id, shift_id, abbreviation)
    VALUES (v_dept, 'senior_back_up_on_call_sboc', 'Senior Back-up On Call (SBOC)', true, 0, '17:00', '08:00', v_activity, v_shift, 'SBOC');
  END IF;

  -- Planner jobs: name, location, activity, hours, the place's grade.
  FOR r IN
    SELECT * FROM (VALUES
      ('ED Day SMO',      'Emergency Department', 'SMO Cover',  '08:00', '18:00', 'senior', 'SMO', 0),
      ('ED Late SMO',     'Emergency Department', 'SMO Cover',  '12:00', '22:00', 'senior', 'SMO', 1),
      ('Ward SMO',        'Ward',                 'SMO Cover',  '08:00', '18:00', 'senior', 'SMO', 2),
      ('Ward & ED SMO',   'Ward & ED',            'SMO Cover',  '08:00', '18:00', 'senior', 'SMO', 3),
      ('GP SMO',          'GP Clinic',            'SMO Cover',  '08:00', '17:00', 'senior', 'SMO', 4),
      ('Jumbun SMO',      'Jumbun Clinic',        'SMO Cover',  '08:00', '17:00', 'senior', 'SMO', 5),
      ('ED RMO',          'Emergency Department', 'RMO Cover',  '10:00', '21:30', 'junior', 'RMO', 6),
      ('RMO Day',         'Ward, ED & GP',        'RMO Cover',  '08:00', '16:30', 'junior', 'RMO', 7),
      ('RMO Weekend',     'Ward & ED',            'RMO Cover',  '10:30', '22:00', 'junior', 'RMO', 8),
      ('RMO Night',       'Ward & ED',            'RMO Cover',  '21:00', '08:30', 'junior', 'RMO', 9),
      ('GP RMO',          'GP Clinic',            'RMO Cover',  '08:00', '17:30', 'junior', 'RMO', 10),
      ('Jumbun RMO',      'Jumbun Clinic',        'RMO Cover',  '08:00', '16:30', 'junior', 'RMO', 11),
      ('Admin (CST)',     'Non-clinical',         'Admin Time', '08:00', '17:00', 'any',    'Doctor', 12)
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

  RAISE NOTICE 'Tully Hospital is department %', v_dept;
END $$;

COMMIT;

-- What's there now:
SELECT d.name, d.department_id, d.roster_import_format,
  (SELECT count(*) FROM locations l WHERE l.department_id = d.department_id) AS locations,
  (SELECT count(*) FROM activity_types a WHERE a.department_id = d.department_id) AS activities,
  (SELECT count(*) FROM leave_types t WHERE t.department_id = d.department_id) AS leave_types,
  (SELECT count(*) FROM duty_types t WHERE t.department_id = d.department_id) AS on_call,
  (SELECT count(*) FROM job_types j WHERE j.department_id = d.department_id) AS jobs
FROM departments d WHERE d.name = 'Tully Hospital';
