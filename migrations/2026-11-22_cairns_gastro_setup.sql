-- Sets up Cairns Gastroenterology as an Rstar department, ready for its
-- roster to be imported (Import tab, the "Session tabs (e.g. Cairns
-- Gastroenterology)" format: src/gastroRosterExcelImport.js).
--
--   - The department, with the gastro import format and its sessions:
--     AM 08:00-12:30, PM 13:00-17:00.
--   - Ranks from the Reference tab's specialties. Gastroenterologists,
--     physicians, respiratory physicians and surgeons are senior;
--     registrars, advanced trainees and nurse practitioners aren't (so on
--     call, which is seniors only, never offers them).
--   - Locations: the procedure rooms, manometry, the ward, the clinic,
--     non-clinical, and the outreach sites.
--   - Activities: Endoscopy, Manometry, Ward Round, Clinic, Admin,
--     Outreach Endoscopy, Outreach Clinic.
--   - On call: On Call Endoscopy, 08:00 to 08:00 the next day.
--   - Leave: AL.
--   - Planner jobs (one place each, anyone) for the rooms, manometry, the
--     clinic and the ward round, AM and PM, so each session is a card the
--     registrar and advanced trainee slots show as empty places on.
--
-- Staff come from the roster file's Reference tab (Import tab > Check for
-- Missing Staff), so no names are in here. Visiting specialists and nurse
-- practitioners are on the roster with no login unless they're invited.
--
-- Run in the Supabase SQL Editor. Safe to re-run: nothing is added twice.

BEGIN;

DO $$
DECLARE
  v_dept uuid := (SELECT department_id FROM departments WHERE name = 'Cairns Gastroenterology');
  v_activity uuid;
  v_shift uuid;
  v_job uuid;
  r record;
BEGIN
  IF v_dept IS NULL THEN
    v_dept := gen_random_uuid();
    INSERT INTO departments (department_id, name) VALUES (v_dept, 'Cairns Gastroenterology');
  END IF;
  UPDATE departments SET roster_import_format = 'gastro',
    morning_start = '08:00', morning_end = '12:30', afternoon_start = '13:00', afternoon_end = '17:00'
  WHERE department_id = v_dept;

  INSERT INTO rank_supervision_rules (department_id, rank, requires_supervision, sort_order)
  SELECT v_dept, x.rank, x.req, x.ord
  FROM (VALUES
    ('Gastroenterologist', false, 0),
    ('Physician', false, 1),
    ('Respiratory Physician', false, 2),
    ('Surgeon', false, 3),
    ('Advanced Trainee', true, 4),
    ('Registrar', true, 5),
    ('Nurse Practitioner', true, 6)
  ) AS x(rank, req, ord)
  WHERE NOT EXISTS (SELECT 1 FROM rank_supervision_rules WHERE department_id = v_dept AND rank = x.rank);

  INSERT INTO locations (department_id, name)
  SELECT v_dept, x.name
  FROM (VALUES ('Procedure Room 1'), ('Procedure Room 2'), ('Procedure Room 3'), ('Manometry'), ('Ward'),
    ('Cairns Gastro Clinic'), ('Non-clinical'), ('Atherton'), ('Innisfail'), ('Mareeba'), ('Mossman'),
    ('Weipa'), ('Yarrabah'), ('Thursday Island')) AS x(name)
  WHERE NOT EXISTS (SELECT 1 FROM locations WHERE department_id = v_dept AND name = x.name);

  INSERT INTO activity_types (department_id, name)
  SELECT v_dept, x.name
  FROM (VALUES ('Endoscopy'), ('Manometry'), ('Ward Round'), ('Clinic'), ('Admin'), ('Outreach Endoscopy'), ('Outreach Clinic')) AS x(name)
  WHERE NOT EXISTS (SELECT 1 FROM activity_types WHERE department_id = v_dept AND name = x.name);

  INSERT INTO leave_types (department_id, name, code)
  SELECT v_dept, 'Annual Leave', 'AL'
  WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE department_id = v_dept AND code = 'AL');

  IF NOT EXISTS (SELECT 1 FROM duty_types WHERE department_id = v_dept AND key = 'on_call_endoscopy') THEN
    INSERT INTO activity_types (department_id, name) VALUES (v_dept, 'On Call Endoscopy')
    RETURNING activity_id INTO v_activity;
    INSERT INTO shifts (department_id, name, day_type, start_time, end_time, session, active)
    VALUES (v_dept, 'On Call Endoscopy On Call', 'weekday', '08:00', '08:00', 'night', true)
    RETURNING shift_id INTO v_shift;
    INSERT INTO duty_types (department_id, key, label, counts_as_on_call, sort_order, start_time, end_time, activity_type_id, shift_id, abbreviation)
    VALUES (v_dept, 'on_call_endoscopy', 'On Call Endoscopy', true, 0, '08:00', '08:00', v_activity, v_shift, 'Endo OC');
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('Room 1 AM', 'Procedure Room 1', 'Endoscopy', '08:00', '12:30', 0),
      ('Room 1 PM', 'Procedure Room 1', 'Endoscopy', '13:00', '17:00', 1),
      ('Room 2 AM', 'Procedure Room 2', 'Endoscopy', '08:00', '12:30', 2),
      ('Room 2 PM', 'Procedure Room 2', 'Endoscopy', '13:00', '17:00', 3),
      ('Room 3 AM', 'Procedure Room 3', 'Endoscopy', '08:00', '12:30', 4),
      ('Room 3 PM', 'Procedure Room 3', 'Endoscopy', '13:00', '17:00', 5),
      ('Manometry AM', 'Manometry', 'Manometry', '08:00', '12:30', 6),
      ('Ward Round', 'Ward', 'Ward Round', '08:00', '12:30', 7),
      ('Clinic AM', 'Cairns Gastro Clinic', 'Clinic', '08:00', '12:30', 8),
      ('Clinic PM', 'Cairns Gastro Clinic', 'Clinic', '13:00', '17:00', 9),
      ('Director Admin', 'Non-clinical', 'Admin', '08:00', '17:00', 10)
    ) AS x(name, location, activity, start_time, end_time, ord)
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
      VALUES (v_dept, v_job, 'Doctor', 'staff', 'any', 1, 0);
    END IF;
  END LOOP;

  RAISE NOTICE 'Cairns Gastroenterology is department %', v_dept;
END $$;

COMMIT;

SELECT d.name, d.department_id, d.roster_import_format,
  (SELECT count(*) FROM locations l WHERE l.department_id = d.department_id) AS locations,
  (SELECT count(*) FROM activity_types a WHERE a.department_id = d.department_id) AS activities,
  (SELECT count(*) FROM rank_supervision_rules r WHERE r.department_id = d.department_id) AS ranks,
  (SELECT count(*) FROM duty_types t WHERE t.department_id = d.department_id) AS on_call,
  (SELECT count(*) FROM job_types j WHERE j.department_id = d.department_id) AS jobs
FROM departments d WHERE d.name = 'Cairns Gastroenterology';
