-- Demo copy of Innisfail, for screenshots and training videos.
--
-- Makes "Wattle Creek Hospital": a copy of the Innisfail department's whole
-- setup (ranks, skills, activities, shifts, locations, jobs and places, week
-- templates, duty types, rules, phone book) and its roster from 2 weeks ago
-- to 6 weeks ahead, with every person renamed to a made-up name. Plus a
-- "Demo District" on DR Roster with two made-up sites: Wattle Creek (linked
-- to the copy) and Banksia Bay, made-up district doctors, and open shifts.
--
-- Nothing real is copied: no emails, phones, payroll numbers, notes, sick
-- calls, leave reasons, coffee history, push subscriptions or real visitor
-- names. Emails are name@demo.example (a reserved domain that never
-- delivers) and every person has email notifications off; the copy's coffee
-- emails are off; phones are from the ACMA fiction range (07) 5550 0xxx.
--
-- Run once in the SQL Editor. It stops if a demo copy already exists.
-- 3_remove_demo.sql deletes everything this makes.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM departments WHERE name = 'Wattle Creek Hospital')
     OR EXISTS (SELECT 1 FROM districts WHERE name = 'Demo District') THEN
    RAISE EXCEPTION 'A demo copy already exists. Run 3_remove_demo.sql first if you want a fresh one.';
  END IF;
END $$;

CREATE TEMP TABLE ctx ON COMMIT DROP AS
SELECT '5f83d0f0-27f7-4089-8037-8f13259b2132'::uuid AS src,
       gen_random_uuid() AS dst,
       current_date - 14 AS d_from,
       current_date + 42 AS d_to;

-- Made-up names: person n gets first[n % 40] + last[(17n + n/40) % 40], so
-- no two people share a name.
CREATE TEMP TABLE fake_first ON COMMIT DROP AS
SELECT ordinality - 1 AS i, name FROM unnest(ARRAY[
  'Priya','Tom','Mei','Liam','Aisha','Josh','Grace','Ravi','Hannah','Daniel',
  'Zoe','Marcus','Ella','Sam','Nina','Owen','Leah','Arjun','Kate','Ben',
  'Chloe','Isaac','Maya','Ryan','Sophie','Felix','Anika','Jack','Ruby','Theo',
  'Imogen','Kai','Lucy','Nathan','Freya','Omar','Tessa','Hugo','Jasmine','Caleb'
]) WITH ORDINALITY AS t(name, ordinality);

CREATE TEMP TABLE fake_last ON COMMIT DROP AS
SELECT ordinality - 1 AS i, name FROM unnest(ARRAY[
  'Nair','Callaghan','Lin','Hartley','Okafor','Brennan','Whitfield','Moreau','Patel','Doyle',
  'Kowalski','Ashby','Fenwick','Tran','Mercer','Lindqvist','Okoro','Prescott','Haddad','Quinlan',
  'Varga','Sato','Ellison','Rourke','Calder','Ibarra','Novak','Pemberton','Achebe','Lowell',
  'Marsh','Devlin','Kaur','Foley','Strand','Abbott','Yilmaz','Garner','Holloway','Rennick'
]) WITH ORDINALITY AS t(name, ordinality);

CREATE TEMP TABLE fake_name ON COMMIT DROP AS
SELECT n, f.name AS first, l.name AS last, f.name || ' ' || l.name AS full_name,
       lower(f.name || '.' || l.name) || '@demo.example' AS email
FROM generate_series(0, 999) AS n
JOIN fake_first f ON f.i = n % 40
JOIN fake_last l ON l.i = (17 * n + n / 40) % 40;

-- ---------------------------------------------------------------- department
INSERT INTO departments (department_id, name, location, pay_centre_number, coffee_place_name, coffee_place_phone,
  morning_start, morning_end, afternoon_start, afternoon_end, night_start, night_end, roster_import_format, coffee_emails)
SELECT c.dst, 'Wattle Creek Hospital', 'Demo', NULL, 'Best Coffee in the Universe', '07 5550 0001',
  d.morning_start, d.morning_end, d.afternoon_start, d.afternoon_end, d.night_start, d.night_end, d.roster_import_format, false
FROM departments d, ctx c WHERE d.department_id = c.src;

-- ---------------------------------------------------------------- setup
INSERT INTO rank_supervision_rules (rule_id, department_id, rank, requires_supervision, max_per_consultant, can_share_supervisor, sort_order, can_cover_senior)
SELECT gen_random_uuid(), c.dst, r.rank, r.requires_supervision, r.max_per_consultant, r.can_share_supervisor, r.sort_order, r.can_cover_senior
FROM rank_supervision_rules r, ctx c WHERE r.department_id = c.src;

CREATE TEMP TABLE m_skill ON COMMIT DROP AS
SELECT advanced_skill_id AS old, gen_random_uuid() AS new FROM advanced_skills, ctx WHERE department_id = ctx.src;
INSERT INTO advanced_skills (advanced_skill_id, department_id, name, sort_order)
SELECT m.new, c.dst, s.name, s.sort_order FROM advanced_skills s JOIN m_skill m ON m.old = s.advanced_skill_id, ctx c;

-- Skill id arrays point at the copy's skills.
CREATE FUNCTION pg_temp.remap_skills(p uuid[]) RETURNS uuid[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(m.new), '{}') FROM unnest(p) AS x(id) JOIN m_skill m ON m.old = x.id
$f$;

CREATE TEMP TABLE m_act ON COMMIT DROP AS
SELECT activity_id AS old, gen_random_uuid() AS new FROM activity_types, ctx WHERE department_id = ctx.src;
INSERT INTO activity_types (activity_id, department_id, name, abbreviation, required_advanced_skills)
SELECT m.new, c.dst, a.name, a.abbreviation, pg_temp.remap_skills(a.required_advanced_skills)
FROM activity_types a JOIN m_act m ON m.old = a.activity_id, ctx c;

CREATE TEMP TABLE m_shift ON COMMIT DROP AS
SELECT shift_id AS old, gen_random_uuid() AS new FROM shifts, ctx WHERE department_id = ctx.src;
INSERT INTO shifts (shift_id, department_id, name, day_type, start_time, end_time, session, active)
SELECT m.new, c.dst, s.name, s.day_type, s.start_time, s.end_time, s.session, s.active
FROM shifts s JOIN m_shift m ON m.old = s.shift_id, ctx c;

CREATE TEMP TABLE m_loc ON COMMIT DROP AS
SELECT location_id AS old, gen_random_uuid() AS new FROM locations, ctx WHERE department_id = ctx.src;
INSERT INTO locations (location_id, department_id, name, active, default_start_time, default_end_time, allowed_activity_ids,
  requires_supervision, requires_both_senior_and_junior, notify_on_sick_call)
SELECT m.new, c.dst, l.name, l.active, l.default_start_time, l.default_end_time,
  (SELECT coalesce(array_agg(ma.new), '{}') FROM unnest(l.allowed_activity_ids) AS x(id) JOIN m_act ma ON ma.old = x.id),
  l.requires_supervision, l.requires_both_senior_and_junior, l.notify_on_sick_call
FROM locations l JOIN m_loc m ON m.old = l.location_id, ctx c;

CREATE TEMP TABLE m_leave ON COMMIT DROP AS
SELECT leave_type_id AS old, gen_random_uuid() AS new FROM leave_types, ctx WHERE department_id = ctx.src;
INSERT INTO leave_types (leave_type_id, department_id, name, code)
SELECT m.new, c.dst, t.name, t.code FROM leave_types t JOIN m_leave m ON m.old = t.leave_type_id, ctx c;

INSERT INTO duty_types (duty_type_id, department_id, key, label, sort_order, counts_as_on_call, active, start_time, end_time,
  activity_type_id, shift_id, abbreviation, required_advanced_skills, notify_on_sick_call)
SELECT gen_random_uuid(), c.dst, d.key, d.label, d.sort_order, d.counts_as_on_call, d.active, d.start_time, d.end_time,
  ma.new, ms.new, d.abbreviation, pg_temp.remap_skills(d.required_advanced_skills), d.notify_on_sick_call
FROM duty_types d CROSS JOIN ctx c
LEFT JOIN m_act ma ON ma.old = d.activity_type_id
LEFT JOIN m_shift ms ON ms.old = d.shift_id
WHERE d.department_id = c.src;

CREATE TEMP TABLE m_job ON COMMIT DROP AS
SELECT job_type_id AS old, gen_random_uuid() AS new FROM job_types, ctx WHERE department_id = ctx.src;
INSERT INTO job_types (job_type_id, department_id, name, location_id, activity_id, start_time, end_time, sort_order, active)
SELECT m.new, c.dst, j.name, ml.new, ma.new, j.start_time, j.end_time, j.sort_order, j.active
FROM job_types j JOIN m_job m ON m.old = j.job_type_id CROSS JOIN ctx c
LEFT JOIN m_loc ml ON ml.old = j.location_id
LEFT JOIN m_act ma ON ma.old = j.activity_id;

CREATE TEMP TABLE m_place ON COMMIT DROP AS
SELECT place_id AS old, gen_random_uuid() AS new FROM job_places, ctx WHERE department_id = ctx.src;
INSERT INTO job_places (place_id, department_id, job_type_id, role, kind, grade, required_advanced_skills, min_count, sort_order)
SELECT m.new, c.dst, mj.new, p.role, p.kind, p.grade, pg_temp.remap_skills(p.required_advanced_skills), p.min_count, p.sort_order
FROM job_places p JOIN m_place m ON m.old = p.place_id JOIN m_job mj ON mj.old = p.job_type_id, ctx c;

CREATE TEMP TABLE m_tpl ON COMMIT DROP AS
SELECT week_template_id AS old, gen_random_uuid() AS new FROM week_templates, ctx WHERE department_id = ctx.src;
INSERT INTO week_templates (week_template_id, department_id, name)
SELECT m.new, c.dst, t.name FROM week_templates t JOIN m_tpl m ON m.old = t.week_template_id, ctx c;

INSERT INTO week_template_entries (week_template_entry_id, week_template_id, day_of_week, location_id, activity_id, start_time, end_time, session, job_type_id)
SELECT gen_random_uuid(), mt.new, e.day_of_week, ml.new, ma.new, e.start_time, e.end_time, e.session, mj.new
FROM week_template_entries e JOIN m_tpl mt ON mt.old = e.week_template_id
LEFT JOIN m_loc ml ON ml.old = e.location_id
LEFT JOIN m_act ma ON ma.old = e.activity_id
LEFT JOIN m_job mj ON mj.old = e.job_type_id;

INSERT INTO week_template_applications (department_id, week_start_date, week_template_id, applied_at)
SELECT c.dst, a.week_start_date, mt.new, a.applied_at
FROM week_template_applications a JOIN m_tpl mt ON mt.old = a.week_template_id, ctx c WHERE a.department_id = c.src;

INSERT INTO shift_pattern_rules (rule_id, department_id, shift_1_id, shift_2_id, shift_3_id, shift_4_id, shift_5_id, shift_6_id, shift_7_id, rule_action, description)
SELECT gen_random_uuid(), c.dst,
  (SELECT new FROM m_shift WHERE old = r.shift_1_id), (SELECT new FROM m_shift WHERE old = r.shift_2_id),
  (SELECT new FROM m_shift WHERE old = r.shift_3_id), (SELECT new FROM m_shift WHERE old = r.shift_4_id),
  (SELECT new FROM m_shift WHERE old = r.shift_5_id), (SELECT new FROM m_shift WHERE old = r.shift_6_id),
  (SELECT new FROM m_shift WHERE old = r.shift_7_id), r.rule_action, r.description
FROM shift_pattern_rules r, ctx c WHERE r.department_id = c.src;

INSERT INTO phone_book_entries (phone_book_entry_id, department_id, label, phone, sort_order, active)
SELECT gen_random_uuid(), c.dst, p.label,
  '07 5550 ' || lpad((1 + row_number() OVER (ORDER BY p.sort_order, p.label))::text, 4, '0'), p.sort_order, p.active
FROM phone_book_entries p, ctx c WHERE p.department_id = c.src;

-- ---------------------------------------------------------------- people
CREATE TEMP TABLE m_staff ON COMMIT DROP AS
SELECT s.staff_id AS old, gen_random_uuid() AS new, (row_number() OVER (ORDER BY s.name) - 1)::int AS n
FROM staff s, ctx WHERE s.department_id = ctx.src;

INSERT INTO staff (staff_id, department_id, name, rank, phone, on_call_willing, rotation_start_date, rotation_length_months,
  activity_restrictions, fte, email, coffee_order, active, payroll_number, position_id, cost_centre, user_id, role,
  preferred_view, advanced_skills, notify_email)
SELECT m.new, c.dst, f.full_name, s.rank, '07 5550 ' || lpad((100 + m.n)::text, 4, '0'), s.on_call_willing,
  s.rotation_start_date, s.rotation_length_months, s.activity_restrictions, s.fte, f.email, s.coffee_order, s.active,
  NULL, NULL, NULL, NULL, s.role, s.preferred_view, pg_temp.remap_skills(s.advanced_skills), false
FROM staff s JOIN m_staff m ON m.old = s.staff_id JOIN fake_name f ON f.n = m.n, ctx c;

INSERT INTO staff_favorites (favorite_id, staff_id, starred_staff_id)
SELECT gen_random_uuid(), a.new, b.new
FROM staff_favorites f JOIN m_staff a ON a.old = f.staff_id JOIN m_staff b ON b.old = f.starred_staff_id;

-- Availability, without leave reasons kept beyond the leave type.
INSERT INTO staff_availability (availability_id, department_id, staff_id, date, available, leave_type_id, working_elsewhere)
SELECT gen_random_uuid(), c.dst, m.new, a.date, a.available, ml.new, a.working_elsewhere
FROM staff_availability a JOIN m_staff m ON m.old = a.staff_id CROSS JOIN ctx c
LEFT JOIN m_leave ml ON ml.old = a.leave_type_id
WHERE a.department_id = c.src AND a.date BETWEEN c.d_from AND c.d_to;

-- ---------------------------------------------------------------- roster
CREATE TEMP TABLE m_ta ON COMMIT DROP AS
SELECT theatre_activity_id AS old, gen_random_uuid() AS new
FROM theatre_activities t, ctx c WHERE t.department_id = c.src AND t.date BETWEEN c.d_from AND c.d_to;

INSERT INTO theatre_activities (theatre_activity_id, department_id, date, location_id, activity_id, shift_id, start_time, end_time, required_grade, job_type_id)
SELECT m.new, c.dst, t.date, ml.new, ma.new, ms.new, t.start_time, t.end_time, t.required_grade, mj.new
FROM theatre_activities t JOIN m_ta m ON m.old = t.theatre_activity_id CROSS JOIN ctx c
LEFT JOIN m_loc ml ON ml.old = t.location_id
LEFT JOIN m_act ma ON ma.old = t.activity_id
LEFT JOIN m_shift ms ON ms.old = t.shift_id
LEFT JOIN m_job mj ON mj.old = t.job_type_id;

INSERT INTO staff_assignments (assignment_id, department_id, date, location_id, staff_id, shift_id, role, fatigue_override_reason,
  leave_code, theatre_activity_id, on_call, place_id)
SELECT gen_random_uuid(), c.dst, a.date, ml.new, mst.new, ms.new, a.role, NULL, a.leave_code, mt.new, a.on_call, mp.new
FROM staff_assignments a JOIN m_staff mst ON mst.old = a.staff_id CROSS JOIN ctx c
LEFT JOIN m_loc ml ON ml.old = a.location_id
LEFT JOIN m_shift ms ON ms.old = a.shift_id
LEFT JOIN m_ta mt ON mt.old = a.theatre_activity_id
LEFT JOIN m_place mp ON mp.old = a.place_id
WHERE a.department_id = c.src AND a.date BETWEEN c.d_from AND c.d_to
  AND (a.theatre_activity_id IS NULL OR mt.new IS NOT NULL);

INSERT INTO duty_assignments (duty_id, department_id, date, staff_id, duty_type)
SELECT gen_random_uuid(), c.dst, d.date, m.new, d.duty_type
FROM duty_assignments d JOIN m_staff m ON m.old = d.staff_id, ctx c
WHERE d.department_id = c.src AND d.date BETWEEN c.d_from AND c.d_to;

-- Visitors keep their role but get a made-up name.
INSERT INTO theatre_activity_visitors (visitor_id, department_id, theatre_activity_id, place_id, slot, name, role, source)
SELECT gen_random_uuid(), c.dst, mt.new, mp.new, v.slot, 'Dr ' || f.full_name, v.role, v.source
FROM (SELECT v.*, (row_number() OVER (ORDER BY v.visitor_id))::int AS k FROM theatre_activity_visitors v, ctx
      WHERE v.department_id = ctx.src) v
JOIN m_ta mt ON mt.old = v.theatre_activity_id
JOIN fake_name f ON f.n = 500 + v.k % 400
CROSS JOIN ctx c
LEFT JOIN m_place mp ON mp.old = v.place_id;

-- Offers and volunteers, marked as already notified so nobody is emailed.
INSERT INTO volunteer_offers (volunteer_offer_id, department_id, theatre_activity_id, role, created_at, notified_at, filled_baseline)
SELECT gen_random_uuid(), c.dst, mt.new, o.role, o.created_at, now(), o.filled_baseline
FROM volunteer_offers o JOIN m_ta mt ON mt.old = o.theatre_activity_id, ctx c WHERE o.department_id = c.src;

INSERT INTO volunteer_requests (volunteer_request_id, department_id, theatre_activity_id, staff_id, role, notified_at)
SELECT gen_random_uuid(), c.dst, mt.new, ms.new, r.role, now()
FROM volunteer_requests r JOIN m_ta mt ON mt.old = r.theatre_activity_id JOIN m_staff ms ON ms.old = r.staff_id, ctx c
WHERE r.department_id = c.src;

-- ---------------------------------------------------------------- DR Roster
CREATE TEMP TABLE dctx ON COMMIT DROP AS
SELECT gen_random_uuid() AS district, gen_random_uuid() AS wattle, gen_random_uuid() AS banksia,
       (SELECT site_id FROM sites, ctx WHERE department_id = ctx.src) AS src_site;

INSERT INTO districts (district_id, name) SELECT district, 'Demo District' FROM dctx;

INSERT INTO sites (site_id, district_id, name, department_id, escalate_after_hours, colour_hue)
SELECT d.wattle, d.district, 'Wattle Creek', c.dst, 72, 160 FROM dctx d, ctx c
UNION ALL
SELECT d.banksia, d.district, 'Banksia Bay', NULL, 72, 20 FROM dctx d;

INSERT INTO site_shift_types (shift_type_id, site_id, name, start_time, end_time, required_skill, notes)
SELECT gen_random_uuid(), s.site, t.name, t.start_time, t.end_time, t.required_skill, NULL
FROM site_shift_types t, dctx d, LATERAL (VALUES (d.wattle), (d.banksia)) AS s(site)
WHERE t.site_id = d.src_site;

-- Every copied doctor is a district doctor at Wattle Creek; level from rank,
-- skills from their advanced skills. Notifications off.
INSERT INTO district_doctors (district_id, user_id, email, name, phone, home_site_id, skills, notify_email, notify_push,
  active, interested_site_ids, level)
SELECT d.district, NULL, s.email, s.name, s.phone, d.wattle,
  ARRAY['Emergency'] || coalesce((
    SELECT array_agg(DISTINCT CASE
      WHEN k.name ILIKE 'anaes%' THEN 'Anaesthetics'
      WHEN k.name ILIKE 'obst%' OR k.name ILIKE 'o&g%' THEN 'O&G'
      WHEN k.name ILIKE 'endo%' THEN 'Endoscopy' END)
    FROM advanced_skills k
    WHERE k.advanced_skill_id = ANY (s.advanced_skills)
      AND (k.name ILIKE 'anaes%' OR k.name ILIKE 'obst%' OR k.name ILIKE 'o&g%' OR k.name ILIKE 'endo%')), '{}'),
  false, false, true, ARRAY[d.wattle, d.banksia],
  CASE
    WHEN s.rank ILIKE '%intern%' THEN 'intern'
    WHEN s.rank ILIKE ANY (ARRAY['%rmo%', '%resident%', '%jho%', '%sho%', '%junior%']) THEN 'rmo'
    WHEN NOT coalesce(r.requires_supervision, false) THEN 'consultant'
    WHEN r.can_cover_senior THEN 'advanced_trainee'
    ELSE 'registrar'
  END
FROM staff s CROSS JOIN dctx d CROSS JOIN ctx c
LEFT JOIN rank_supervision_rules r ON r.department_id = s.department_id AND r.rank = s.rank
WHERE s.department_id = c.dst AND s.active AND coalesce(s.role, 'staff') <> 'officer';

-- Eight more made-up doctors based at Banksia Bay.
INSERT INTO district_doctors (district_id, user_id, email, name, phone, home_site_id, skills, notify_email, notify_push,
  active, interested_site_ids, level)
SELECT d.district, NULL, f.email, f.full_name, '07 5550 ' || lpad((300 + k)::text, 4, '0'), d.banksia,
  CASE k % 4 WHEN 0 THEN ARRAY['Emergency', 'Anaesthetics'] WHEN 1 THEN ARRAY['Emergency', 'O&G'] ELSE ARRAY['Emergency'] END,
  false, false, true, ARRAY[d.banksia, d.wattle],
  (ARRAY['consultant', 'registrar', 'consultant', 'rmo', 'registrar', 'advanced_trainee', 'intern', 'consultant'])[k + 1]
FROM generate_series(0, 7) AS k JOIN fake_name f ON f.n = 300 + k, dctx d;

-- Open shifts on DR Roster: Innisfail's open district shifts in the window,
-- moved to Wattle Creek, plus about ten at Banksia Bay. Marked as already
-- notified so nobody is emailed.
INSERT INTO district_notices (notice_id, district_id, site_id, shift_date, start_time, end_time, required_skill, notes, status,
  source, created_by, title, position, notified_at, urgent_notified_at)
SELECT gen_random_uuid(), d.district, d.wattle, n.shift_date, n.start_time, n.end_time, n.required_skill, NULL, 'open',
  'officer', NULL, n.title, n.position, now(), now()
FROM district_notices n, dctx d, ctx c
WHERE n.site_id = d.src_site AND n.status = 'open' AND n.source <> 'roster_shift'
  AND n.shift_date BETWEEN current_date AND c.d_to;

INSERT INTO district_notices (notice_id, district_id, site_id, shift_date, start_time, end_time, required_skill, notes, status,
  source, created_by, title, position, notified_at, urgent_notified_at)
SELECT gen_random_uuid(), d.district, d.banksia, current_date + 2 + k * 4, t.start_time, t.end_time, t.required_skill, NULL, 'open',
  'officer', NULL, t.name, (ARRAY['consultant', 'registrar', 'consultant', 'rmo', 'registrar'])[k % 5 + 1], now(), now()
FROM generate_series(0, 9) AS k CROSS JOIN dctx d
CROSS JOIN LATERAL (
  SELECT * FROM site_shift_types WHERE site_id = d.banksia ORDER BY name OFFSET k % greatest(1, (SELECT count(*) FROM site_shift_types WHERE site_id = d.banksia)::int) LIMIT 1
) t;

-- What was made.
SELECT 'staff' AS what, count(*) FROM staff, ctx WHERE department_id = ctx.dst
UNION ALL SELECT 'roster cards', count(*) FROM theatre_activities, ctx WHERE department_id = ctx.dst
UNION ALL SELECT 'bookings', count(*) FROM staff_assignments, ctx WHERE department_id = ctx.dst
UNION ALL SELECT 'district doctors', count(*) FROM district_doctors, dctx WHERE district_id = dctx.district
UNION ALL SELECT 'open district shifts', count(*) FROM district_notices, dctx WHERE district_id = dctx.district;

COMMIT;
