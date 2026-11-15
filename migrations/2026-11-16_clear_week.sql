-- Clear a week from the Calendar tab, and put it back.
--
-- roster_week_clear(department, week start, whole, apply)
--   whole false: takes everyone off the week's cards and on-call, and keeps
--     the cards.
--   whole true: the cards go too, and the "template applied" label.
--   apply false: just counts what would go (the preview); apply true does
--     it and returns everything it removed, for roster_week_restore.
--
-- Only days after today: days that have started are a record of who
-- worked. Leave (leave_code rows) is the person's and stays. Nobody is told.
--
-- Anything linked to DR App stays, so the two apps keep agreeing:
-- a DR App doctor booked onto a card (district_escalations.assignment_id /
-- visitor_id), an allocation listed for swap (district_roster_shifts), and
-- a card with a gap that's gone up to DR App, with its offer (removing the
-- offer would cancel the district shift as withdrawn). A card that keeps
-- anyone on it stays too.
--
-- roster_week_restore(department, snapshot) puts back exactly those rows,
-- with their own IDs. Anything since added in their place is left alone.
--
-- Run in the SQL editor. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION roster_week_clear(p_department_id uuid, p_week_start date, p_whole boolean, p_apply boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date := greatest(p_week_start, (now() AT TIME ZONE 'Australia/Brisbane')::date + 1);
  v_to date := p_week_start + 6;
  v_snapshot jsonb;
  v_counts jsonb;
BEGIN
  IF NOT is_department_officer(p_department_id) THEN
    RAISE EXCEPTION 'Only an officer can clear a week';
  END IF;
  IF extract(isodow FROM p_week_start) <> 1 THEN
    RAISE EXCEPTION 'A week starts on a Monday';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS rwc_cards (theatre_activity_id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS rwc_assignments (assignment_id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS rwc_kept_assignments (assignment_id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS rwc_visitors (visitor_id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS rwc_offers (volunteer_offer_id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS rwc_remove_cards (theatre_activity_id uuid PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE rwc_cards, rwc_assignments, rwc_kept_assignments, rwc_visitors, rwc_offers, rwc_remove_cards;

  INSERT INTO rwc_cards
  SELECT theatre_activity_id FROM theatre_activities
  WHERE department_id = p_department_id AND date BETWEEN v_from AND v_to;

  -- Linked to DR App.
  INSERT INTO rwc_kept_assignments
  SELECT a.assignment_id FROM staff_assignments a
  WHERE a.department_id = p_department_id AND a.date BETWEEN v_from AND v_to
    AND (EXISTS (SELECT 1 FROM district_escalations e WHERE e.assignment_id = a.assignment_id)
      OR EXISTS (SELECT 1 FROM district_roster_shifts r WHERE r.assignment_id = a.assignment_id));

  INSERT INTO rwc_assignments
  SELECT a.assignment_id FROM staff_assignments a
  WHERE a.department_id = p_department_id AND a.date BETWEEN v_from AND v_to
    AND a.leave_code IS NULL
    AND a.assignment_id NOT IN (SELECT assignment_id FROM rwc_kept_assignments);

  INSERT INTO rwc_visitors
  SELECT v.visitor_id FROM theatre_activity_visitors v
  WHERE v.theatre_activity_id IN (SELECT theatre_activity_id FROM rwc_cards)
    AND NOT EXISTS (SELECT 1 FROM district_escalations e WHERE e.visitor_id = v.visitor_id);

  -- Offers still on Rstar (not gone up to DR App).
  INSERT INTO rwc_offers
  SELECT o.volunteer_offer_id FROM volunteer_offers o
  WHERE o.theatre_activity_id IN (SELECT theatre_activity_id FROM rwc_cards)
    AND NOT EXISTS (SELECT 1 FROM district_escalations e WHERE e.volunteer_offer_id = o.volunteer_offer_id);

  -- Cards that end up with nobody on them and nothing on DR App.
  IF p_whole THEN
    INSERT INTO rwc_remove_cards
    SELECT c.theatre_activity_id FROM rwc_cards c
    WHERE NOT EXISTS (SELECT 1 FROM district_escalations e WHERE e.theatre_activity_id = c.theatre_activity_id)
      AND NOT EXISTS (SELECT 1 FROM staff_assignments a
                      WHERE a.theatre_activity_id = c.theatre_activity_id
                        AND a.assignment_id NOT IN (SELECT assignment_id FROM rwc_assignments))
      AND NOT EXISTS (SELECT 1 FROM theatre_activity_visitors v
                      WHERE v.theatre_activity_id = c.theatre_activity_id
                        AND v.visitor_id NOT IN (SELECT visitor_id FROM rwc_visitors));
  END IF;

  v_counts := jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'allocations', (SELECT count(*) FROM staff_assignments a WHERE a.assignment_id IN (SELECT assignment_id FROM rwc_assignments) AND NOT a.on_call),
    'on_call', (SELECT count(*) FROM staff_assignments a WHERE a.assignment_id IN (SELECT assignment_id FROM rwc_assignments) AND a.on_call)
      + (SELECT count(*) FROM duty_assignments d WHERE d.department_id = p_department_id AND d.date BETWEEN v_from AND v_to),
    'people', (SELECT count(DISTINCT staff_id) FROM (
        SELECT a.staff_id FROM staff_assignments a WHERE a.assignment_id IN (SELECT assignment_id FROM rwc_assignments)
        UNION SELECT d.staff_id FROM duty_assignments d WHERE d.department_id = p_department_id AND d.date BETWEEN v_from AND v_to) x),
    'visitors', (SELECT count(*) FROM rwc_visitors),
    'offers', (SELECT count(*) FROM rwc_offers),
    'cards', (SELECT count(*) FROM rwc_remove_cards),
    'cards_kept', CASE WHEN p_whole THEN (SELECT count(*) FROM rwc_cards) - (SELECT count(*) FROM rwc_remove_cards) ELSE 0 END,
    'kept_for_dr_app', (SELECT count(*) FROM rwc_kept_assignments)
      + (SELECT count(*) FROM theatre_activity_visitors v
         WHERE v.theatre_activity_id IN (SELECT theatre_activity_id FROM rwc_cards)
           AND v.visitor_id NOT IN (SELECT visitor_id FROM rwc_visitors)),
    'escalated_cards', (SELECT count(*) FROM rwc_cards c WHERE EXISTS (SELECT 1 FROM district_escalations e WHERE e.theatre_activity_id = c.theatre_activity_id)),
    'leave_kept', (SELECT count(*) FROM staff_assignments a WHERE a.department_id = p_department_id AND a.date BETWEEN v_from AND v_to AND a.leave_code IS NOT NULL)
  );

  IF NOT p_apply THEN
    RETURN jsonb_build_object('counts', v_counts);
  END IF;

  v_snapshot := jsonb_build_object(
    'cards', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM theatre_activities t WHERE t.theatre_activity_id IN (SELECT theatre_activity_id FROM rwc_remove_cards)),
    'template_applications', CASE WHEN p_whole
      THEN (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM week_template_applications t WHERE t.department_id = p_department_id AND t.week_start_date = p_week_start)
      ELSE '[]' END,
    'assignments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM staff_assignments t WHERE t.assignment_id IN (SELECT assignment_id FROM rwc_assignments)),
    'visitors', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM theatre_activity_visitors t WHERE t.visitor_id IN (SELECT visitor_id FROM rwc_visitors)),
    'duties', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM duty_assignments t WHERE t.department_id = p_department_id AND t.date BETWEEN v_from AND v_to),
    'offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM volunteer_offers t WHERE t.volunteer_offer_id IN (SELECT volunteer_offer_id FROM rwc_offers)),
    'requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM volunteer_requests t
                 WHERE t.department_id = p_department_id AND t.theatre_activity_id IN (SELECT theatre_activity_id FROM rwc_cards)
                   AND (t.theatre_activity_id IN (SELECT theatre_activity_id FROM rwc_remove_cards)
                        OR EXISTS (SELECT 1 FROM volunteer_offers o
                                   WHERE o.volunteer_offer_id IN (SELECT volunteer_offer_id FROM rwc_offers)
                                     AND o.theatre_activity_id = t.theatre_activity_id AND o.role = t.role)))
  );

  -- Volunteers for offers that are going, or on cards that are going.
  DELETE FROM volunteer_requests t
  WHERE t.department_id = p_department_id AND t.theatre_activity_id IN (SELECT theatre_activity_id FROM rwc_cards)
    AND (t.theatre_activity_id IN (SELECT theatre_activity_id FROM rwc_remove_cards)
         OR EXISTS (SELECT 1 FROM volunteer_offers o
                    WHERE o.volunteer_offer_id IN (SELECT volunteer_offer_id FROM rwc_offers)
                      AND o.theatre_activity_id = t.theatre_activity_id AND o.role = t.role));
  DELETE FROM volunteer_offers WHERE volunteer_offer_id IN (SELECT volunteer_offer_id FROM rwc_offers);
  DELETE FROM theatre_activity_visitors WHERE visitor_id IN (SELECT visitor_id FROM rwc_visitors);
  DELETE FROM staff_assignments WHERE assignment_id IN (SELECT assignment_id FROM rwc_assignments);
  DELETE FROM duty_assignments WHERE department_id = p_department_id AND date BETWEEN v_from AND v_to;
  IF p_whole THEN
    DELETE FROM theatre_activities WHERE theatre_activity_id IN (SELECT theatre_activity_id FROM rwc_remove_cards);
    DELETE FROM week_template_applications WHERE department_id = p_department_id AND week_start_date = p_week_start;
  END IF;

  RETURN jsonb_build_object('counts', v_counts, 'snapshot', v_snapshot);
END;
$$;
REVOKE EXECUTE ON FUNCTION roster_week_clear(uuid, date, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION roster_week_clear(uuid, date, boolean, boolean) TO authenticated;

-- Only rows of this department, onto this department's cards and staff;
-- anything that clashes with what's there now is skipped.
CREATE OR REPLACE FUNCTION roster_week_restore(p_department_id uuid, p_snapshot jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cards int;
  v_assignments int;
  v_visitors int;
  v_duties int;
  v_offers int;
BEGIN
  IF NOT is_department_officer(p_department_id) THEN
    RAISE EXCEPTION 'Only an officer can put a week back';
  END IF;

  INSERT INTO theatre_activities
  SELECT * FROM jsonb_populate_recordset(NULL::theatre_activities, coalesce(p_snapshot->'cards', '[]'))
  WHERE department_id = p_department_id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_cards = ROW_COUNT;

  INSERT INTO week_template_applications
  SELECT * FROM jsonb_populate_recordset(NULL::week_template_applications, coalesce(p_snapshot->'template_applications', '[]'))
  WHERE department_id = p_department_id
  ON CONFLICT DO NOTHING;

  INSERT INTO staff_assignments
  SELECT r.* FROM jsonb_populate_recordset(NULL::staff_assignments, coalesce(p_snapshot->'assignments', '[]')) r
  WHERE r.department_id = p_department_id
    AND EXISTS (SELECT 1 FROM staff s WHERE s.staff_id = r.staff_id AND s.department_id = p_department_id)
    AND (r.theatre_activity_id IS NULL OR EXISTS (
      SELECT 1 FROM theatre_activities t WHERE t.theatre_activity_id = r.theatre_activity_id AND t.department_id = p_department_id))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_assignments = ROW_COUNT;

  INSERT INTO theatre_activity_visitors
  SELECT r.* FROM jsonb_populate_recordset(NULL::theatre_activity_visitors, coalesce(p_snapshot->'visitors', '[]')) r
  WHERE r.department_id = p_department_id
    AND EXISTS (SELECT 1 FROM theatre_activities t WHERE t.theatre_activity_id = r.theatre_activity_id AND t.department_id = p_department_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_visitors = ROW_COUNT;

  INSERT INTO duty_assignments
  SELECT r.* FROM jsonb_populate_recordset(NULL::duty_assignments, coalesce(p_snapshot->'duties', '[]')) r
  WHERE r.department_id = p_department_id
    AND EXISTS (SELECT 1 FROM staff s WHERE s.staff_id = r.staff_id AND s.department_id = p_department_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_duties = ROW_COUNT;

  INSERT INTO volunteer_offers
  SELECT r.* FROM jsonb_populate_recordset(NULL::volunteer_offers, coalesce(p_snapshot->'offers', '[]')) r
  WHERE r.department_id = p_department_id
    AND EXISTS (SELECT 1 FROM theatre_activities t WHERE t.theatre_activity_id = r.theatre_activity_id AND t.department_id = p_department_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_offers = ROW_COUNT;

  INSERT INTO volunteer_requests
  SELECT r.* FROM jsonb_populate_recordset(NULL::volunteer_requests, coalesce(p_snapshot->'requests', '[]')) r
  WHERE r.department_id = p_department_id
    AND EXISTS (SELECT 1 FROM staff s WHERE s.staff_id = r.staff_id AND s.department_id = p_department_id)
    AND EXISTS (SELECT 1 FROM theatre_activities t WHERE t.theatre_activity_id = r.theatre_activity_id AND t.department_id = p_department_id)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('cards', v_cards, 'allocations', v_assignments + v_visitors, 'on_call', v_duties, 'offers', v_offers);
END;
$$;
REVOKE EXECUTE ON FUNCTION roster_week_restore(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION roster_week_restore(uuid, jsonb) TO authenticated;

COMMIT;
