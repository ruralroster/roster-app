-- Two targeted fixes to validate_supervision, confirmed 2026-08-31 —
-- deliberately NOT touching the max_per_consultant / can_share_supervisor
-- capacity logic below, since that has its own pre-existing quirks (e.g.
-- basic_trainee's can_share_supervisor=true currently defeats its own
-- max_per_consultant=1 cap entirely — the "cannot share" check requires
-- NOT can_share_supervisor to fire at all) that need a real conversation
-- before being changed, not a unilateral rewrite.
--
-- Fix 1: rank_supervision_rules/this function spelled the intern rank
-- 'in_term'; the actual staff.rank value is 'intern' (see
-- staff_rank_check). Every 'in_term' comparison below is corrected —
-- the rows themselves were already fixed in
-- migrations/2026-08-31_staff_ranks.sql.
--
-- Fix 2: "who counts as a valid on-site supervisor" was hardcoded to the
-- literal rank name 'consultant' in two places. That's a hard blocker for
-- any department that doesn't use that exact rank name (e.g. a new
-- Emergency Department whose senior rank might be called something else
-- entirely) — supervision could never pass no matter who was rostered.
-- Generalized to "any rank this department has flagged
-- requires_supervision = false", which is exactly equivalent to the old
-- behavior for every department using the classic 5 ranks (consultant/
-- fellow both have requires_supervision = false there), and now actually
-- works for a department with different rank names.
--
-- A rank with no matching row in rank_supervision_rules is now treated as
-- "requires supervision" via COALESCE — previously NULL fell through
-- PL/pgSQL's `IF NOT NULL` (which is neither true nor false) without an
-- explicit early return, relying on incidental behavior further down
-- rather than a stated rule.
--
-- Run this whole file in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.validate_supervision(p_department_id uuid, p_date date, p_location_id uuid, p_shift_id uuid, p_staff_id uuid, p_staff_rank text)
 RETURNS TABLE(is_valid boolean, reason text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_requires_supervision BOOLEAN;
  v_max_per_consultant INT;
  v_can_share BOOLEAN;
  v_consultant_count INT;
  v_in_term_count INT;
  v_shared_trainee_count INT;
  v_locations_with_basic_or_interm INT;
BEGIN
  -- Get supervision rules for this rank
  SELECT requires_supervision, max_per_consultant, can_share_supervisor
    INTO v_requires_supervision, v_max_per_consultant, v_can_share
    FROM rank_supervision_rules
    WHERE department_id = p_department_id AND rank = p_staff_rank;

  -- If rank doesn't require supervision (or has no rule row at all —
  -- shouldn't happen once staff.rank's FK is in place, but explicit here
  -- rather than relying on IF NOT NULL's fall-through), assignment is valid
  IF NOT COALESCE(v_requires_supervision, true) THEN
    RETURN QUERY SELECT true, 'No supervision required'::TEXT;
    RETURN;
  END IF;

  -- Rank requires supervision: check if there's a valid supervisor (any
  -- rank NOT flagged requires_supervision in this department — generalizes
  -- the old hardcoded s.rank = 'consultant' check) in same location/shift
  SELECT COUNT(*)
    INTO v_consultant_count
    FROM staff_assignments sa
    JOIN staff s ON sa.staff_id = s.staff_id
    JOIN rank_supervision_rules r ON r.department_id = sa.department_id AND r.rank = s.rank
    WHERE sa.department_id = p_department_id
      AND sa.date = p_date
      AND sa.location_id = p_location_id
      AND sa.shift_id = p_shift_id
      AND r.requires_supervision = false
      AND sa.role = 'consultant';

  IF v_consultant_count = 0 THEN
    -- No supervisor in THIS location. Check if one exists in other locations for same shift.
    -- A supervisor can only work multiple locations if:
    -- 1) Assigning trainee is advanced_trainee
    -- 2) Supervisor isn't already assigned to a location with basic_trainee or intern

    IF p_staff_rank = 'advanced_trainee' THEN
      -- Count locations where a supervisor exists in same shift
      SELECT COUNT(DISTINCT sa.location_id)
        INTO v_consultant_count
        FROM staff_assignments sa
        JOIN staff s ON sa.staff_id = s.staff_id
        JOIN rank_supervision_rules r ON r.department_id = sa.department_id AND r.rank = s.rank
        WHERE sa.department_id = p_department_id
          AND sa.date = p_date
          AND sa.shift_id = p_shift_id
          AND r.requires_supervision = false
          AND sa.role = 'consultant';

      IF v_consultant_count > 0 THEN
        -- Supervisor exists in other location(s) for same shift
        -- Check if supervisor is already assigned to location with basic/intern
        SELECT COUNT(DISTINCT sa.location_id)
          INTO v_locations_with_basic_or_interm
          FROM staff_assignments sa
          JOIN staff s ON sa.staff_id = s.staff_id
          WHERE sa.department_id = p_department_id
            AND sa.date = p_date
            AND sa.shift_id = p_shift_id
            AND s.rank IN ('basic_trainee', 'intern')
            AND sa.role != 'consultant';

        IF v_locations_with_basic_or_interm = 0 THEN
          -- No basic/intern trainees supervised in any location for this shift
          -- Supervisor can span locations. Proceed to check advanced trainee count.
        ELSE
          -- Supervisor is already supervising basic/intern somewhere; can't span
          RETURN QUERY SELECT false, 'Consultant already supervising basic trainee or intern (cannot span locations)'::TEXT;
          RETURN;
        END IF;
      ELSE
        RETURN QUERY SELECT false, 'No consultant in same location/shift'::TEXT;
        RETURN;
      END IF;
    ELSE
      -- Basic trainee, intern, or any other rank requiring supervision:
      -- must have a supervisor in SAME location
      RETURN QUERY SELECT false, 'No consultant in same location/shift'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Supervisor exists in this location/shift. Check if they can supervise this trainee.

  -- Count interns already supervised by a supervisor in this location/shift
  SELECT COUNT(*)
    INTO v_in_term_count
    FROM staff_assignments sa
    JOIN staff s ON sa.staff_id = s.staff_id
    WHERE sa.department_id = p_department_id
      AND sa.date = p_date
      AND sa.location_id = p_location_id
      AND sa.shift_id = p_shift_id
      AND s.rank = 'intern'
      AND sa.role != 'consultant';

  -- If interns are present, that supervisor is fully booked (1:1 exclusive)
  IF v_in_term_count > 0 THEN
    RETURN QUERY SELECT false, 'Consultant already supervising an intern (1:1 exclusive)'::TEXT;
    RETURN;
  END IF;

  -- Check shared trainee count (basic + advanced trainees already assigned in THIS location)
  SELECT COUNT(*)
    INTO v_shared_trainee_count
    FROM staff_assignments sa
    JOIN staff s ON sa.staff_id = s.staff_id
    WHERE sa.department_id = p_department_id
      AND sa.date = p_date
      AND sa.location_id = p_location_id
      AND sa.shift_id = p_shift_id
      AND s.rank IN ('basic_trainee', 'advanced_trainee')
      AND sa.role != 'consultant';

  -- Check if adding this trainee would exceed max_per_consultant
  IF p_staff_rank = 'advanced_trainee' AND v_shared_trainee_count >= 2 THEN
    RETURN QUERY SELECT false, 'Consultant already supervising 2 advanced trainees in this location'::TEXT;
    RETURN;
  END IF;

  IF p_staff_rank = 'basic_trainee' AND v_shared_trainee_count >= 1 AND NOT v_can_share THEN
    RETURN QUERY SELECT false, 'Basic trainee cannot share supervisor'::TEXT;
    RETURN;
  END IF;

  -- All checks passed
  RETURN QUERY SELECT true, 'Assignment valid'::TEXT;
END;
$function$
