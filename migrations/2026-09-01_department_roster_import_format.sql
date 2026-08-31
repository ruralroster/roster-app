-- Which Excel roster layout a department's Import tab uses — previously
-- both "classic" and "ed" formats were visible and selectable in every
-- department's Import tab, even though each department only ever uses its
-- own layout. Deliberately plain text with no CHECK constraint (unlike an
-- earlier attempt at a fixed-value rank list this session, which turned
-- into exactly the kind of friction a growing list of formats would hit
-- here too) — validity is enforced by the dropdown only ever offering
-- known values, in src/RosterExcelImportTab.jsx's FORMATS constant.
--
-- Every existing department defaults to 'classic' (today's only real
-- layout before the ED one existed) so nothing changes for them; the ED
-- department needs this set to 'ed' once, by a super-admin, after running
-- this migration.
--
-- Run this whole file in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS roster_import_format text NOT NULL DEFAULT 'classic';

COMMIT;
