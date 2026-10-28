-- Fills out the Demo District on DR Roster so screenshots have something
-- to show. Run after 1_copy_innisfail_to_demo.sql and 2_link_demo_logins.sql.
--
--   - open shifts at Wattle Creek and Banksia Bay over the next 4 weeks;
--   - three made-up doctors waiting on one Wattle Creek shift;
--   - one shift the demo doctor has applied for, one they're booked on;
--   - two swap listings the demo doctor could close: one at Wattle Creek,
--     one at Banksia Bay that needs "Look across sites";
--   - one swap offer between two made-up doctors waiting for the officer;
--   - real place names in the copy (phone book, locations, jobs...) made up.
--
-- Everything is marked as already sent, so nobody is emailed. Safe to
-- re-run: it first clears the Demo District's swaps, applications and
-- posted shifts. 3_remove_demo.sql removes it with the rest.

BEGIN;

CREATE TEMP TABLE dx ON COMMIT DROP AS
SELECT d.district_id AS district,
       (SELECT site_id FROM sites WHERE district_id = d.district_id AND name = 'Wattle Creek') AS wattle,
       (SELECT site_id FROM sites WHERE district_id = d.district_id AND name = 'Banksia Bay') AS banksia,
       (SELECT doctor_id FROM district_doctors WHERE district_id = d.district_id AND user_id IS NOT NULL LIMIT 1) AS me
FROM districts d WHERE d.name = 'Demo District';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dx WHERE me IS NOT NULL) THEN
    RAISE EXCEPTION 'Run 1_copy_innisfail_to_demo.sql and 2_link_demo_logins.sql first.';
  END IF;
END $$;

-- Real place names in the copy become made-up ones (Innisfail → Wattle Creek,
-- Cairns → Banksia Bay, Townsville → Coral Bay), in whatever case they're in.
CREATE FUNCTION pg_temp.unreal(t text) RETURNS text LANGUAGE sql AS $f$
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(t,
    'INNIS?FAIL', 'WATTLE CREEK', 'g'), 'Innis?fail', 'Wattle Creek', 'g'), '(?i)innis?fail', 'Wattle Creek', 'g'),
    'CAIRNS', 'BANKSIA BAY', 'g'), '(?i)cairns', 'Banksia Bay', 'g'),
    'TOWNSVILLE', 'CORAL BAY', 'g'), '(?i)townsville', 'Coral Bay', 'g')
$f$;

DO $$
DECLARE v_dept uuid := (SELECT department_id FROM departments WHERE name = 'Wattle Creek Hospital');
BEGIN
  UPDATE phone_book_entries SET label = pg_temp.unreal(label) WHERE department_id = v_dept;
  UPDATE locations SET name = pg_temp.unreal(name) WHERE department_id = v_dept;
  UPDATE activity_types SET name = pg_temp.unreal(name) WHERE department_id = v_dept;
  UPDATE job_types SET name = pg_temp.unreal(name) WHERE department_id = v_dept;
  UPDATE shifts SET name = pg_temp.unreal(name) WHERE department_id = v_dept;
  UPDATE week_templates SET name = pg_temp.unreal(name) WHERE department_id = v_dept;
  UPDATE duty_types SET label = pg_temp.unreal(label) WHERE department_id = v_dept;
  UPDATE leave_types SET name = pg_temp.unreal(name) WHERE department_id = v_dept;
  UPDATE site_shift_types t SET name = pg_temp.unreal(t.name)
    FROM sites s, districts d WHERE t.site_id = s.site_id AND s.district_id = d.district_id AND d.name = 'Demo District';
  UPDATE district_notices n SET title = pg_temp.unreal(n.title)
    FROM districts d WHERE n.district_id = d.district_id AND d.name = 'Demo District';
END $$;

-- Clear the last run.
-- Clear the last run: every swap, application and posted shift in the
-- Demo District (shifts passed up from Rstar stay).
DELETE FROM district_swap_offers o USING district_swap_listings l, dx WHERE o.listing_id = l.listing_id AND l.district_id = dx.district;
DELETE FROM district_swap_listings l USING dx WHERE l.district_id = dx.district;
DELETE FROM district_applications a USING district_notices n, dx
  WHERE a.notice_id = n.notice_id AND n.district_id = dx.district AND n.source = 'officer';
DELETE FROM district_roster_shifts r USING district_notices n, dx
  WHERE r.notice_id = n.notice_id AND n.district_id = dx.district AND n.source = 'officer';
DELETE FROM district_notices n USING dx WHERE n.district_id = dx.district AND n.source = 'officer';

-- Made-up doctors to use, by site.
CREATE TEMP TABLE wd ON COMMIT DROP AS
SELECT doctor_id, level, (row_number() OVER (ORDER BY name))::int AS k
FROM district_doctors, dx WHERE district_id = dx.district AND home_site_id = dx.wattle AND user_id IS NULL AND active;
CREATE TEMP TABLE bd ON COMMIT DROP AS
SELECT doctor_id, level, (row_number() OVER (ORDER BY name))::int AS k
FROM district_doctors, dx WHERE district_id = dx.district AND home_site_id = dx.banksia AND active;

-- The demo doctor's free days (no Rstar shift) in the next 3 weeks.
CREATE TEMP TABLE free_days ON COMMIT DROP AS
SELECT g::date AS d, (row_number() OVER (ORDER BY g))::int AS k
FROM generate_series(current_date + 2, current_date + 21, interval '1 day') g
WHERE NOT EXISTS (
  SELECT 1 FROM staff_assignments a JOIN staff s ON s.staff_id = a.staff_id
  JOIN district_doctors dd ON dd.user_id = s.user_id, dx
  WHERE dd.doctor_id = dx.me AND a.date = g::date);

-- Open shifts: Wattle Creek on alternate days, Banksia Bay every third day,
-- day and night shifts, mixed positions (some the demo doctor can do).
INSERT INTO district_notices (district_id, site_id, shift_date, start_time, end_time, required_skill, notes, status,
  source, title, position, notified_at, urgent_notified_at)
SELECT dx.district, s.site, current_date + g, t.st, t.en, 'Emergency', 'demo-activity', 'open', 'officer', t.title, t.pos, now(), now()
FROM dx, generate_series(1, 28) g
CROSS JOIN LATERAL (VALUES (dx.wattle, 2, 0), (dx.banksia, 3, 1)) AS s(site, every, offs)
CROSS JOIN LATERAL (VALUES
  ('ED Day', '08:00'::time, '18:00'::time, (ARRAY['registrar', 'consultant', 'rmo'])[g % 3 + 1]),
  ('ED Night', '18:00'::time, '08:00'::time, (ARRAY['consultant', 'registrar'])[g % 2 + 1])
) AS t(title, st, en, pos)
WHERE (g + s.offs) % s.every = 0 AND (t.title = 'ED Day' OR g % 4 = 0);

-- Three applicants waiting on the first open Wattle Creek day shift.
INSERT INTO district_applications (notice_id, doctor_id, status, note, officer_notified_at, doctor_notified_at)
SELECT n.notice_id, wd.doctor_id, 'pending', 'demo-activity', now(), now()
FROM (SELECT n.notice_id FROM district_notices n, dx WHERE n.site_id = dx.wattle AND n.notes = 'demo-activity' AND n.title = 'ED Day'
      ORDER BY n.shift_date LIMIT 1) n
JOIN wd ON wd.k <= 3;

-- The demo doctor: applied for one shift, booked on another (free days).
INSERT INTO district_notices (district_id, site_id, shift_date, start_time, end_time, required_skill, notes, status, source, title, position,
  filled_by_doctor_id, notified_at, urgent_notified_at)
SELECT dx.district, CASE WHEN f.k = 2 THEN dx.wattle ELSE dx.banksia END, f.d, '08:00', '18:00', 'Emergency', 'demo-activity',
  CASE WHEN f.k = 2 THEN 'open' ELSE 'filled' END, 'officer', 'ED Day', 'registrar',
  CASE WHEN f.k = 2 THEN NULL ELSE dx.me END, now(), now()
FROM free_days f, dx WHERE f.k IN (2, 5);

INSERT INTO district_applications (notice_id, doctor_id, status, note, officer_notified_at, doctor_notified_at)
SELECT n.notice_id, dx.me, CASE WHEN n.status = 'filled' THEN 'approved' ELSE 'pending' END, 'demo-activity', now(), now()
FROM district_notices n, dx
WHERE n.notes = 'demo-activity' AND n.shift_date IN (SELECT d FROM free_days WHERE k IN (2, 5))
  AND (n.filled_by_doctor_id = dx.me OR (n.status = 'open' AND n.position = 'registrar' AND n.title = 'ED Day'
       AND n.site_id = dx.wattle AND n.shift_date = (SELECT d FROM free_days WHERE k = 2)));

-- Swap listings the demo doctor can close: a made-up doctor's shift on one
-- of the demo doctor's free days, taking any day or night of that pay
-- fortnight in return. One at Wattle Creek, one at Banksia Bay (other sites).
CREATE TEMP TABLE swap_src ON COMMIT DROP AS
SELECT x.*, gen_random_uuid() AS notice_id,
       date '2026-05-25' + ((x.d - date '2026-05-25') / 14) * 14 AS fn_start
FROM (
  SELECT dx.wattle AS site, (SELECT doctor_id FROM wd WHERE k = 4) AS doctor, (SELECT d FROM free_days WHERE k = 3) AS d, false AS other
  FROM dx
  UNION ALL
  SELECT dx.banksia, (SELECT doctor_id FROM bd WHERE k = 2), (SELECT d FROM free_days WHERE k = 4), true
  FROM dx
) x WHERE x.doctor IS NOT NULL AND x.d IS NOT NULL;

INSERT INTO district_notices (notice_id, district_id, site_id, shift_date, start_time, end_time, required_skill, notes, status, source, title,
  position, filled_by_doctor_id, notified_at, urgent_notified_at)
SELECT s.notice_id, dx.district, s.site, s.d, '08:00', '18:00', 'Emergency', 'demo-activity', 'filled', 'officer', 'ED Day', 'registrar',
  s.doctor, now(), now()
FROM swap_src s, dx;

INSERT INTO district_swap_listings (district_id, notice_id, doctor_id, service_disruption, available_slots, note, status, other_sites)
SELECT dx.district, s.notice_id, s.doctor, s.other,
  ARRAY(SELECT to_char(s.fn_start + i, 'YYYY-MM-DD') || ':' || kind
        FROM generate_series(0, 13) i, unnest(ARRAY['day', 'night']) kind
        WHERE s.fn_start + i <> s.d ORDER BY 1),
  'demo-activity', 'open', s.other
FROM swap_src s, dx;

-- A swap offer between two made-up Wattle Creek doctors, waiting for the
-- officer: doctor 5 lists a shift, doctor 6 offers one of theirs.
WITH days AS (
  SELECT current_date + 8 AS d1, current_date + 10 AS d2
), n1 AS (
  INSERT INTO district_notices (district_id, site_id, shift_date, start_time, end_time, required_skill, notes, status, source, title, position,
    filled_by_doctor_id, notified_at, urgent_notified_at)
  SELECT dx.district, dx.wattle, days.d1, '08:00', '18:00', 'Emergency', 'demo-activity', 'filled', 'officer', 'ED Day', 'registrar',
    (SELECT doctor_id FROM wd WHERE k = 5), now(), now()
  FROM dx, days RETURNING notice_id, shift_date
), n2 AS (
  INSERT INTO district_notices (district_id, site_id, shift_date, start_time, end_time, required_skill, notes, status, source, title, position,
    filled_by_doctor_id, notified_at, urgent_notified_at)
  SELECT dx.district, dx.wattle, days.d2, '08:00', '18:00', 'Emergency', 'demo-activity', 'filled', 'officer', 'ED Day', 'registrar',
    (SELECT doctor_id FROM wd WHERE k = 6), now(), now()
  FROM dx, days RETURNING notice_id, shift_date
), l AS (
  INSERT INTO district_swap_listings (district_id, notice_id, doctor_id, service_disruption, available_slots, note, status, other_sites)
  SELECT dx.district, n1.notice_id, (SELECT doctor_id FROM wd WHERE k = 5), false,
    ARRAY[to_char(n2.shift_date, 'YYYY-MM-DD') || ':day'], 'demo-activity', 'open', false
  FROM dx, n1, n2 RETURNING listing_id
)
INSERT INTO district_swap_offers (listing_id, doctor_id, offered_notice_id, note, status)
SELECT l.listing_id, (SELECT doctor_id FROM wd WHERE k = 6), n2.notice_id, 'demo-activity', 'pending'
FROM l, n2;

-- 'demo-activity' only marked this run's rows while it worked; on screen
-- they get ordinary notes.
UPDATE district_applications SET note = (ARRAY['Happy to do this one', 'Can stay back if needed', 'Free that day'])
  [1 + abs(hashtext(application_id::text)) % 3] WHERE note = 'demo-activity';
UPDATE district_swap_listings SET note = CASE WHEN other_sites THEN 'Course that weekend' ELSE 'Family wedding' END
  WHERE note = 'demo-activity';
UPDATE district_swap_offers SET note = NULL WHERE note = 'demo-activity';
UPDATE district_notices SET notes = NULL WHERE notes = 'demo-activity';

SELECT 'open district shifts' AS what, count(*) FROM district_notices n, dx WHERE n.district_id = dx.district AND n.status = 'open'
UNION ALL SELECT 'applications', count(*) FROM district_applications a JOIN district_notices n USING (notice_id), dx WHERE n.district_id = dx.district
UNION ALL SELECT 'swap listings', count(*) FROM district_swap_listings l, dx WHERE l.district_id = dx.district
UNION ALL SELECT 'swap offers', count(*) FROM district_swap_offers o JOIN district_swap_listings l USING (listing_id), dx WHERE l.district_id = dx.district;

COMMIT;
