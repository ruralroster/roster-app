-- Sets up the demo doctor login for showing overtime and a callback live
-- in a pitch, today:
--   1. An Early shift today that ends at 11:30. The blue Overtime button
--      shows on Variation from 11:00 (30 min before the end) until 15:30.
--      Tapped before 11:30, the timer waits for 11:30; tapped after, it
--      asks "Overtime since 11:30?".
--   2. ED on call from 11:30 until 08:00 tomorrow, with the doctor on it.
--      The green Callback button shows on Variation for all of that.
-- Only one variation runs at a time: do Overtime, tap Overtime Complete,
-- then Callback. Both then show for the officer under Reports > Pay
-- Variations.
--
-- Demo copy only (Wattle Creek Hospital). Run 1 and 2 first. Change the
-- two times marked EDIT if you need to, run this in the Supabase SQL
-- Editor, and run 5b_video04_restore.sql afterwards to put everything
-- back. Safe to re-run: each run first puts back what the last one (or 5)
-- changed.

BEGIN;

CREATE TABLE IF NOT EXISTS demo_video_backup (
  kind text NOT NULL,
  ref uuid NOT NULL,
  data jsonb NOT NULL
);
-- Nobody reads this through the app: RLS on with no policies.
ALTER TABLE demo_video_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON demo_video_backup FROM anon, authenticated;

DO $$
DECLARE
  v_shift_end time := '11:30';  -- EDIT: when the Early shift ends (Overtime from 30 min before)
  v_on_call time := '11:30';    -- EDIT: when ED on call starts (runs to 08:00 tomorrow)

  v_dept uuid := (SELECT department_id FROM departments WHERE name = 'Wattle Creek Hospital');
  v_district uuid := (SELECT district_id FROM districts WHERE name = 'Demo District');
  v_today date := (now() AT TIME ZONE 'Australia/Brisbane')::date;
  v_doctor uuid;
  v_doctor_name text;
  v_shift uuid;
  v_location uuid;
  v_type record;
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'No demo copy found. Run 1_copy_innisfail_to_demo.sql first.';
  END IF;

  -- Put back anything an earlier run (this or 5) changed.
  UPDATE staff s SET rank = b.data->>'rank' FROM demo_video_backup b WHERE b.kind = 'rank' AND s.staff_id = b.ref;
  UPDATE district_doctors d SET level = b.data->>'level' FROM demo_video_backup b WHERE b.kind = 'level' AND d.doctor_id = b.ref;
  UPDATE duty_types t SET start_time = (b.data->>'start_time')::time, end_time = (b.data->>'end_time')::time
    FROM demo_video_backup b WHERE b.kind = 'duty_type' AND t.duty_type_id = b.ref;
  DELETE FROM callbacks c USING duty_assignments d
    WHERE d.duty_id IN (SELECT ref FROM demo_video_backup WHERE kind = 'video_duty')
      AND c.kind = 'callback' AND c.department_id = d.department_id AND c.staff_id = d.staff_id
      AND c.duty_date = d.date AND c.duty_type = d.duty_type;
  DELETE FROM duty_assignments WHERE duty_id IN (SELECT ref FROM demo_video_backup WHERE kind = 'video_duty');
  INSERT INTO duty_assignments (duty_id, department_id, date, staff_id, duty_type)
    SELECT b.ref, (b.data->>'department_id')::uuid, (b.data->>'date')::date, (b.data->>'staff_id')::uuid, b.data->>'duty_type'
    FROM demo_video_backup b WHERE b.kind = 'duty'
    ON CONFLICT DO NOTHING;
  DELETE FROM staff_assignments WHERE shift_id IN (SELECT ref FROM demo_video_backup WHERE kind = 'shift');
  DELETE FROM callbacks WHERE shift_id IN (SELECT ref FROM demo_video_backup WHERE kind = 'shift');
  DELETE FROM shifts WHERE shift_id IN (SELECT ref FROM demo_video_backup WHERE kind = 'shift');
  DELETE FROM demo_video_backup;

  -- The demo doctor login: the linked Wattle Creek person who isn't the officer.
  SELECT staff_id, name INTO v_doctor, v_doctor_name FROM staff
  WHERE department_id = v_dept AND user_id IS NOT NULL AND coalesce(role, '') <> 'officer'
  ORDER BY name LIMIT 1;
  IF v_doctor IS NULL THEN
    RAISE EXCEPTION 'No demo doctor login. Run 2_link_demo_logins.sql first.';
  END IF;

  -- An Early shift today, 4 hours, ending at v_shift_end.
  INSERT INTO shifts (department_id, name, day_type, start_time, end_time, session, active)
  SELECT v_dept, 'Early', day_type, v_shift_end - interval '4 hours', v_shift_end, session, true
  FROM shifts WHERE department_id = v_dept AND active ORDER BY start_time LIMIT 1
  RETURNING shift_id INTO v_shift;
  INSERT INTO demo_video_backup VALUES ('shift', v_shift, '{}');
  -- In ED if there is one, or the first location.
  SELECT location_id INTO v_location FROM locations
  WHERE department_id = v_dept
  ORDER BY (name ILIKE 'ED%' OR name ILIKE '%emergency%') DESC, name LIMIT 1;
  IF v_location IS NULL THEN
    RAISE EXCEPTION 'The demo department has no locations.';
  END IF;
  -- As whatever role they're usually rostered as (consultant or registrar).
  INSERT INTO staff_assignments (assignment_id, department_id, date, staff_id, shift_id, location_id, role, on_call)
  VALUES (gen_random_uuid(), v_dept, v_today, v_doctor, v_shift, v_location,
    coalesce((SELECT role FROM staff_assignments WHERE staff_id = v_doctor AND role IS NOT NULL ORDER BY date DESC LIMIT 1), 'registrar'),
    false);

  -- ED on call from v_on_call to 08:00, with the doctor on it today.
  SELECT * INTO v_type FROM duty_types
  WHERE department_id = v_dept AND active AND counts_as_on_call
    AND (label ILIKE 'ED%' OR label ILIKE '%emergency%')
  ORDER BY label LIMIT 1;
  IF v_type.duty_type_id IS NULL THEN
    SELECT * INTO v_type FROM duty_types
    WHERE department_id = v_dept AND active AND counts_as_on_call
    ORDER BY label LIMIT 1;
  END IF;
  IF v_type.duty_type_id IS NULL THEN
    RAISE EXCEPTION 'The demo department has no on-call duty types.';
  END IF;

  INSERT INTO demo_video_backup VALUES ('duty_type', v_type.duty_type_id,
    jsonb_build_object('start_time', v_type.start_time, 'end_time', v_type.end_time));
  UPDATE duty_types SET start_time = v_on_call, end_time = '08:00' WHERE duty_type_id = v_type.duty_type_id;

  INSERT INTO demo_video_backup
    SELECT 'duty', duty_id, to_jsonb(d) FROM duty_assignments d
    WHERE department_id = v_dept AND date = v_today AND duty_type = v_type.key;
  DELETE FROM duty_assignments WHERE department_id = v_dept AND date = v_today AND duty_type = v_type.key;
  WITH ins AS (
    INSERT INTO duty_assignments (duty_id, department_id, date, staff_id, duty_type)
    VALUES (gen_random_uuid(), v_dept, v_today, v_doctor, v_type.key) RETURNING duty_id
  )
  INSERT INTO demo_video_backup SELECT 'video_duty', duty_id, '{}' FROM ins;

  RAISE NOTICE '% is on Early until %, and on % call from % to 08:00.',
    v_doctor_name, v_shift_end, v_type.label, v_on_call;
END $$;

COMMIT;

-- Who it is, and what they're on today:
SELECT s.name AS demo_doctor, s.rank,
       (SELECT string_agg(sh.name || ' ' || to_char(sh.start_time, 'HH24:MI') || '-' || to_char(sh.end_time, 'HH24:MI'), ', ')
          FROM staff_assignments a JOIN shifts sh ON sh.shift_id = a.shift_id
         WHERE a.staff_id = s.staff_id AND a.date = (now() AT TIME ZONE 'Australia/Brisbane')::date) AS shifts_today,
       (SELECT string_agg(t.label || ' ' || to_char(t.start_time, 'HH24:MI') || '-' || to_char(t.end_time, 'HH24:MI'), ', ')
          FROM duty_assignments d JOIN duty_types t ON t.department_id = d.department_id AND t.key = d.duty_type
         WHERE d.staff_id = s.staff_id AND d.date = (now() AT TIME ZONE 'Australia/Brisbane')::date) AS on_call_today
FROM staff s
WHERE s.department_id = (SELECT department_id FROM departments WHERE name = 'Wattle Creek Hospital')
  AND s.user_id IS NOT NULL AND coalesce(s.role, '') <> 'officer';
