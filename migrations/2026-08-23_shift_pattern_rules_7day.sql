-- Extends shift_pattern_rules from a fixed 4-day lookback window to a
-- fixed 7-day one — shift_1_id now means 6 days before the assignment
-- date, through shift_7_id being the shift being assigned today (was
-- shift_1_id = 3 days before ... shift_4_id = today). See
-- validateShiftAssignment() in supabaseClient.js, which builds the
-- matching sequence.
--
-- Existing rules (if any) are NOT reinterpreted — this only adds the three
-- new columns (NULL = "Any Shift" wildcard, same as every other position),
-- it doesn't renumber what shift_1..shift_4 meant before. If old 4-day
-- rules are still in place, clear them first (Settings → Shift Pattern
-- Rules → Clear All Rules) before rebuilding under the new 7-day window,
-- since a pre-existing rule's shift_1..shift_4 would now read as "6, 5, 4,
-- 3 days before" instead of "3, 2, 1 days before, today".
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF NOT
-- EXISTS / guarded constraint swap.

BEGIN;

ALTER TABLE shift_pattern_rules
  ADD COLUMN IF NOT EXISTS shift_5_id uuid REFERENCES shifts(shift_id),
  ADD COLUMN IF NOT EXISTS shift_6_id uuid REFERENCES shifts(shift_id),
  ADD COLUMN IF NOT EXISTS shift_7_id uuid REFERENCES shifts(shift_id);

-- Swap the old (department_id, shift_1..shift_4) unique constraint for one
-- covering all 7 positions — otherwise two genuinely different 7-day rules
-- that happen to share the same first 4 shifts would collide. Found
-- dynamically rather than by a guessed auto-generated name: the original
-- migration didn't name it explicitly, so Postgres assigned whatever name
-- it assigns.
DO $$
DECLARE
  old_constraint_name text;
BEGIN
  SELECT con.conname INTO old_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'shift_pattern_rules'
    AND con.contype = 'u'
    AND array_length(con.conkey, 1) = 5;

  IF old_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE shift_pattern_rules DROP CONSTRAINT %I', old_constraint_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'shift_pattern_rules'
      AND con.contype = 'u'
      AND array_length(con.conkey, 1) = 8
  ) THEN
    ALTER TABLE shift_pattern_rules
      ADD CONSTRAINT shift_pattern_rules_7day_key
      UNIQUE (department_id, shift_1_id, shift_2_id, shift_3_id, shift_4_id, shift_5_id, shift_6_id, shift_7_id);
  END IF;
END $$;

COMMIT;
