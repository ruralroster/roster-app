-- Week Templates — a department-configured "what has to happen every week"
-- skeleton: locations + activities per day-of-week, deliberately with no
-- staff attached. Set up in Settings, then applied to a specific Monday-
-- start week from the main Calendar, which creates the real (empty)
-- theatre_activities cards for that week — the same cards Day view,
-- Volunteer/Variation opportunities and Fortnight already know how to
-- read and staff, so nothing downstream needs to know templates exist.
-- More than one template can exist per department (e.g. a standard week
-- vs a reduced-roster week); week_template_applications records which
-- template (if any) was applied to a given real week, which the Calendar's
-- allocation-status coloring reads to know whether to check against the
-- template's required set or just whatever cards already exist.
--
-- day_of_week: 0 = Monday .. 6 = Sunday, matching the Monday-start week
-- convention already used throughout the app (getMondayOfWeek).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF NOT
-- EXISTS / DROP POLICY IF EXISTS throughout.

BEGIN;

CREATE TABLE IF NOT EXISTS week_templates (
  week_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS week_template_entries (
  week_template_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_template_id uuid NOT NULL REFERENCES week_templates(week_template_id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  location_id uuid NOT NULL REFERENCES locations(location_id),
  activity_id uuid NOT NULL REFERENCES activity_types(activity_id),
  start_time time NOT NULL,
  end_time time NOT NULL,
  -- Matches a shift by its `session` label at apply time (same "find a
  -- shift whose session matches, else fall back to any active shift" the
  -- Day view's Add Activity already does) — theatre_activities.shift_id is
  -- NOT NULL, so applying a template still needs *some* shift to satisfy
  -- it even though the template itself is about locations/activities, not
  -- staff shifts.
  session text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS week_template_applications (
  department_id uuid NOT NULL REFERENCES departments(department_id),
  week_start_date date NOT NULL,
  week_template_id uuid NOT NULL REFERENCES week_templates(week_template_id),
  applied_at timestamptz DEFAULT now(),
  PRIMARY KEY (department_id, week_start_date)
);

-- Same "read = member, write = officer" shape as duty_types.
ALTER TABLE week_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE week_template_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE week_template_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "week_templates_select_department" ON week_templates;
CREATE POLICY "week_templates_select_department" ON week_templates
  FOR SELECT USING (is_department_member(department_id));

DROP POLICY IF EXISTS "week_templates_write_officer" ON week_templates;
CREATE POLICY "week_templates_write_officer" ON week_templates
  FOR ALL USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "week_template_entries_select_department" ON week_template_entries;
CREATE POLICY "week_template_entries_select_department" ON week_template_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM week_templates wt
      WHERE wt.week_template_id = week_template_entries.week_template_id
        AND is_department_member(wt.department_id)
    )
  );

DROP POLICY IF EXISTS "week_template_entries_write_officer" ON week_template_entries;
CREATE POLICY "week_template_entries_write_officer" ON week_template_entries
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM week_templates wt
      WHERE wt.week_template_id = week_template_entries.week_template_id
        AND is_department_officer(wt.department_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM week_templates wt
      WHERE wt.week_template_id = week_template_entries.week_template_id
        AND is_department_officer(wt.department_id)
    )
  );

DROP POLICY IF EXISTS "week_template_applications_select_department" ON week_template_applications;
CREATE POLICY "week_template_applications_select_department" ON week_template_applications
  FOR SELECT USING (is_department_member(department_id));

DROP POLICY IF EXISTS "week_template_applications_write_officer" ON week_template_applications;
CREATE POLICY "week_template_applications_write_officer" ON week_template_applications
  FOR ALL USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));

COMMIT;
