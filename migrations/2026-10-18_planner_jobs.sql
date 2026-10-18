-- Jobs and places — for the Officer view's new Planner tab (confirmed with
-- the department 2026-10-18).
--
-- Location (where) and activity (what kind of work) stay as they are. A
-- job sits on top: a named, regular piece of work at one location doing
-- one activity, over the hours the service runs, e.g.
--
--   ED Day    — Emergency · Emergency Department Cover · 08:00-18:00
--   ED Night  — Emergency · Emergency Department Cover · 22:00-08:00
--   Endoscopy — Endoscopy · Endoscopy · 08:00-18:00
--
-- Activities alone can't carry requirements because they're shared: ED
-- Day, EDL and ED Night are all Emergency Department Cover, and Ward 1,
-- Ward 2 and Maternity all Ward Care Cover. A person's own hours on a job
-- still come from their shift (ED early inside ED Day), so payroll is
-- unchanged.
--
-- 1. job_types — the department's list of jobs (Settings → Jobs). These
--    make up the Planner's palette.
--
-- 2. job_places — what each job needs before it's covered. The minimum,
--    never a cap: juniors or extra seniors go on top as staffing allows.
--      kind:  'staff'   — filled by someone on the roster
--             'visitor' — a name only (visiting surgeons), never rostered
--                         and never counted against staffing
--             'either'  — staff or a visitor (obstetricians)
--      grade: 'senior' (a rank with requires_supervision = false),
--             'junior' (requires_supervision = true) or 'any'
--      required_advanced_skills: same "any one of these ids, empty means
--             no restriction" shape as activity_types.required_advanced_
--             skills (2026-08-26_advanced_skills.sql)
--      min_count: how many of this place the job needs
--
-- 3. theatre_activities.job_type_id — which job a card is, for cards the
--    Planner creates. NULL for every existing card: the Planner matches
--    those to a job by location, activity and hours instead.
--
-- 4. week_template_entries.job_type_id — same, for templates saved from
--    the Planner.
--
-- 5. staff_assignments.place_id — which place a booking fills. NULL for
--    every existing booking and for anyone added to a job as an extra, so
--    nothing that reads staff_assignments today (Day view, payroll, staff
--    app) changes.
--
-- 6. theatre_activity_visitors — the visiting doctor's name in a visitor
--    (or either) place on one specific card.
--
-- Same "read = member, write = officer" RLS shape as advanced_skills.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- IF NOT EXISTS / DROP ... IF EXISTS throughout.

BEGIN;

CREATE TABLE IF NOT EXISTS job_types (
  job_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  name text NOT NULL,
  location_id uuid NOT NULL REFERENCES locations(location_id),
  activity_id uuid NOT NULL REFERENCES activity_types(activity_id),
  start_time time NOT NULL,
  end_time time NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (department_id, name)
);

CREATE TABLE IF NOT EXISTS job_places (
  place_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  job_type_id uuid NOT NULL REFERENCES job_types(job_type_id) ON DELETE CASCADE,
  role text NOT NULL,
  kind text NOT NULL DEFAULT 'staff' CHECK (kind IN ('staff', 'visitor', 'either')),
  grade text NOT NULL DEFAULT 'any' CHECK (grade IN ('senior', 'junior', 'any')),
  required_advanced_skills uuid[] NOT NULL DEFAULT '{}',
  min_count integer NOT NULL DEFAULT 1 CHECK (min_count BETWEEN 1 AND 10),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_places_job_type_idx ON job_places(job_type_id);

ALTER TABLE theatre_activities
  ADD COLUMN IF NOT EXISTS job_type_id uuid REFERENCES job_types(job_type_id) ON DELETE SET NULL;
ALTER TABLE week_template_entries
  ADD COLUMN IF NOT EXISTS job_type_id uuid REFERENCES job_types(job_type_id) ON DELETE SET NULL;
ALTER TABLE staff_assignments
  ADD COLUMN IF NOT EXISTS place_id uuid REFERENCES job_places(place_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS theatre_activity_visitors (
  visitor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  theatre_activity_id uuid NOT NULL REFERENCES theatre_activities(theatre_activity_id) ON DELETE CASCADE,
  place_id uuid NOT NULL REFERENCES job_places(place_id) ON DELETE CASCADE,
  -- Which of the place's min_count slots (0-based) this name fills.
  slot integer NOT NULL DEFAULT 0,
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (theatre_activity_id, place_id, slot)
);

ALTER TABLE job_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE theatre_activity_visitors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_types_select_department" ON job_types;
CREATE POLICY "job_types_select_department" ON job_types
  FOR SELECT USING (is_department_member(department_id));
DROP POLICY IF EXISTS "job_types_insert_officer" ON job_types;
CREATE POLICY "job_types_insert_officer" ON job_types
  FOR INSERT WITH CHECK (is_department_officer(department_id));
DROP POLICY IF EXISTS "job_types_update_officer" ON job_types;
CREATE POLICY "job_types_update_officer" ON job_types
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));
DROP POLICY IF EXISTS "job_types_delete_officer" ON job_types;
CREATE POLICY "job_types_delete_officer" ON job_types
  FOR DELETE USING (is_department_officer(department_id));

DROP POLICY IF EXISTS "job_places_select_department" ON job_places;
CREATE POLICY "job_places_select_department" ON job_places
  FOR SELECT USING (is_department_member(department_id));
DROP POLICY IF EXISTS "job_places_insert_officer" ON job_places;
CREATE POLICY "job_places_insert_officer" ON job_places
  FOR INSERT WITH CHECK (is_department_officer(department_id));
DROP POLICY IF EXISTS "job_places_update_officer" ON job_places;
CREATE POLICY "job_places_update_officer" ON job_places
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));
DROP POLICY IF EXISTS "job_places_delete_officer" ON job_places;
CREATE POLICY "job_places_delete_officer" ON job_places
  FOR DELETE USING (is_department_officer(department_id));

DROP POLICY IF EXISTS "theatre_activity_visitors_select_department" ON theatre_activity_visitors;
CREATE POLICY "theatre_activity_visitors_select_department" ON theatre_activity_visitors
  FOR SELECT USING (is_department_member(department_id));
DROP POLICY IF EXISTS "theatre_activity_visitors_insert_officer" ON theatre_activity_visitors;
CREATE POLICY "theatre_activity_visitors_insert_officer" ON theatre_activity_visitors
  FOR INSERT WITH CHECK (is_department_officer(department_id));
DROP POLICY IF EXISTS "theatre_activity_visitors_update_officer" ON theatre_activity_visitors;
CREATE POLICY "theatre_activity_visitors_update_officer" ON theatre_activity_visitors
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));
DROP POLICY IF EXISTS "theatre_activity_visitors_delete_officer" ON theatre_activity_visitors;
CREATE POLICY "theatre_activity_visitors_delete_officer" ON theatre_activity_visitors
  FOR DELETE USING (is_department_officer(department_id));

COMMIT;
