-- Lets each duty type (see migrations/2026-08-22_duty_types.sql) also show
-- up as a real card in the Morning/Afternoon/Night sections, not just the
-- Duty Assignments panel at the top of the Day view. Rather than building a
-- second, separately-rendered "on call" widget that has to be kept in sync
-- with duty_assignments by hand (two representations of the same fact
-- drifting apart), assigning someone to a duty type now also creates/
-- updates a normal theatre_activities row for them at a single shared "On
-- Call" location — so it renders through the exact same card machinery
-- (including session grouping and the multi-section cascade) as every other
-- activity, titled by the duty type's own linked activity_type (e.g.
-- "Anaesthetics On-Call") rather than a generic label.
--
-- start_time/end_time: configured per duty type in Settings, e.g. an
-- overnight Anaesthetics on-call slot running 21:00-08:00 — this is what
-- decides which section(s) its card groups under, same as any other
-- activity's own times.
--
-- activity_type_id: auto-created and kept alongside each duty type (see
-- createDutyType/updateDutyType in supabaseClient.js) so its card has a
-- distinct, matching title instead of every duty type sharing the "On
-- Call" location's own name.
--
-- shift_id: also auto-created/kept in sync with start_time/end_time. The
-- card's own on-call staff_assignment row is written with this shift_id
-- specifically (not just any active shift) because the Day view's
-- entryCoversGroup check (officer-roster-view-supabase.jsx) decides which
-- Morning/Afternoon/Night rendering of a card shows a given person by that
-- *person's own assigned shift* time, not the card's — an overnight duty
-- type (e.g. 21:00-08:00) paired with a mismatched shift would render its
-- Night card correctly but then filter its own occupant out of it.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run: IF NOT
-- EXISTS / guarded seed and backfill.

BEGIN;

ALTER TABLE duty_types
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS activity_type_id uuid REFERENCES activity_types(activity_id),
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(shift_id);

-- One shared "On Call" location per department — deliberately singular
-- (not per-specialty) so on-call coverage stays visible in one place
-- regardless of which duty type it's for.
INSERT INTO locations (department_id, name)
SELECT d.department_id, 'On Call'
FROM departments d
WHERE NOT EXISTS (
  SELECT 1 FROM locations l WHERE l.department_id = d.department_id AND l.name = 'On Call'
);

-- Backfill: give every duty type seeded by the previous migration its own
-- matching activity_type, so existing departments get titled cards as soon
-- as they set start/end times in Settings, with no re-creation needed.
INSERT INTO activity_types (department_id, name)
SELECT dt.department_id, dt.label
FROM duty_types dt
WHERE dt.activity_type_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM activity_types at WHERE at.department_id = dt.department_id AND at.name = dt.label
  );

UPDATE duty_types dt
SET activity_type_id = at.activity_id
FROM activity_types at
WHERE at.department_id = dt.department_id
  AND at.name = dt.label
  AND dt.activity_type_id IS NULL;

COMMIT;
