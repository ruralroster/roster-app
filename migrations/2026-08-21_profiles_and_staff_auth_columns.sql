-- Adds the auth identity layer: a `profiles` table mirroring the bits of
-- Supabase-managed `auth.users` that RLS policies need to read (policies run
-- as anon/authenticated, which have no grant on the `auth` schema — hence
-- mirroring id/email into a public table instead of joining auth.users
-- directly), plus the columns on `staff` that link a per-department staff
-- record to a login and say whether that login is an officer.
--
-- Deliberately does NOT enable Row Level Security or add any policies —
-- that's a separate, later migration, run only after every real staff
-- member who needs access has been linked via the invite flow. Enabling
-- RLS before any staff.user_id is populated would lock everyone out, since
-- every policy checks user_id = auth.uid().
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- idempotent (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'staff';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_role_check'
  ) THEN
    ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role IN ('staff', 'officer'));
  END IF;
END $$;

-- NOTE: the DEFAULT 'staff' above means every existing staff row becomes
-- non-officer the moment this runs — nobody who was informally "the
-- officer" via the old button-click model gets role='officer'
-- automatically. After running this, and after linking real accounts via
-- the invite flow, run a one-time reviewed UPDATE to promote whoever
-- should actually be an officer, e.g.:
--   UPDATE staff SET role = 'officer' WHERE staff_id IN (...);

COMMIT;
