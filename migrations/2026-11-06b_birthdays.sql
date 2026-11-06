-- Birthday notifications. A staff member can opt in from Settings →
-- Profile with just a day and month (no year). On the day:
--   - whoever opens the Coffee popup sees a birthday message for anyone on
--     that day's coffee order, and
--   - the birthday person gets a "Happy birthday" when they open the app.
--
-- staff_birthdays is readable only by its owner, so nobody can look up a
-- colleague's birthday. birthdays_today() is the only way to see anyone
-- else's, and it only says whose birthday it is today, by name.
-- A 29 February birthday counts as 28 February in other years.
-- dairy_free / gluten_free (both off unless ticked) go with the name, so
-- the coffee run picks the right cake.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS staff_birthdays (
  staff_id uuid PRIMARY KEY REFERENCES staff(staff_id) ON DELETE CASCADE,
  day smallint NOT NULL,
  month smallint NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT staff_birthdays_valid_date CHECK (
    month BETWEEN 1 AND 12
    AND day BETWEEN 1 AND (CASE WHEN month = 2 THEN 29 WHEN month IN (4, 6, 9, 11) THEN 30 ELSE 31 END)
  )
);

-- Separate so this file can be re-run over the first version.
ALTER TABLE staff_birthdays ADD COLUMN IF NOT EXISTS dairy_free boolean NOT NULL DEFAULT false;
ALTER TABLE staff_birthdays ADD COLUMN IF NOT EXISTS gluten_free boolean NOT NULL DEFAULT false;

ALTER TABLE staff_birthdays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_birthdays_own" ON staff_birthdays;
CREATE POLICY "staff_birthdays_own" ON staff_birthdays
  FOR ALL USING (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
  ) WITH CHECK (
    staff_id IN (SELECT staff_id FROM staff WHERE user_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON staff_birthdays TO authenticated;
GRANT ALL ON staff_birthdays TO service_role;

-- Everyone in the department whose birthday is today (Brisbane time).
DROP FUNCTION IF EXISTS birthdays_today(uuid);
CREATE FUNCTION birthdays_today(p_department_id uuid)
RETURNS TABLE (staff_id uuid, name text, dairy_free boolean, gluten_free boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Australia/Brisbane')::date;
  v_day int := extract(day FROM v_today);
  v_month int := extract(month FROM v_today);
  v_leap boolean := (extract(year FROM v_today)::int % 4 = 0 AND extract(year FROM v_today)::int % 100 <> 0)
    OR extract(year FROM v_today)::int % 400 = 0;
BEGIN
  IF NOT is_department_member(p_department_id) THEN
    RAISE EXCEPTION 'Not a member of this department';
  END IF;
  RETURN QUERY
    SELECT s.staff_id, s.name, b.dairy_free, b.gluten_free
    FROM staff_birthdays b JOIN staff s ON s.staff_id = b.staff_id
    WHERE s.department_id = p_department_id AND s.active
      AND (
        (b.month = v_month AND b.day = v_day)
        OR (NOT v_leap AND v_month = 2 AND v_day = 28 AND b.month = 2 AND b.day = 29)
      )
    ORDER BY s.name;
END;
$$;
REVOKE EXECUTE ON FUNCTION birthdays_today(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION birthdays_today(uuid) TO authenticated;

COMMIT;
