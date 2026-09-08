-- The Coffee Orders modal (staffRosterView.jsx) computes "today's coffee
-- order" fresh from the roster every time it's opened — there was nowhere
-- to remove a rostered person who doesn't actually want one today, and
-- "extras" for people not on the roster (locums, visiting surgeons) only
-- ever lived in that one browser tab's state, invisible to a second person
-- opening the modal later. These two tables hold exactly those
-- adjustments, keyed by department_id + date so nothing carries over to
-- the next day — Tuesday's removals/extras have no bearing on Wednesday's.
--
-- Any active department member can add or remove — this is a shared,
-- collaboratively-edited list for the day (whoever's checking the order
-- before texting it), not personal data, so there's no "only the person
-- who added it can remove it" restriction.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
--
-- IMPORTANT: also run 2026-09-09b_fix_coffee_order_removed_staff_pk.sql
-- straight after this one — coffee_order_removed_staff's composite
-- primary key below made PostgREST infer it as a staff<->departments
-- junction table, breaking every implicit staff->departments embed
-- app-wide (including login). The follow-up migration fixes it.

BEGIN;

CREATE TABLE IF NOT EXISTS coffee_order_removed_staff (
  department_id uuid NOT NULL REFERENCES departments(department_id),
  date date NOT NULL,
  staff_id uuid NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
  removed_by uuid REFERENCES staff(staff_id),
  removed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, date, staff_id)
);

ALTER TABLE coffee_order_removed_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coffee_order_removed_staff_member" ON coffee_order_removed_staff;
CREATE POLICY "coffee_order_removed_staff_member" ON coffee_order_removed_staff
  FOR ALL USING (is_department_member(department_id))
  WITH CHECK (is_department_member(department_id));

CREATE TABLE IF NOT EXISTS coffee_order_extras (
  extra_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  date date NOT NULL,
  coffee_type text NOT NULL,
  milk_type text,
  quantity int NOT NULL CHECK (quantity > 0),
  label text,
  added_by uuid REFERENCES staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coffee_order_extras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coffee_order_extras_member" ON coffee_order_extras;
CREATE POLICY "coffee_order_extras_member" ON coffee_order_extras
  FOR ALL USING (is_department_member(department_id))
  WITH CHECK (is_department_member(department_id));

CREATE INDEX IF NOT EXISTS idx_coffee_order_extras_dept_date ON coffee_order_extras (department_id, date);

COMMIT;
