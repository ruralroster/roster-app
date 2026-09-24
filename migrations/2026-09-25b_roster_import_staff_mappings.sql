-- Adds staff-name mappings to roster_import_mappings (see
-- 2026-09-25_roster_import_mappings.sql). kind 'staff': a name label from
-- the spreadsheet (e.g. "Rach Boland Obstetrics") that doesn't match any
-- staff record by the import's own name rule, mapped to the staff member
-- it really is — either an existing one, or one the officer creates from
-- the import's Map… button / Check for Missing Staff with a corrected name.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE roster_import_mappings
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES staff(staff_id) ON DELETE CASCADE;

ALTER TABLE roster_import_mappings DROP CONSTRAINT IF EXISTS roster_import_mappings_kind_check;
ALTER TABLE roster_import_mappings
  ADD CONSTRAINT roster_import_mappings_kind_check CHECK (kind IN ('code', 'location', 'activity', 'staff'));

COMMIT;
