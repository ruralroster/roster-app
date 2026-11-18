-- Puts the demo copy back after 5 (help video 04) or 5c (the pitch): the
-- doctor's rank and level, the on-call times and whoever was on them, and
-- removes the demo shift and on call, with any overtime and callbacks
-- recorded on them.
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.demo_video_backup') IS NULL THEN
    RAISE NOTICE 'Nothing to put back.';
    RETURN;
  END IF;
  UPDATE staff s SET rank = b.data->>'rank' FROM demo_video_backup b WHERE b.kind = 'rank' AND s.staff_id = b.ref;
  UPDATE district_doctors d SET level = b.data->>'level' FROM demo_video_backup b WHERE b.kind = 'level' AND d.doctor_id = b.ref;
  UPDATE duty_types t SET start_time = (b.data->>'start_time')::time, end_time = (b.data->>'end_time')::time
    FROM demo_video_backup b WHERE b.kind = 'duty_type' AND t.duty_type_id = b.ref;
  -- Callbacks recorded on the demo on call, then the demo on call itself.
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
END $$;

DROP TABLE IF EXISTS demo_video_backup;

COMMIT;
