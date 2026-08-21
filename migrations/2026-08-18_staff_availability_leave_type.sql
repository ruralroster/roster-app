-- Adds an optional leave type to a staff_availability row, so marking a
-- future week off can be tagged with why (Annual Leave, Sick Leave, etc.)
-- instead of just true/false. Run this whole file in the Supabase SQL
-- Editor (Project > SQL Editor > New query). Safe to re-run: idempotent
-- (IF NOT EXISTS).

BEGIN;

ALTER TABLE staff_availability
  ADD COLUMN IF NOT EXISTS leave_type_id uuid REFERENCES leave_types(leave_type_id) ON DELETE SET NULL;

COMMIT;

-- NOTE on Row Level Security: if RLS is enabled on staff_availability with a
-- policy granting the anon role read/write, adding a column doesn't change
-- that — no policy changes needed here.
