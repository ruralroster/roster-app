-- Officer-managed "Phone Book" of important non-staff contacts (e.g. the
-- nearest tertiary ED, the on-site ED SMO line, the Nurse Unit Manager) —
-- separate from the staff directory, since these are numbers for places
-- and roles rather than people with a staff row. Shown to everyone in the
-- department (renamed On-Call tab → Phone Book in the staff view, below
-- the existing weekly on-call list), editable only by officers in
-- Settings.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF NOT
-- EXISTS / DROP POLICY IF EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS phone_book_entries (
  phone_book_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  label text NOT NULL,
  phone text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Same "read = member, write = officer" shape as duty_types and the other
-- department-configured reference tables (see
-- 2026-08-21_rls_policies_core_tables.sql, 2026-08-22_duty_types.sql).
ALTER TABLE phone_book_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "phone_book_entries_select_department" ON phone_book_entries;
CREATE POLICY "phone_book_entries_select_department" ON phone_book_entries
  FOR SELECT USING (is_department_member(department_id));

DROP POLICY IF EXISTS "phone_book_entries_insert_officer" ON phone_book_entries;
CREATE POLICY "phone_book_entries_insert_officer" ON phone_book_entries
  FOR INSERT WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "phone_book_entries_update_officer" ON phone_book_entries;
CREATE POLICY "phone_book_entries_update_officer" ON phone_book_entries
  FOR UPDATE USING (is_department_officer(department_id)) WITH CHECK (is_department_officer(department_id));

DROP POLICY IF EXISTS "phone_book_entries_delete_officer" ON phone_book_entries;
CREATE POLICY "phone_book_entries_delete_officer" ON phone_book_entries
  FOR DELETE USING (is_department_officer(department_id));

COMMIT;
