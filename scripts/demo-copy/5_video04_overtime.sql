-- Sets up the demo doctor login for recording help video 04 (callbacks,
-- overtime, patient detail, My Variations) in one take:
--   1. The demo doctor becomes an advanced trainee on a Late shift that
--      ends a few minutes after you run this.
--   2. Open Variation before it ends: the blue Overtime button is there.
--      Tap it and the timer waits for the shift end, then runs.
--   3. Tap Overtime Complete, record it, add a patient, download it.
--   4. A few minutes after the shift end, ED and Anaesthetics on call
--      start, and Variation shows a green Callback button for each (the
--      app re-checks every minute).
-- Leave a minute or two of dead space at each end to cut when editing.
--
-- Demo copy only (Wattle Creek Hospital). Run 1 and 2 first. Change the
-- two numbers marked EDIT, run it in the Supabase SQL Editor just before
-- recording, and run 5b_video04_restore.sql afterwards. Safe to re-run:
-- each run first puts back what the last one changed.

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
  v_shift_ends_in int := 4;    -- EDIT: minutes from now until the Late shift ends
  v_on_call_after int := 5;    -- EDIT: minutes after the shift end that on call starts

  v_dept uuid := (SELECT department_id FROM departments WHERE name = 'Wattle Creek Hospital');
  v_district uuid := (SELECT district_id FROM districts WHERE name = 'Demo District');
  v_now timestamp := now() AT TIME ZONE 'Australia/Brisbane';
  v_today date := v_now::date;
  v_end time := (v_now + make_interval(mins => v_shift_ends_in))::time;
  v_on_call time := (v_now + make_interval(mins => v_shift_ends_in + v_on_call_after))::time;
  v_doctor uuid;
  v_doctor_name text;
  v_at_rank text;
  v_shift uuid;
  v_type record;
BEGIN
  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'No demo copy found. Run 1_copy_innisfail_to_demo.sql first.';
  END IF;

  -- Put back anything an earlier run changed.
  UPDATE staff s SET rank = b.data->>'rank' FROM demo_video_backup b WHERE b.kind = 'rank' AND s.staff_id = b.ref;
  UPDATE district_doctors d SET level = b.data->>'level' FROM demo_video_backup b WHERE b.kind = 'level' AND d.doctor_id = b.ref;
  UPDATE duty_types t SET start_time = (b.data->>'start_time')::time, end_time = (b.data->>'end_time')::time
    FROM demo_video_backup b WHERE b.kind = 'duty_type' AND t.duty_type_id = b.ref;
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

  -- An advanced trainee, if the department has that rank.
  SELECT rank INTO v_at_rank FROM rank_supervision_rules
  WHERE department_id = v_dept AND rank ILIKE '%advanced%' ORDER BY sort_order LIMIT 1;
  IF v_at_rank IS NOT NULL THEN
    INSERT INTO demo_video_backup SELECT 'rank', staff_id, jsonb_build_object('rank', rank) FROM staff WHERE staff_id = v_doctor;
    UPDATE staff SET rank = v_at_rank WHERE staff_id = v_doctor;
  ELSE
    RAISE NOTICE 'No advanced trainee rank in the demo department; rank left as it is.';
  END IF;
  INSERT INTO demo_video_backup SELECT 'level', doctor_id, jsonb_build_object('level', level)
    FROM district_doctors WHERE district_id = v_district AND name = v_doctor_name;
  UPDATE district_doctors SET level = 'advanced_trainee' WHERE district_id = v_district AND name = v_doctor_name;

  -- A Late shift today, 8 hours, ending in v_shift_ends_in minutes.
  INSERT INTO shifts (department_id, name, day_type, start_time, end_time, session, active)
  SELECT v_dept, 'Late', day_type, v_end - interval '8 hours', v_end, session, true
  FROM shifts WHERE department_id = v_dept AND active ORDER BY end_time DESC LIMIT 1
  RETURNING shift_id INTO v_shift;
  INSERT INTO demo_video_backup VALUES ('shift', v_shift, '{}');
  INSERT INTO staff_assignments (assignment_id, department_id, date, staff_id, shift_id, on_call)
  VALUES (gen_random_uuid(), v_dept, v_today, v_doctor, v_shift, false);

  -- ED and Anaesthetics on call start v_on_call_after minutes after the
  -- shift ends and run to 08:00, with the doctor on both tonight.
  FOR v_type IN
    SELECT * FROM duty_types
    WHERE department_id = v_dept AND active AND counts_as_on_call
      AND (label ILIKE '%anaes%' OR label ILIKE 'ED%' OR label ILIKE '%emergency%')
  LOOP
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
    RAISE NOTICE 'On call: % from % to 08:00', v_type.label, v_on_call;
  END LOOP;

  RAISE NOTICE '% (%) is on Late until %, then on call from %.',
    v_doctor_name, coalesce(v_at_rank, 'rank unchanged'), v_end, v_on_call;
END $$;

COMMIT;

-- What it set up:
SELECT kind, count(*) FROM demo_video_backup GROUP BY kind ORDER BY kind;
