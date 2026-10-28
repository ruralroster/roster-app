-- Removes the demo copy made by 1_copy_innisfail_to_demo.sql: the
-- "Wattle Creek Hospital" department and everything in it, and the
-- "Demo District" on DR Roster with its sites, doctors and shifts.
-- The two demo logins stay; delete them under Authentication if you like.
-- Touches nothing outside the demo.

BEGIN;

CREATE TEMP TABLE ctx ON COMMIT DROP AS
SELECT (SELECT department_id FROM departments WHERE name = 'Wattle Creek Hospital') AS dept,
       (SELECT district_id FROM districts WHERE name = 'Demo District') AS district;

-- DR Roster
DELETE FROM district_swap_offers WHERE listing_id IN (SELECT listing_id FROM district_swap_listings, ctx WHERE district_id = ctx.district)
   OR offered_notice_id IN (SELECT notice_id FROM district_notices, ctx WHERE district_id = ctx.district);
DELETE FROM district_swap_listings USING ctx WHERE district_id = ctx.district;
DELETE FROM district_applications WHERE notice_id IN (SELECT notice_id FROM district_notices, ctx WHERE district_id = ctx.district);
DELETE FROM district_escalations WHERE notice_id IN (SELECT notice_id FROM district_notices, ctx WHERE district_id = ctx.district);
DELETE FROM district_roster_shifts WHERE notice_id IN (SELECT notice_id FROM district_notices, ctx WHERE district_id = ctx.district);
DELETE FROM district_notices USING ctx WHERE district_id = ctx.district;
DELETE FROM district_unavailable_days WHERE doctor_id IN (SELECT doctor_id FROM district_doctors, ctx WHERE district_id = ctx.district);
DELETE FROM district_doctors USING ctx WHERE district_id = ctx.district;
DELETE FROM site_shift_types WHERE site_id IN (SELECT site_id FROM sites, ctx WHERE district_id = ctx.district);
DELETE FROM site_officers WHERE site_id IN (SELECT site_id FROM sites, ctx WHERE district_id = ctx.district);
DELETE FROM site_officer_pending WHERE site_id IN (SELECT site_id FROM sites, ctx WHERE district_id = ctx.district);
DELETE FROM sites USING ctx WHERE district_id = ctx.district;
DELETE FROM districts USING ctx WHERE district_id = ctx.district;

-- Rstar: children first, then the department.
DELETE FROM sick_call_alerts USING ctx WHERE department_id = ctx.dept;
DELETE FROM sick_reports USING ctx WHERE department_id = ctx.dept;
DELETE FROM volunteer_requests WHERE theatre_activity_id IN (SELECT theatre_activity_id FROM theatre_activities, ctx WHERE department_id = ctx.dept);
DELETE FROM volunteer_offers USING ctx WHERE department_id = ctx.dept;
DELETE FROM theatre_activity_visitors USING ctx WHERE department_id = ctx.dept;
DELETE FROM staff_assignments USING ctx WHERE department_id = ctx.dept;
DELETE FROM theatre_activities USING ctx WHERE department_id = ctx.dept;
DELETE FROM duty_assignments USING ctx WHERE department_id = ctx.dept;
DELETE FROM staff_availability USING ctx WHERE department_id = ctx.dept;
DELETE FROM callbacks USING ctx WHERE department_id = ctx.dept;
DELETE FROM assignment_history USING ctx WHERE department_id = ctx.dept;
DELETE FROM coffee_order_extras USING ctx WHERE department_id = ctx.dept;
DELETE FROM coffee_order_removed_staff USING ctx WHERE department_id = ctx.dept;
DELETE FROM coffee_order_sends USING ctx WHERE department_id = ctx.dept;
DELETE FROM push_subscriptions USING ctx WHERE department_id = ctx.dept;
DELETE FROM rule_violation_dismissals USING ctx WHERE department_id = ctx.dept;
DELETE FROM roster_import_mappings USING ctx WHERE department_id = ctx.dept;
DELETE FROM staff_favorites WHERE staff_id IN (SELECT staff_id FROM staff, ctx WHERE department_id = ctx.dept)
   OR starred_staff_id IN (SELECT staff_id FROM staff, ctx WHERE department_id = ctx.dept);
DELETE FROM staff USING ctx WHERE department_id = ctx.dept;
DELETE FROM week_template_applications USING ctx WHERE department_id = ctx.dept;
DELETE FROM week_template_entries WHERE week_template_id IN (SELECT week_template_id FROM week_templates, ctx WHERE department_id = ctx.dept);
DELETE FROM week_templates USING ctx WHERE department_id = ctx.dept;
DELETE FROM job_places USING ctx WHERE department_id = ctx.dept;
DELETE FROM job_types USING ctx WHERE department_id = ctx.dept;
DELETE FROM duty_types USING ctx WHERE department_id = ctx.dept;
DELETE FROM shift_pattern_rules USING ctx WHERE department_id = ctx.dept;
DELETE FROM phone_book_entries USING ctx WHERE department_id = ctx.dept;
DELETE FROM locations USING ctx WHERE department_id = ctx.dept;
DELETE FROM shifts USING ctx WHERE department_id = ctx.dept;
DELETE FROM activity_types USING ctx WHERE department_id = ctx.dept;
DELETE FROM leave_types USING ctx WHERE department_id = ctx.dept;
DELETE FROM advanced_skills USING ctx WHERE department_id = ctx.dept;
DELETE FROM rank_supervision_rules USING ctx WHERE department_id = ctx.dept;
DELETE FROM departments USING ctx WHERE department_id = ctx.dept;

SELECT 'demo removed' AS done;

COMMIT;
