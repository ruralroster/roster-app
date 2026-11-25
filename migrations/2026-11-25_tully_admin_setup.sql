-- Sets up Tully Admin: the administration officers' roster as its own
-- Rstar department (they aren't tied to one clinical department), ready for
-- the roster to be imported (Import tab, "Admin fortnight tabs":
-- src/adminRosterExcelImport.js).
--
--   - departments.full_time_hours_per_week: full time for FTE, 44 by
--     default (doctors); 38 here (76 hours a fortnight, the roster's key).
--   - The department, with the admin import format and 38-hour weeks.
--   - Rank: Administration Officer.
--   - Locations: the roster's work codes (RCP, PTS, REV, ED, TL, WKD, ADMIN,
--     CLINICS, ROI, WC, JUMBUN, TH/RC, TRAINING). Rename them in Settings to
--     their full names if you like; the import then needs a Map… once each.
--   - Activity: Admin Cover.
--   - Leave: AL, LSL, ML, SL, CL, PHSD (public holiday stand-down), LWOP,
--     RPL (reproductive), SARAS, CON (concessional).
--   - The roster's own shifts (its key): 0800-1606, 0830-1636, 0900-1706,
--     0700-1506 and 1500-2306.
--
-- Staff come from the file (Check for Missing Staff), so no names here.
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE departments ADD COLUMN IF NOT EXISTS full_time_hours_per_week numeric NOT NULL DEFAULT 44
  CHECK (full_time_hours_per_week > 0 AND full_time_hours_per_week <= 80);

DO $$
DECLARE
  v_dept uuid := (SELECT department_id FROM departments WHERE name = 'Tully Admin');
  r record;
BEGIN
  IF v_dept IS NULL THEN
    v_dept := gen_random_uuid();
    INSERT INTO departments (department_id, name) VALUES (v_dept, 'Tully Admin');
  END IF;
  UPDATE departments SET roster_import_format = 'admin', full_time_hours_per_week = 38 WHERE department_id = v_dept;

  INSERT INTO rank_supervision_rules (department_id, rank, requires_supervision, sort_order)
  SELECT v_dept, 'Administration Officer', false, 0
  WHERE NOT EXISTS (SELECT 1 FROM rank_supervision_rules WHERE department_id = v_dept AND rank = 'Administration Officer');

  INSERT INTO locations (department_id, name)
  SELECT v_dept, x.name
  FROM (VALUES ('RCP'), ('PTS'), ('REV'), ('ED'), ('TL'), ('WKD'), ('ADMIN'), ('CLINICS'), ('ROI'), ('WC'),
    ('JUMBUN'), ('TH/RC'), ('TRAINING')) AS x(name)
  WHERE NOT EXISTS (SELECT 1 FROM locations WHERE department_id = v_dept AND name = x.name);

  INSERT INTO activity_types (department_id, name)
  SELECT v_dept, 'Admin Cover'
  WHERE NOT EXISTS (SELECT 1 FROM activity_types WHERE department_id = v_dept AND name = 'Admin Cover');

  INSERT INTO leave_types (department_id, name, code)
  SELECT v_dept, x.name, x.code
  FROM (VALUES ('Annual Leave', 'AL'), ('Long Service Leave', 'LSL'), ('Maternity Leave', 'ML'), ('Sick Leave', 'SL'),
    ('Carer''s Leave', 'CL'), ('Public Holiday Stand-down', 'PHSD'), ('Leave Without Pay', 'LWOP'),
    ('Reproductive Leave', 'RPL'), ('SARAS Leave', 'SARAS'), ('Concessional Leave', 'CON')) AS x(name, code)
  WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE department_id = v_dept AND code = x.code);

  FOR r IN SELECT * FROM (VALUES
    ('Day 0800', '08:00', '16:06', 'full'),
    ('Day 0830', '08:30', '16:36', 'full'),
    ('Day 0900', '09:00', '17:06', 'full'),
    ('ED AM', '07:00', '15:06', 'full'),
    ('ED PM', '15:00', '23:06', 'PM')
  ) AS x(name, start_time, end_time, session)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM shifts WHERE department_id = v_dept AND start_time = r.start_time::time AND end_time = r.end_time::time AND active) THEN
      INSERT INTO shifts (department_id, name, day_type, start_time, end_time, session, active)
      VALUES (v_dept, r.name, 'weekday', r.start_time::time, r.end_time::time, r.session, true);
    END IF;
  END LOOP;

  RAISE NOTICE 'Tully Admin is department %', v_dept;
END $$;

COMMIT;

SELECT d.name, d.department_id, d.roster_import_format, d.full_time_hours_per_week,
  (SELECT count(*) FROM locations l WHERE l.department_id = d.department_id) AS locations,
  (SELECT count(*) FROM leave_types t WHERE t.department_id = d.department_id) AS leave_types,
  (SELECT count(*) FROM shifts s WHERE s.department_id = d.department_id) AS shifts
FROM departments d WHERE d.name = 'Tully Admin';
