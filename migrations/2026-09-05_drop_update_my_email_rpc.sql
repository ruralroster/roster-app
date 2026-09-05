-- Drops update_my_email, superseded by the update-staff-email Edge Function
-- (see supabase/functions/update-staff-email/index.ts). This RPC could only
-- write staff.email — never auth.users.email — so an email edit here left
-- the account's actual login credential silently pointing at a stale
-- address. That's exactly what caused a real incident: a staff member's
-- one-time password kept failing with "Incorrect email or password" even
-- after repeated regeneration, because staff.email had drifted from
-- auth.users.email. updateMyEmail (src/supabaseClient.js) now calls the
-- Edge Function instead, which updates staff.email, profiles.email, and
-- auth.users.email together.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run:
-- idempotent (IF EXISTS).

BEGIN;

DROP FUNCTION IF EXISTS update_my_email(uuid, text);

COMMIT;
