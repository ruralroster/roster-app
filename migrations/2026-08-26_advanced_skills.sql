-- Lets an officer tag staff with "Advanced Skills" (e.g. Anaesthetics,
-- Obstetrics, Endoscopy) and then require one-of-a-set of those skills on
-- an Activity or a Duty Type, so only qualified staff show up in that
-- slot's picker — e.g. the Endoscopy consultant slot needs Anaesthetics OR
-- Endoscopy, Obs Surgery needs Anaesthetics OR Obstetrics, overnight
-- Anaesthetics On Call needs Anaesthetics.
--
-- advanced_skills is a per-department configurable list (Settings ->
-- Staff Filters -> Advanced Skill), seeded with "Emergency" so existing
-- departments start with the one the app previously assumed implicitly.
--
-- staff.advanced_skills / activity_types.required_advanced_skills /
-- duty_types.required_advanced_skills are all uuid[] referencing
-- advanced_skills.advanced_skill_id — same "array of ids, empty means no
-- restriction" shape as locations.allowed_activity_ids (see
-- 2026-08-23_location_allowed_activities.sql). A staff member is eligible
-- for a slot with a non-empty required list if they have AT LEAST ONE of
-- the required skills (OR, not AND).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF NOT
-- EXISTS / ON CONFLICT-guarded seed.

BEGIN;

CREATE TABLE IF NOT EXISTS advanced_skills (
  advanced_skill_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(department_id, name)
);

-- Seed every existing department with "Emergency", the one default skill
-- called for at launch. Everything else an officer adds themselves.
INSERT INTO advanced_skills (department_id, name, sort_order)
SELECT d.department_id, 'Emergency', 0
FROM departments d
ON CONFLICT (department_id, name) DO NOTHING;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS advanced_skills uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE activity_types
  ADD COLUMN IF NOT EXISTS required_advanced_skills uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE duty_types
  ADD COLUMN IF NOT EXISTS required_advanced_skills uuid[] NOT NULL DEFAULT '{}';

-- Same "read = member, write = officer" shape as duty_types/leave_types
-- (see 2026-08-22_duty_types.sql).
ALTER TABLE advanced_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "advanced_skills_select_department" ON advanced_skills;
CREATE POLICY "advanced_skills_select_department" ON advanced_skills
  FOR SELECT USING (is_department_member(department_id));

DROP POLICY IF EXISTS "advanced_skills_insert_officer" ON advanced_skills;
CREATE POLICY "advanced_skills_insert_officer" ON advanced_skills
  FOR INSERT WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "advanced_skills_update_officer" ON advanced_skills;
CREATE POLICY "advanced_skills_update_officer" ON advanced_skills
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "advanced_skills_delete_officer" ON advanced_skills;
CREATE POLICY "advanced_skills_delete_officer" ON advanced_skills
  FOR DELETE USING (is_department_officer(department_id));

COMMIT;
