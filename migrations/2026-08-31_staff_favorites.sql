-- "Starred staff" — a staff member can star up to 10 colleagues (enforced
-- client-side before insert, no DB-side cap since nothing else in this
-- schema uses a trigger for that shape of rule) so they show up under
-- "your weekly assignments" in staffRosterView.jsx, with a "crossover"
-- view comparing which days this week you're both working vs both off.
--
-- Self-service only — a staff member manages their own starred list, same
-- shape as staff_availability_self in
-- migrations/2026-08-21_rls_policies_self_service.sql. staff_assignments
-- is already department-wide readable (is_department_member), so no new
-- policy is needed to show a starred colleague's shifts. staff_availability
-- is NOT department-wide readable (self/officer only) — get_staff_off_days
-- below exposes just the yes/no "off that day" signal a crossover needs,
-- not the underlying leave type/reason, via a SECURITY DEFINER function
-- rather than widening staff_availability's own RLS.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS staff_favorites (
  favorite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
  starred_staff_id uuid NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, starred_staff_id),
  CHECK (staff_id != starred_staff_id)
);

ALTER TABLE staff_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_favorites_self" ON staff_favorites;
CREATE POLICY "staff_favorites_self" ON staff_favorites
  FOR ALL USING (
    EXISTS (SELECT 1 FROM staff s WHERE s.staff_id = staff_favorites.staff_id AND s.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM staff s WHERE s.staff_id = staff_favorites.staff_id AND s.user_id = auth.uid())
  );

-- Deliberately returns ONLY the dates marked unavailable — no leave_type_id,
-- no reason — so a starred colleague can see "we're both off Tuesday"
-- without either of them seeing WHY the other is off. is_department_member
-- re-applies the same membership check staff_availability's own RLS would,
-- just manually, since SECURITY DEFINER bypasses that RLS entirely.
CREATE OR REPLACE FUNCTION public.get_staff_off_days(p_staff_id uuid, p_start date, p_end date)
RETURNS TABLE(date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sa.date
  FROM staff_availability sa
  JOIN staff s ON s.staff_id = sa.staff_id
  WHERE sa.staff_id = p_staff_id
    AND sa.available = false
    AND sa.date BETWEEN p_start AND p_end
    AND is_department_member(s.department_id);
$$;

COMMIT;
