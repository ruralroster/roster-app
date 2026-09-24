-- Officer-defined fixes for Excel roster import errors (Settings →
-- Rostering Tools → Excel Roster Import). When a dry run reports a shift
-- code it doesn't know, or a location/activity name the department
-- doesn't have, the officer can click the error and map it to one of the
-- department's existing locations/activities/leave types. Saved per
-- department so the same code maps the same way in every later week and
-- file — see RosterExcelImportTab.jsx and importRosterWeek in
-- supabaseClient.js.
--
-- kind:
--   'code'     - a whole shift code the importer doesn't recognise (e.g.
--                "Endo2"), mapped either to a location + activity + times
--                (location_id, activity_id, start_time, end_time) or to a
--                leave type (leave_type_id).
--   'location' - a location NAME a known code points at that this
--                department doesn't have (e.g. "Emergency"), mapped to
--                one of its real locations (location_id).
--   'activity' - same, for an activity name (activity_id).
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF NOT
-- EXISTS / DROP POLICY IF EXISTS throughout.

BEGIN;

CREATE TABLE IF NOT EXISTS roster_import_mappings (
  mapping_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  kind text NOT NULL CHECK (kind IN ('code', 'location', 'activity')),
  source text NOT NULL,
  location_id uuid REFERENCES locations(location_id) ON DELETE CASCADE,
  activity_id uuid REFERENCES activity_types(activity_id) ON DELETE CASCADE,
  leave_type_id uuid REFERENCES leave_types(leave_type_id) ON DELETE CASCADE,
  start_time time,
  end_time time,
  created_at timestamptz DEFAULT now(),
  UNIQUE (department_id, kind, source)
);

-- Import is an officer-only tool, so the mappings are officer-only too.
ALTER TABLE roster_import_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roster_import_mappings_officer_all" ON roster_import_mappings;
CREATE POLICY "roster_import_mappings_officer_all" ON roster_import_mappings
  FOR ALL USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));

COMMIT;
