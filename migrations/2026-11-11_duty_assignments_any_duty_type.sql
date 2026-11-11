-- On-call slots are each department's own list (duty_types, Settings →
-- Duty Types — see 2026-08-22_duty_types.sql), keyed by a slug of the
-- slot's name ("Standby On-Call" → standby_on_call). But
-- duty_assignments.duty_type still carried a check from before that table
-- existed, allowing only the four keys the app used to hardcode
-- (am_coordinator, pm_coordinator, first_on_call, second_on_call). So a
-- slot added in Settings couldn't have anyone booked into it.
--
-- This drops that check. duty_type stays loosely coupled to
-- duty_types.key, as 2026-08-22_duty_types.sql describes; nothing in the
-- app relies on the four old keys.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

ALTER TABLE duty_assignments DROP CONSTRAINT IF EXISTS duty_assignments_duty_type_check;
