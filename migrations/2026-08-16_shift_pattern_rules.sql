-- Shift Pattern Rules: officers define 1-4 shift sequences and mark them
-- ALLOW / BLOCK / WARN. validateShiftAssignment() (see supabaseClient.js)
-- checks a staff member's 3 previous days plus the shift about to be
-- assigned against these rules before an officer can save an assignment.
-- Run this whole file in the Supabase SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run: idempotent (IF NOT EXISTS / ON CONFLICT / guarded seed).

BEGIN;

-- Fixed positions in a 4-day window ending on the day being assigned:
--   shift_1_id = 3 days before the assignment date
--   shift_2_id = 2 days before
--   shift_3_id = 1 day before (yesterday)
--   shift_4_id = the shift being assigned today
-- NULL in any position = "Any Shift" wildcard, matching whatever occupied
-- that day. A rule that only cares about the most recent 1-3 days leaves
-- its leading position(s) as the Any Shift wildcard (e.g. a 3-shift
-- pattern fills shift_1..shift_3 and leaves shift_4 null). Pattern length,
-- for "prioritize longest match" in validateShiftAssignment(), is simply
-- the count of non-null positions on the rule.
CREATE TABLE IF NOT EXISTS shift_pattern_rules (
  rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(department_id),
  shift_1_id uuid REFERENCES shifts(shift_id),
  shift_2_id uuid REFERENCES shifts(shift_id),
  shift_3_id uuid REFERENCES shifts(shift_id),
  shift_4_id uuid REFERENCES shifts(shift_id),
  rule_action TEXT NOT NULL CHECK (rule_action IN ('ALLOW', 'BLOCK', 'WARN')),
  description TEXT,
  created_at timestamptz DEFAULT now(),
  UNIQUE(department_id, shift_1_id, shift_2_id, shift_3_id, shift_4_id)
);

COMMIT;

-- NOTE on Row Level Security: if RLS is enabled on your other tables with
-- policies that grant the anon role read/write, apply the same shape here
-- so the app's anon key can read/write this table too. This file can't see
-- your existing policies from outside the database — check
-- Database > Policies in the Supabase dashboard after running this, e.g.:
--
-- ALTER TABLE shift_pattern_rules ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "shift_pattern_rules_anon_all" ON shift_pattern_rules
--   FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Seed examples for the Theatre Setup demo department.
-- ============================================================
-- "Day Off" isn't a real shift anywhere else in the app — a day off is just
-- the absence of a staff_assignments row for that staff member/date. It's
-- seeded here purely so pattern rules have a concrete shift_id to reference
-- for "was off that day": validateShiftAssignment() substitutes this
-- shift_id for any of the 3 lookback days that have no staff_assignments
-- row. session/start_time/end_time are left as non-working placeholders so
-- it doesn't get grouped into Morning/Afternoon/Night Allocations if it's
-- ever (unusually) picked directly in the Day tab.
DO $$
DECLARE
  dept_id uuid := '22222222-2222-2222-2222-222222222222';
  night_id uuid;
  am_id uuid;
  pm_id uuid;
  full_id uuid;
  evening_id uuid;
  off_id uuid;
BEGIN
  SELECT shift_id INTO night_id FROM shifts WHERE department_id = dept_id AND name = 'Night' LIMIT 1;
  SELECT shift_id INTO am_id FROM shifts WHERE department_id = dept_id AND name = 'AM' LIMIT 1;
  SELECT shift_id INTO pm_id FROM shifts WHERE department_id = dept_id AND name = 'PM' LIMIT 1;
  SELECT shift_id INTO full_id FROM shifts WHERE department_id = dept_id AND name = 'Full Day' LIMIT 1;
  SELECT shift_id INTO evening_id FROM shifts WHERE department_id = dept_id AND name = 'Evening' LIMIT 1;

  SELECT shift_id INTO off_id FROM shifts WHERE department_id = dept_id AND name = 'Day Off' LIMIT 1;
  IF off_id IS NULL THEN
    INSERT INTO shifts (department_id, name, day_type, start_time, end_time, session, active)
    VALUES (dept_id, 'Day Off', 'weekday', NULL, NULL, 'full', true)
    RETURNING shift_id INTO off_id;
  END IF;

  IF night_id IS NOT NULL AND full_id IS NOT NULL THEN
    INSERT INTO shift_pattern_rules (department_id, shift_1_id, shift_2_id, shift_3_id, shift_4_id, rule_action, description)
    VALUES
      -- 3 days ago=Night, 2 days ago=Night, yesterday=Off, today=Off
      (dept_id, night_id, night_id, off_id, off_id, 'ALLOW', 'Two nights require two full days off'),
      -- 3 days ago=Night, 2 days ago=Night, yesterday=Off, today=Full Day
      (dept_id, night_id, night_id, off_id, full_id, 'BLOCK', 'Can''t work a day shift after only one day off following two nights'),
      -- four consecutive nights
      (dept_id, night_id, night_id, night_id, night_id, 'ALLOW', 'Four consecutive nights permitted'),
      -- 2 days ago=Night, yesterday=Full Day, today=anything (Any Shift wildcard in position 1 and 4)
      (dept_id, NULL, night_id, full_id, NULL, 'WARN', 'Night shift followed by day shift is irregular pattern'),
      -- 3 days ago=Off, 2 days ago=Off, yesterday/today=anything
      (dept_id, off_id, off_id, NULL, NULL, 'ALLOW', 'Two days off then any shift OK'),
      -- 3 days ago=Night, everything else=anything (deliberately broad — testing edge case for "prioritize longest match")
      (dept_id, night_id, NULL, NULL, NULL, 'BLOCK', 'After single night, need structured recovery (testing edge case)')
    ON CONFLICT (department_id, shift_1_id, shift_2_id, shift_3_id, shift_4_id) DO NOTHING;
  END IF;
END $$;
