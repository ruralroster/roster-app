-- Gives every active staff member without an email a default
-- firstname.lastname@health.qld.gov.au, so the coffee order emails (the
-- 9:00 order and later updates to whoever's on the ED late on call) always
-- have somewhere to go.
--
-- Only touches the real department (5f83d0f0-...), only active staff, and
-- only blank emails. A title (Dr, Prof, A/Prof, Mr, Mrs, Ms, Miss) is
-- dropped; "Last, First" is read as First Last; middle names are dropped;
-- anything other than letters and hyphens is removed (so O'Brien becomes
-- obrien). If two people would get the same address, or someone already
-- has it, neither is changed: fix those by hand.
--
-- Step 1: run the SELECT on its own and check the list.
-- Step 2: run the whole file.
-- Safe to re-run: only blank emails are filled.

-- Step 1 (preview):
--   WITH parts AS (
--     SELECT staff_id, name,
--       regexp_split_to_array(trim(regexp_replace(
--         CASE WHEN name LIKE '%,%' THEN split_part(name, ',', 2) || ' ' || split_part(name, ',', 1) ELSE name END,
--         '^\s*(dr|prof|a/prof|mr|mrs|ms|miss)\.?\s+', '', 'i')), '\s+') AS words
--     FROM staff
--     WHERE department_id = '5f83d0f0-27f7-4089-8037-8f13259b2132'
--       AND active AND coalesce(trim(email), '') = ''
--   )
--   SELECT name,
--     regexp_replace(lower(words[1]), '[^a-z-]', '', 'g') || '.' ||
--     regexp_replace(lower(words[array_length(words, 1)]), '[^a-z-]', '', 'g') || '@health.qld.gov.au' AS new_email
--   FROM parts ORDER BY name;

BEGIN;

WITH parts AS (
  SELECT staff_id,
    regexp_split_to_array(trim(regexp_replace(
      CASE WHEN name LIKE '%,%' THEN split_part(name, ',', 2) || ' ' || split_part(name, ',', 1) ELSE name END,
      '^\s*(dr|prof|a/prof|mr|mrs|ms|miss)\.?\s+', '', 'i')), '\s+') AS words
  FROM staff
  WHERE department_id = '5f83d0f0-27f7-4089-8037-8f13259b2132'
    AND active AND coalesce(trim(email), '') = ''
),
proposed AS (
  SELECT staff_id,
    regexp_replace(lower(words[1]), '[^a-z-]', '', 'g') || '.' ||
    regexp_replace(lower(words[array_length(words, 1)]), '[^a-z-]', '', 'g') || '@health.qld.gov.au' AS new_email
  FROM parts
  WHERE array_length(words, 1) >= 2
),
safe AS (
  SELECT p.staff_id, p.new_email
  FROM proposed p
  WHERE (SELECT count(*) FROM proposed p2 WHERE p2.new_email = p.new_email) = 1
    AND NOT EXISTS (SELECT 1 FROM staff s WHERE lower(s.email) = p.new_email)
)
UPDATE staff s
SET email = safe.new_email
FROM safe
WHERE s.staff_id = safe.staff_id;

COMMIT;

-- Anyone still without an email (one-word names, clashes): fix by hand.
--   SELECT name, rank FROM staff
--   WHERE department_id = '5f83d0f0-27f7-4089-8037-8f13259b2132'
--     AND active AND coalesce(trim(email), '') = '';
