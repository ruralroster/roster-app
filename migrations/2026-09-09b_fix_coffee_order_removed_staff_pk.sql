-- Hotfix for 2026-09-09_coffee_order_day_adjustments.sql — its
-- coffee_order_removed_staff table used PRIMARY KEY (department_id, date,
-- staff_id), i.e. exactly its two foreign-key columns (to departments and
-- to staff). PostgREST's schema introspection treats that shape as a
-- many-to-many junction table, which creates a SECOND relationship path
-- between staff and departments (alongside staff's own direct
-- department_id foreign key). Every implicit `staff -> departments` embed
-- anywhere in the app — including getMyMemberships(), which runs on every
-- login — became ambiguous as a result, failing with PGRST201 ("more than
-- one relationship was found for 'staff' and 'departments'"). This is
-- what broke login department-wide, not anything RLS- or data-related.
--
-- coffee_order_extras doesn't have this problem because it already used a
-- surrogate primary key (extra_id) rather than a composite one — this
-- migration brings coffee_order_removed_staff in line with that, giving
-- it a surrogate id and demoting the (department_id, date, staff_id)
-- combination to a plain unique constraint, which does NOT trigger
-- PostgREST's junction-table inference.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE coffee_order_removed_staff DROP CONSTRAINT IF EXISTS coffee_order_removed_staff_pkey;

ALTER TABLE coffee_order_removed_staff ADD COLUMN IF NOT EXISTS id uuid PRIMARY KEY DEFAULT gen_random_uuid();

ALTER TABLE coffee_order_removed_staff DROP CONSTRAINT IF EXISTS coffee_order_removed_staff_dept_date_staff_key;
ALTER TABLE coffee_order_removed_staff ADD CONSTRAINT coffee_order_removed_staff_dept_date_staff_key
  UNIQUE (department_id, date, staff_id);

COMMIT;
