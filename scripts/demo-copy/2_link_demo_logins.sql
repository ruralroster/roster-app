-- Links two demo logins to people in the demo copy, so they can sign in to
-- Rstar and DR Roster for screenshots.
--
-- First, in Supabase: Authentication → Users → Add user → Create new user,
-- twice (tick Auto Confirm User). One is the officer, one is a doctor.
-- Then put their two email addresses in the two lines marked EDIT below and
-- run this. It picks:
--   - the officer: a Wattle Creek officer (so also a Wattle Creek site
--     officer on DR Roster);
--   - the doctor: the registrar with the most shifts in the next 2 weeks,
--     who's also a district doctor, so My shifts and Swaps have content.
-- Their screens still show their made-up name and @demo.example email.

BEGIN;

CREATE TEMP TABLE logins ON COMMIT DROP AS
SELECT lower(trim('officer-login@example.com')) AS officer_email,   -- EDIT
       lower(trim('doctor-login@example.com'))  AS doctor_email;    -- EDIT

DO $$
DECLARE
  v_dept uuid := (SELECT department_id FROM departments WHERE name = 'Wattle Creek Hospital');
  v_district uuid := (SELECT district_id FROM districts WHERE name = 'Demo District');
  v_officer_user uuid := (SELECT id FROM auth.users u, logins l WHERE lower(u.email) = l.officer_email);
  v_doctor_user uuid := (SELECT id FROM auth.users u, logins l WHERE lower(u.email) = l.doctor_email);
  v_officer uuid;
  v_doctor uuid;
  v_doctor_name text;
BEGIN
  IF v_dept IS NULL OR v_district IS NULL THEN
    RAISE EXCEPTION 'No demo copy found. Run 1_copy_innisfail_to_demo.sql first.';
  END IF;
  IF v_officer_user IS NULL OR v_doctor_user IS NULL THEN
    RAISE EXCEPTION 'Create both logins under Authentication first, and check the two emails at the top of this script.';
  END IF;

  INSERT INTO profiles (user_id, email, must_reset_password)
  SELECT u.id, lower(u.email), false FROM auth.users u WHERE u.id IN (v_officer_user, v_doctor_user)
  ON CONFLICT (user_id) DO UPDATE SET must_reset_password = false;

  -- Unlink anyone linked by an earlier run.
  UPDATE staff SET user_id = NULL WHERE department_id = v_dept AND user_id IN (v_officer_user, v_doctor_user);
  UPDATE district_doctors SET user_id = NULL WHERE district_id = v_district AND user_id IN (v_officer_user, v_doctor_user);

  SELECT staff_id INTO v_officer FROM staff
  WHERE department_id = v_dept AND active AND role = 'officer' ORDER BY name LIMIT 1;
  IF v_officer IS NULL THEN
    -- No officer in the copy: make the first consultant one.
    SELECT s.staff_id INTO v_officer FROM staff s
    JOIN district_doctors d ON d.district_id = v_district AND d.name = s.name AND d.level = 'consultant'
    WHERE s.department_id = v_dept AND s.active ORDER BY s.name LIMIT 1;
    UPDATE staff SET role = 'officer' WHERE staff_id = v_officer;
  END IF;
  UPDATE staff SET user_id = v_officer_user WHERE staff_id = v_officer;

  SELECT s.staff_id, s.name INTO v_doctor, v_doctor_name FROM staff s
  JOIN district_doctors d ON d.district_id = v_district AND d.name = s.name
  WHERE s.department_id = v_dept AND s.active AND s.staff_id <> v_officer
  ORDER BY (d.level IN ('registrar', 'advanced_trainee')) DESC,
           (SELECT count(*) FROM staff_assignments a
            WHERE a.staff_id = s.staff_id AND a.date BETWEEN current_date AND current_date + 14) DESC,
           s.name
  LIMIT 1;
  UPDATE staff SET user_id = v_doctor_user WHERE staff_id = v_doctor;
  UPDATE district_doctors SET user_id = v_doctor_user
  WHERE district_id = v_district AND name = v_doctor_name;
END $$;

SELECT 'officer' AS login, s.name, s.rank FROM staff s, logins l
WHERE s.user_id = (SELECT id FROM auth.users WHERE lower(email) = l.officer_email)
UNION ALL
SELECT 'doctor', s.name, s.rank FROM staff s, logins l
WHERE s.user_id = (SELECT id FROM auth.users WHERE lower(email) = l.doctor_email);

COMMIT;
