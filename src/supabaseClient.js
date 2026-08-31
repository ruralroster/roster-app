import { createClient } from '@supabase/supabase-js';
import { DEFAULT_FTE, computeFairnessRatio } from './availabilityUtils';
import { toLocalDateStr } from './dateUtils';
import { getSessionGroups } from './shiftSessionUtils';
import { getMondayOfWeek } from './payrollExport';
import { matchStaffName } from './rosterExcelImport';

console.log('=== supabaseClient.js LOADING ===');
console.log('Checking environment variables...');

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

console.log('REACT_APP_SUPABASE_URL:', SUPABASE_URL);
console.log('REACT_APP_SUPABASE_ANON_KEY exists:', !!SUPABASE_ANON_KEY);
console.log('REACT_APP_SUPABASE_ANON_KEY length:', SUPABASE_ANON_KEY?.length);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('FATAL: Missing Supabase environment variables');
  throw new Error('Missing Supabase environment variables. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in .env');
}

console.log('Creating Supabase client...');
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log('Supabase client created:', !!supabase);
console.log('=== supabaseClient.js LOADED ===');

// ============================================================
// SETUP & INITIALIZATION
// ============================================================

export async function initializeDepartment(departmentId) {
  console.log('initializeDepartment called with departmentId:', departmentId);
  
  try {
    const [locRes, activitiesRes, shiftsRes, staffRes, leaveTypesRes, departmentRes, dutyTypesRes, phoneBookRes, weekTemplatesRes, advancedSkillsRes, staffRanksRes] = await Promise.all([
      supabase
        .from('locations')
        .select('*')
        .eq('department_id', departmentId)
        .order('name'),
      supabase
        .from('activity_types')
        .select('*')
        .eq('department_id', departmentId)
        .order('name'),
      supabase
        .from('shifts')
        .select('*')
        .eq('department_id', departmentId)
        .order('start_time'),
      supabase
        .from('staff')
        .select('*')
        .eq('department_id', departmentId)
        .order('name'),
      supabase
        .from('leave_types')
        .select('*')
        .eq('department_id', departmentId)
        .order('name'),
      supabase
        .from('departments')
        .select('*')
        .eq('department_id', departmentId)
        .maybeSingle(),
      supabase
        .from('duty_types')
        .select('*')
        .eq('department_id', departmentId)
        .order('sort_order'),
      supabase
        .from('phone_book_entries')
        .select('*')
        .eq('department_id', departmentId)
        .eq('active', true)
        .order('sort_order'),
      supabase
        .from('week_templates')
        .select('*')
        .eq('department_id', departmentId)
        .order('name'),
      supabase
        .from('advanced_skills')
        .select('*')
        .eq('department_id', departmentId)
        .order('sort_order'),
      supabase
        .from('rank_supervision_rules')
        .select('*')
        .eq('department_id', departmentId)
        .order('sort_order'),
    ]);

    console.log('Locations:', locRes.data?.length || 0, locRes.error);
    console.log('Activities:', activitiesRes.data?.length || 0, activitiesRes.error);
    console.log('Shifts:', shiftsRes.data?.length || 0, shiftsRes.error);
    console.log('Staff:', staffRes.data?.length || 0, staffRes.error);
    console.log('Leave types:', leaveTypesRes.data?.length || 0, leaveTypesRes.error);
    console.log('Department:', departmentRes.data, departmentRes.error);
    console.log('Duty types:', dutyTypesRes.data?.length || 0, dutyTypesRes.error);
    console.log('Phone book entries:', phoneBookRes.data?.length || 0, phoneBookRes.error);
    console.log('Week templates:', weekTemplatesRes.data?.length || 0, weekTemplatesRes.error);
    console.log('Advanced skills:', advancedSkillsRes.data?.length || 0, advancedSkillsRes.error);

    return {
      locations: locRes.data || [],
      activities: activitiesRes.data || [],
      shifts: shiftsRes.data || [],
      staff: staffRes.data || [],
      leaveTypes: leaveTypesRes.data || [],
      department: departmentRes.data || null,
      dutyTypes: dutyTypesRes.data || [],
      phoneBookEntries: phoneBookRes.data || [],
      weekTemplates: weekTemplatesRes.data || [],
      advancedSkills: advancedSkillsRes.data || [],
      staffRanks: staffRanksRes.data || [],
      errors: [locRes.error, activitiesRes.error, shiftsRes.error, staffRes.error, leaveTypesRes.error, departmentRes.error, dutyTypesRes.error, phoneBookRes.error, weekTemplatesRes.error, advancedSkillsRes.error, staffRanksRes.error].filter(Boolean),
    };
  } catch (err) {
    console.error('initializeDepartment error:', err);
    throw err;
  }
}

// ============================================================
// THEATRE ACTIVITIES
// ============================================================

export async function getTheatreActivitiesForDate(departmentId, date) {
  console.log('getTheatreActivitiesForDate called', departmentId, date);
  const dateStr = toLocalDateStr(date);
  
  try {
    const { data, error } = await supabase
      .from('theatre_activities')
      .select('*, locations(name), shifts(name, start_time, end_time, session)')
      .eq('department_id', departmentId)
      .eq('date', dateStr);

    console.log('Theatre activities:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getTheatreActivitiesForDate error:', err);
    return { data: [], error: err };
  }
}

export async function updateTheatreActivity(theatreActivityId, activityId) {
  try {
    const { data, error } = await supabase
      .from('theatre_activities')
      .update({ activity_id: activityId })
      .eq('theatre_activity_id', theatreActivityId);
    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Separate from updateTheatreActivity (which only changes what activity is
// running) since this is the authority for which Morning/Afternoon/Night
// section(s) the card groups under (see getSessionGroups) — editable
// independently of the activity type or its linked shift template.
export async function updateTheatreActivityTimes(theatreActivityId, startTime, endTime) {
  try {
    const { data, error } = await supabase
      .from('theatre_activities')
      .update({ start_time: startTime, end_time: endTime })
      .eq('theatre_activity_id', theatreActivityId);
    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// ============================================================
// STAFF ASSIGNMENTS
// ============================================================

export async function getStaffAssignmentsForDate(departmentId, date) {
  console.log('getStaffAssignmentsForDate called', departmentId, date);
  const dateStr = toLocalDateStr(date);
  
  try {
    const { data, error } = await supabase
      .from('staff_assignments')
      .select('*, staff(name, rank, coffee_order), locations(name), shifts(name, start_time, end_time, session), theatre_activities(activity_id)')
      .eq('department_id', departmentId)
      .eq('date', dateStr);

    console.log('Staff assignments:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getStaffAssignmentsForDate error:', err);
    return { data: [], error: err };
  }
}

export async function createStaffAssignment(departmentId, date, locationId, staffId, shiftId, role, fatigueOverrideReason = null, theatreActivityId = null, onCall = false) {
  const dateStr = toLocalDateStr(date);

  try {
    const { data, error } = await supabase
      .from('staff_assignments')
      .insert([
        {
          department_id: departmentId,
          date: dateStr,
          location_id: locationId,
          staff_id: staffId,
          shift_id: shiftId,
          role,
          fatigue_override_reason: fatigueOverrideReason,
          theatre_activity_id: theatreActivityId,
          on_call: onCall,
        },
      ])
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function updateStaffAssignment(assignmentId, staffId, role, shiftId, fatigueOverrideReason = null, theatreActivityId = null, onCall = false) {
  try {
    const { data, error } = await supabase
      .from('staff_assignments')
      .update({ staff_id: staffId, role, shift_id: shiftId, fatigue_override_reason: fatigueOverrideReason, theatre_activity_id: theatreActivityId, on_call: onCall })
      .eq('assignment_id', assignmentId)
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function deleteStaffAssignment(assignmentId) {
  try {
    const { error } = await supabase
      .from('staff_assignments')
      .delete()
      .eq('assignment_id', assignmentId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

// ============================================================
// DUTY ASSIGNMENTS
// ============================================================

export async function getDutyAssignmentsForDate(departmentId, date) {
  console.log('getDutyAssignmentsForDate called', departmentId, date);
  const dateStr = toLocalDateStr(date);
  
  try {
    const { data, error } = await supabase
      .from('duty_assignments')
      .select('*, staff(name)')
      .eq('department_id', departmentId)
      .eq('date', dateStr);

    console.log('Duty assignments:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getDutyAssignmentsForDate error:', err);
    return { data: [], error: err };
  }
}

export async function updateDutyAssignment(departmentId, date, dutyType, staffId) {
  const dateStr = toLocalDateStr(date);

  try {
    // "Clear Assignment" deletes the row rather than upserting a null
    // staff_id — duty_assignments.staff_id is NOT NULL at the DB level, and
    // "unassigned" is already how an absent row reads everywhere this is
    // consumed (getDutyStaffName / dutyAssignments map), same pattern as a
    // Day Off being the absence of a staff_assignments row elsewhere in
    // this schema.
    if (!staffId) {
      const { error } = await supabase
        .from('duty_assignments')
        .delete()
        .eq('department_id', departmentId)
        .eq('date', dateStr)
        .eq('duty_type', dutyType);

      return { data: null, error };
    }

    // onConflict must target the table's actual unique constraint —
    // (department_id, date, duty_type) as of
    // migrations/2026-08-24_duty_assignments_department_scoped_unique.sql
    // (previously just (date, duty_type), which let two departments
    // sharing a duty type key collide on the same date and silently
    // overwrite each other's row). Without onConflict matching the real
    // constraint, upsert() defaults to the primary key (duty_id, always a
    // fresh UUID), so it attempts a plain INSERT and errors out on the
    // constraint instead of updating the existing row.
    const { data, error } = await supabase
      .from('duty_assignments')
      .upsert(
        [
          {
            department_id: departmentId,
            date: dateStr,
            duty_type: dutyType,
            staff_id: staffId,
          },
        ],
        { onConflict: 'department_id,date,duty_type' }
      )
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// ============================================================
// DUTY TYPES — per-department configuration of which named slots appear in
// the Duty Assignments panel (see migrations/2026-08-22_duty_types.sql).
// The officer view's refData already gets the full list from
// initializeDepartment; getDutyTypes below is for the staff-facing view,
// which doesn't otherwise load department reference data.
// ============================================================

export async function getDutyTypes(departmentId) {
  try {
    const { data, error } = await supabase
      .from('duty_types')
      .select('*')
      .eq('department_id', departmentId)
      .eq('active', true)
      .order('sort_order');

    return { data: data || [], error };
  } catch (err) {
    console.error('getDutyTypes error:', err);
    return { data: [], error: err };
  }
}

// Stable, URL/key-safe slug derived from the label at creation time. Kept
// as duty_types.key forever after — duty_assignments.duty_type rows join
// against it by value, so changing it later would orphan existing
// assignments (same reason shift_id / activity_id are UUIDs, not names).
function slugifyDutyTypeKey(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// The `session` label on an auto-created duty-type shift is just a display
// hint (see shiftSessionUtils.js — actual Morning/Afternoon/Night grouping
// goes entirely by start_time/end_time), so this only needs to be roughly
// right, not authoritative.
function sessionForDutyTimes(startTime, endTime) {
  const groups = getSessionGroups({ start_time: startTime, end_time: endTime });
  if (groups.includes('night')) return 'night';
  if (groups.includes('afternoon')) return 'PM';
  if (groups.includes('morning')) return 'AM';
  return 'full';
}

// Every duty type gets its own activity_types row with a matching name, and
// (once start/end times are set) its own shift — vestigial now that duty
// types no longer project themselves onto Day-view cards (that projection
// was reverted; see the Duty Assignments panel's own on-call summary in
// officer-roster-view-supabase.jsx instead), but harmless to keep and
// still shown in Settings in case that's wanted again later.
export async function createDutyType(departmentId, label, countsAsOnCall, sortOrder, startTime = null, endTime = null, abbreviation = null) {
  try {
    const key = slugifyDutyTypeKey(label);
    if (!key) throw new Error('Duty type name must contain at least one letter or number');

    const { data: activityType, error: activityTypeError } = await createActivityType(departmentId, label.trim());
    if (activityTypeError) throw activityTypeError;

    let shift = null;
    if (startTime && endTime) {
      // " On Call" suffix guarantees this matches the /on.?call/i filter
      // that excludes on-call shifts from the normal assignment picker
      // (see assignableShifts in officer-roster-view-supabase.jsx) even
      // when the duty type's own label doesn't mention "on call" (e.g. a
      // rural roster's bare "ED" / "Obs" / "Anaes" duty types).
      const { data: newShift, error: shiftError } = await createShift(departmentId, `${label.trim()} On Call`, 'weekday', startTime, endTime, sessionForDutyTimes(startTime, endTime));
      if (shiftError) throw shiftError;
      shift = newShift;
    }

    const { data, error } = await supabase
      .from('duty_types')
      .insert([{
        department_id: departmentId,
        key,
        label: label.trim(),
        counts_as_on_call: countsAsOnCall,
        sort_order: sortOrder,
        start_time: startTime,
        end_time: endTime,
        activity_type_id: activityType.activity_id,
        shift_id: shift?.shift_id || null,
        abbreviation: abbreviation?.trim() || null,
      }])
      .select()
      .single();

    return { data, activityType, shift, error };
  } catch (err) {
    return { data: null, activityType: null, shift: null, error: err };
  }
}

// Label/sort_order/counts_as_on_call/times only — key is immutable after
// creation (see slugifyDutyTypeKey). Renames the linked activity_type to
// match when the label changes, same "past-changes-too" caveat as renaming
// a shift or location elsewhere in this file. Creates the linked shift on
// first save of a start/end time (a duty type can be created without
// times and have them added later), or keeps an existing one's times in
// sync; leaves a previously-created shift alone (unused, harmless) if
// times are cleared back out.
export async function updateDutyType(departmentId, dutyTypeId, label, countsAsOnCall, sortOrder, startTime, endTime, activityTypeId, shiftId, abbreviation = null) {
  try {
    const trimmedLabel = label.trim();
    let activityType = null;
    if (activityTypeId) {
      const { data, error } = await updateActivityTypeName(activityTypeId, trimmedLabel);
      if (error) throw error;
      activityType = data;
    }

    let shift = null;
    let nextShiftId = shiftId || null;
    if (startTime && endTime) {
      const session = sessionForDutyTimes(startTime, endTime);
      if (shiftId) {
        const { data: updatedShift, error } = await updateShift(shiftId, `${trimmedLabel} On Call`, 'weekday', startTime, endTime, session);
        if (error) throw error;
        shift = updatedShift;
      } else {
        const { data: newShift, error } = await createShift(departmentId, `${trimmedLabel} On Call`, 'weekday', startTime, endTime, session);
        if (error) throw error;
        shift = newShift;
        nextShiftId = newShift.shift_id;
      }
    }

    const { data, error } = await supabase
      .from('duty_types')
      .update({
        label: trimmedLabel,
        counts_as_on_call: countsAsOnCall,
        sort_order: sortOrder,
        start_time: startTime,
        end_time: endTime,
        shift_id: nextShiftId,
        abbreviation: abbreviation?.trim() || null,
      })
      .eq('duty_type_id', dutyTypeId)
      .select()
      .single();

    return { data, activityType, shift, error };
  } catch (err) {
    return { data: null, activityType: null, shift: null, error: err };
  }
}

// Duty types are never hard-deleted — a duty_assignments history row keyed
// to this type shouldn't lose its label. "Delete" instead sets active =
// false: it drops out of the Duty Assignments panel while past history
// (and its counts_as_on_call contribution to the Fairness Report) is
// unaffected — same pattern as deactivateShift.
export async function deactivateDutyType(dutyTypeId) {
  try {
    const { error } = await supabase
      .from('duty_types')
      .update({ active: false })
      .eq('duty_type_id', dutyTypeId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

export async function reactivateDutyType(dutyTypeId) {
  try {
    const { error } = await supabase
      .from('duty_types')
      .update({ active: true })
      .eq('duty_type_id', dutyTypeId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

// ============================================================
// PHONE BOOK — officer-managed list of important non-staff numbers (e.g.
// the nearest tertiary ED, the on-site ED SMO line, the Nurse Unit
// Manager). See migrations/2026-08-24_phone_book.sql. Shown to everyone in
// the department under the (renamed) Phone Book tab in the staff view,
// below the weekly on-call list; editable only by officers, in Settings.
// ============================================================

export async function getPhoneBookEntries(departmentId) {
  try {
    const { data, error } = await supabase
      .from('phone_book_entries')
      .select('*')
      .eq('department_id', departmentId)
      .eq('active', true)
      .order('sort_order');

    return { data: data || [], error };
  } catch (err) {
    console.error('getPhoneBookEntries error:', err);
    return { data: [], error: err };
  }
}

export async function createPhoneBookEntry(departmentId, label, phone, sortOrder = 0) {
  try {
    const { data, error } = await supabase
      .from('phone_book_entries')
      .insert([{ department_id: departmentId, label: label.trim(), phone: phone.trim(), sort_order: sortOrder }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function updatePhoneBookEntry(phoneBookEntryId, label, phone, sortOrder) {
  try {
    const { data, error } = await supabase
      .from('phone_book_entries')
      .update({ label: label.trim(), phone: phone.trim(), sort_order: sortOrder })
      .eq('phone_book_entry_id', phoneBookEntryId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Hard-deleted, unlike duty types — there's no assignment history keyed to
// a phone book entry that would need its label preserved.
export async function deletePhoneBookEntry(phoneBookEntryId) {
  try {
    const { error } = await supabase
      .from('phone_book_entries')
      .delete()
      .eq('phone_book_entry_id', phoneBookEntryId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

// ============================================================
// SHIFTS
// ============================================================

export async function getShifts(departmentId) {
  console.log('getShifts called', departmentId);
  
  try {
    const { data, error } = await supabase
      .from('shifts')
      .select('*')
      .eq('department_id', departmentId)
      .order('start_time');

    console.log('Shifts:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getShifts error:', err);
    return { data: [], error: err };
  }
}

export async function createShift(departmentId, name, dayType, startTime, endTime, session) {
  try {
    const { data, error } = await supabase
      .from('shifts')
      .insert([{ department_id: departmentId, name, day_type: dayType, start_time: startTime, end_time: endTime, session }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Same past-changes-too caveat as updateLocation/updateActivityTypeName
// — every staff_assignment/theatre_activity referencing this shift_id joins
// the live row, so renaming it rewrites how already-past dates display it.
export async function updateShift(shiftId, name, dayType, startTime, endTime, session) {
  try {
    const { data, error } = await supabase
      .from('shifts')
      .update({ name, day_type: dayType, start_time: startTime, end_time: endTime, session })
      .eq('shift_id', shiftId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Shifts are never hard-deleted — a shift used anywhere (theatre_activities,
// staff_assignments) can't be removed without breaking those references, and
// even an unused one might have history worth keeping. "Delete" instead sets
// active=false: it disappears from pickers offered for new allocation, while
// every existing assignment/activity that already uses it is untouched.
export async function deactivateShift(shiftId) {
  try {
    const { error } = await supabase
      .from('shifts')
      .update({ active: false })
      .eq('shift_id', shiftId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

export async function reactivateShift(shiftId) {
  try {
    const { error } = await supabase
      .from('shifts')
      .update({ active: true })
      .eq('shift_id', shiftId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

// ============================================================
// LOCATIONS
// ============================================================

export async function getLocations(departmentId) {
  console.log('getLocations called', departmentId);
  
  try {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('department_id', departmentId)
      .order('name');

    console.log('Locations:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getLocations error:', err);
    return { data: [], error: err };
  }
}

// defaultStartTime/defaultEndTime are optional (null = "always open", e.g.
// an Emergency Department) — just a convenience pre-fill offered when
// creating a new activity at this location, not an enforced constraint.
export async function createLocation(departmentId, name, defaultStartTime = null, defaultEndTime = null) {
  try {
    const { data, error } = await supabase
      .from('locations')
      .insert([{ department_id: departmentId, name, default_start_time: defaultStartTime, default_end_time: defaultEndTime }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Renames a location and/or updates its default hours in place. Every
// theatre_activity/staff_assignment that references this location_id joins
// the live `locations` row for display, so a rename changes what past dates
// show too — correct for fixing a mislabel, but not the right tool for
// "this location has a new name going forward": deactivate the old one and
// create a new one for that instead.
export async function updateLocation(locationId, name, defaultStartTime = null, defaultEndTime = null) {
  try {
    const { data, error } = await supabase
      .from('locations')
      .update({ name, default_start_time: defaultStartTime, default_end_time: defaultEndTime })
      .eq('location_id', locationId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Narrows which activities can be picked at this location (e.g. a Ward
// location only ever offering "Ward Cover") — see
// migrations/2026-08-23_location_allowed_activities.sql. An empty array
// means no restriction, same as null.
export async function updateLocationAllowedActivities(locationId, activityIds) {
  try {
    const { data, error } = await supabase
      .from('locations')
      .update({ allowed_activity_ids: activityIds })
      .eq('location_id', locationId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Locations are never hard-deleted, for the same reason as shifts — "delete"
// sets active=false so it can no longer be picked for a new activity, while
// existing theatre_activities/staff_assignments there are left completely
// alone.
export async function deactivateLocation(locationId) {
  try {
    const { error } = await supabase
      .from('locations')
      .update({ active: false })
      .eq('location_id', locationId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

export async function reactivateLocation(locationId) {
  try {
    const { error } = await supabase
      .from('locations')
      .update({ active: true })
      .eq('location_id', locationId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

// ============================================================
// ACTIVITY TYPES
// ============================================================

export async function getActivityTypes(departmentId) {
  console.log('getActivityTypes called', departmentId);
  
  try {
    const { data, error } = await supabase
      .from('activity_types')
      .select('*')
      .eq('department_id', departmentId)
      .order('name');

    console.log('Activity types:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getActivityTypes error:', err);
    return { data: [], error: err };
  }
}

export async function createActivityType(departmentId, name, abbreviation = null) {
  try {
    const { data, error } = await supabase
      .from('activity_types')
      .insert([{ department_id: departmentId, name, abbreviation }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Renames an activity type (and/or its abbreviation) in place — same
// past-changes-too caveat as updateLocation: every theatre_activity
// referencing this activity_id joins the live row, so this rewrites how
// already-past dates display it. abbreviation is left untouched
// (undefined) by callers that only care about the name, e.g.
// updateDutyType's rename-to-match-the-duty-type-label call.
export async function updateActivityTypeName(activityId, name, abbreviation) {
  try {
    const { data, error } = await supabase
      .from('activity_types')
      .update({ name, ...(abbreviation !== undefined ? { abbreviation } : {}) })
      .eq('activity_id', activityId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Removes an activity type along with any theatre_activities using it, and
// the staff_assignments tied to those (staff_assignments has no activity_id
// of its own, so affected rows are found via matching date + location_id).
// assignment_history is a permanent audit log, not live roster state — its
// rows are kept but detached (activity_id set to null) rather than deleted.
export async function deleteActivityType(activityId) {
  try {
    const { error: historyError } = await supabase
      .from('assignment_history')
      .update({ activity_id: null })
      .eq('activity_id', activityId);
    if (historyError) throw historyError;

    const { data: affected, error: findError } = await supabase
      .from('theatre_activities')
      .select('department_id, date, location_id')
      .eq('activity_id', activityId);
    if (findError) throw findError;

    for (const ta of affected || []) {
      const { error: assignError } = await supabase
        .from('staff_assignments')
        .delete()
        .eq('department_id', ta.department_id)
        .eq('date', ta.date)
        .eq('location_id', ta.location_id);
      if (assignError) throw assignError;
    }

    const { error: taError } = await supabase
      .from('theatre_activities')
      .delete()
      .eq('activity_id', activityId);
    if (taError) throw taError;

    const { error } = await supabase
      .from('activity_types')
      .delete()
      .eq('activity_id', activityId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

// ============================================================
// SUPERVISION VALIDATION
// ============================================================

export async function validateSupervision(departmentId, date, locationId, shiftId, staffId, rank) {
  console.log('validateSupervision called', { departmentId, date, locationId, shiftId, staffId, rank });

  try {
    const { data, error } = await supabase
      .rpc('validate_supervision', {
        p_department_id: departmentId,
        p_date: toLocalDateStr(date),
        p_location_id: locationId,
        p_shift_id: shiftId,
        p_staff_id: staffId,
        p_staff_rank: rank,
      });

    console.log('Validation result:', data, error);
    if (error) throw error;

    // The RPC returns a set (an array with one row), not a single object.
    const result = Array.isArray(data) ? data[0] : data;
    return result || { is_valid: false, reason: 'Validation check failed' };
  } catch (err) {
    console.error('validateSupervision error:', err);
    return { is_valid: false, reason: 'Validation error: ' + err.message };
  }
}

// ============================================================
// UTILITY
// ============================================================

export async function copyLastWeekActivities(departmentId, fromDate) {
  try {
    const { data, error } = await supabase
      .rpc('copy_week_activities', {
        p_department_id: departmentId,
        p_from_date: toLocalDateStr(fromDate),
      });

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}
// ============================================================
// STAFF MANAGEMENT
// ============================================================

export async function getStaffList(departmentId) {
  console.log('getStaffList called', departmentId);

  try {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('department_id', departmentId)
      .order('name');

    return { data: data || [], error };
  } catch (err) {
    console.error('getStaffList error:', err);
    return { data: [], error: err };
  }
}

export async function createStaff(departmentId, name, rank, phone) {
  console.log('createStaff called', departmentId, name, rank, phone);

  try {
    const { data, error } = await supabase
      .from('staff')
      .insert([{ department_id: departmentId, name, rank, phone: phone || null }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    console.error('createStaff error:', err);
    return { data: null, error: err };
  }
}

// Staff are never hard-deleted — their assignment/duty/availability history
// (and the permanent assignment_history audit log) stays intact untouched.
// "Delete" sets active=false: they disappear from staff-selection dropdowns
// and case-mix/fairness calculations used for new allocation, but every
// existing assignment they're already on is left exactly as it was.
export async function deactivateStaff(staffId) {
  console.log('deactivateStaff called', staffId);

  try {
    const { error } = await supabase
      .from('staff')
      .update({ active: false })
      .eq('staff_id', staffId);

    return { error };
  } catch (err) {
    console.error('deactivateStaff error:', err);
    return { error: err };
  }
}

export async function reactivateStaff(staffId) {
  console.log('reactivateStaff called', staffId);

  try {
    const { error } = await supabase
      .from('staff')
      .update({ active: true })
      .eq('staff_id', staffId);

    return { error };
  } catch (err) {
    console.error('reactivateStaff error:', err);
    return { error: err };
  }
}

// ============================================================
// STAFF VIEW - QUERIES
// ============================================================

export async function getStaffById(staffId) {
  console.log('getStaffById called', staffId);
  
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('staff_id', staffId)
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function getStaffAssignmentsForStaffDate(staffId, date) {
  console.log('getStaffAssignmentsForStaffDate called', staffId, date);
  const dateStr = toLocalDateStr(date);
  
  try {
    const { data, error } = await supabase
      .from('staff_assignments')
      .select('*, locations(name), shifts(name, start_time, end_time, session), theatre_activities(activity_id)')
      .eq('staff_id', staffId)
      .eq('date', dateStr);

    console.log('Staff assignments for date:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getStaffAssignmentsForStaffDate error:', err);
    return { data: [], error: err };
  }
}

export async function getStaffAssignmentsForWeek(staffId, weekStartDate) {
  console.log('getStaffAssignmentsForWeek called', staffId, weekStartDate);
  const startStr = toLocalDateStr(weekStartDate);
  const endDate = new Date(weekStartDate);
  endDate.setDate(endDate.getDate() + 6);
  const endStr = toLocalDateStr(endDate);
  
  try {
    const { data, error } = await supabase
      .from('staff_assignments')
      .select('*, locations(name), shifts(name, start_time, end_time, session)')
      .eq('staff_id', staffId)
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date');

    console.log('Staff assignments for week:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getStaffAssignmentsForWeek error:', err);
    return { data: [], error: err };
  }
}

// Same week of assignments as getStaffAssignmentsForWeek, but with each row
// annotated with `activity_name` — staff_assignments has no activity_id of
// its own, so it's resolved by matching date + location_id against
// theatre_activities, the same join used for case-mix exposure elsewhere.
export async function getStaffWeekScheduleForExport(staffId, departmentId, weekStartDate) {
  console.log('getStaffWeekScheduleForExport called', staffId, departmentId, weekStartDate);
  const startStr = toLocalDateStr(weekStartDate);
  const endDate = new Date(weekStartDate);
  endDate.setDate(endDate.getDate() + 6);
  const endStr = toLocalDateStr(endDate);

  try {
    const [assignRes, theatreRes] = await Promise.all([
      supabase
        .from('staff_assignments')
        .select('*, locations(name), shifts(name, start_time, end_time, session)')
        .eq('staff_id', staffId)
        .gte('date', startStr)
        .lte('date', endStr)
        .order('date'),
      supabase
        .from('theatre_activities')
        .select('date, location_id, activity_types(name)')
        .eq('department_id', departmentId)
        .gte('date', startStr)
        .lte('date', endStr),
    ]);

    if (assignRes.error) throw assignRes.error;
    if (theatreRes.error) throw theatreRes.error;

    const activityByKey = new Map();
    (theatreRes.data || []).forEach(ta => {
      activityByKey.set(`${ta.date}|${ta.location_id}`, ta.activity_types?.name || null);
    });

    const enriched = (assignRes.data || []).map(a => ({
      ...a,
      activity_name: activityByKey.get(`${a.date}|${a.location_id}`) || null,
    }));

    return { data: enriched, error: null };
  } catch (err) {
    console.error('getStaffWeekScheduleForExport error:', err);
    return { data: [], error: err };
  }
}

export async function getAllOnCallAssignmentsForWeek(departmentId, weekStartDate) {
  console.log('getAllOnCallAssignmentsForWeek called', departmentId, weekStartDate);
  const startStr = toLocalDateStr(weekStartDate);
  const endDate = new Date(weekStartDate);
  endDate.setDate(endDate.getDate() + 6);
  const endStr = toLocalDateStr(endDate);
  
  try {
    const { data, error } = await supabase
      .from('duty_assignments')
      .select('*, staff(name, phone)')
      .eq('department_id', departmentId)
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date');

    console.log('On-call assignments for week:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getAllOnCallAssignmentsForWeek error:', err);
    return { data: [], error: err };
  }
}

export async function searchStaff(departmentId, query) {
  console.log('searchStaff called', departmentId, query);
  
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('department_id', departmentId)
      .eq('active', true)
      .ilike('name', `%${query}%`)
      .order('name');

    console.log('Search results:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('searchStaff error:', err);
    return { data: [], error: err };
  }
}

// ============================================================
// TEST DATA - POPULATE NEXT WEEK RANDOMLY
// ============================================================

export async function populateNextWeekRandom(departmentId) {
  console.log('Populating next week randomly...');
  
  try {
    // Get next week's date range
    const today = new Date();
    const nextWeekStart = new Date(today);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7 - nextWeekStart.getDay()); // Next Sunday
    
    const startStr = toLocalDateStr(nextWeekStart);
    const endDate = new Date(nextWeekStart);
    endDate.setDate(endDate.getDate() + 6);
    const endStr = toLocalDateStr(endDate);

    // Get theatre activities for next week
    const { data: activities, error: activitiesError } = await supabase
      .from('theatre_activities')
      .select('*')
      .eq('department_id', departmentId)
      .gte('date', startStr)
      .lte('date', endStr);

    if (activitiesError) throw activitiesError;

    // Get all staff
    const { data: staffList, error: staffError } = await supabase
      .from('staff')
      .select('*')
      .eq('department_id', departmentId);

    if (staffError) throw staffError;

    // Filter by rank
    const consultants = staffList.filter(s => s.rank === 'consultant' || s.rank === 'fellow');
    const registrars = staffList.filter(s => s.rank.includes('trainee') || s.rank === 'intern');

    if (consultants.length === 0 || registrars.length === 0) {
      throw new Error('Not enough staff to populate');
    }

    // Create assignments for each activity
    const assignments = [];
    for (const activity of activities) {
      const consultant = consultants[Math.floor(Math.random() * consultants.length)];
      const registrar = registrars[Math.floor(Math.random() * registrars.length)];

      assignments.push({
        department_id: departmentId,
        date: activity.date,
        location_id: activity.location_id,
        staff_id: consultant.staff_id,
        shift_id: activity.shift_id,
        role: 'consultant',
      });

      assignments.push({
        department_id: departmentId,
        date: activity.date,
        location_id: activity.location_id,
        staff_id: registrar.staff_id,
        shift_id: activity.shift_id,
        role: 'registrar',
      });
    }

    // Insert all assignments
    if (assignments.length > 0) {
      const { error: insertError } = await supabase
        .from('staff_assignments')
        .insert(assignments);

      if (insertError) throw insertError;
    }

    return { success: true, count: assignments.length };
  } catch (err) {
    console.error('populateNextWeekRandom error:', err);
    return { success: false, error: err.message };
  }
}

// ============================================================
// ACTIVITY RESTRICTIONS
// ============================================================

export async function updateStaffActivityRestrictions(staffId, activityIds) {
  console.log('updateStaffActivityRestrictions called', staffId, activityIds);
  
  try {
    const { data, error } = await supabase
      .from('staff')
      .update({ activity_restrictions: activityIds })
      .eq('staff_id', staffId)
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function getStaffActivityMatrix(departmentId) {
  console.log('getStaffActivityMatrix called', departmentId);
  
  try {
    const { data: staff, error: staffError } = await supabase
      .from('staff')
      .select('staff_id, name, rank, activity_restrictions, email, coffee_order')
      .eq('department_id', departmentId)
      .eq('active', true)
      .order('name');

    const { data: activities, error: activitiesError } = await supabase
      .from('activity_types')
      .select('activity_id, name')
      .eq('department_id', departmentId)
      .order('name');

    if (staffError) throw staffError;
    if (activitiesError) throw activitiesError;

    return { staff: staff || [], activities: activities || [], error: null };
  } catch (err) {
    return { staff: [], activities: [], error: err };
  }
}

export async function createTheatreActivity(departmentId, date, locationId, shiftId, activityId, startTime, endTime) {
  console.log('createTheatreActivity called', { departmentId, date, locationId, shiftId, activityId, startTime, endTime });

  try {
    const dateStr = toLocalDateStr(date);
    const { data, error } = await supabase
      .from('theatre_activities')
      .insert([{
        department_id: departmentId,
        date: dateStr,
        location_id: locationId,
        shift_id: shiftId,
        activity_id: activityId,
        start_time: startTime,
        end_time: endTime,
      }])
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Removes an activity for a day, along with any staff assigned to it
// (their shifts are chosen per-assignment, not tied to the activity row, so
// they'd otherwise be orphaned once the activity is gone). Scoped to this
// theatre_activity_id specifically — a location can have more than one
// activity on the same day (e.g. a Day activity and a separate Night
// activity), each with its own staff, so deleting one must not touch the
// other's assignments.
export async function deleteTheatreActivity(theatreActivityId, departmentId, date, locationId) {
  console.log('deleteTheatreActivity called', { theatreActivityId, departmentId, date, locationId });

  try {
    const { error: assignmentsError } = await supabase
      .from('staff_assignments')
      .delete()
      .eq('theatre_activity_id', theatreActivityId);

    if (assignmentsError) throw assignmentsError;

    const { error } = await supabase
      .from('theatre_activities')
      .delete()
      .eq('theatre_activity_id', theatreActivityId);

    return { error };
  } catch (err) {
    console.error('deleteTheatreActivity error:', err);
    return { error: err };
  }
}

// ============================================================
// STAFF AVAILABILITY
// ============================================================

export async function getStaffAvailability(departmentId, weekStartDate) {
  console.log('getStaffAvailability called', departmentId, weekStartDate);
  const startStr = toLocalDateStr(weekStartDate);
  const endDate = new Date(weekStartDate);
  endDate.setDate(endDate.getDate() + 6);
  const endStr = toLocalDateStr(endDate);

  try {
    const { data: staffList, error: staffError } = await supabase
      .from('staff')
      .select('staff_id')
      .eq('department_id', departmentId);

    if (staffError) throw staffError;

    const staffIds = (staffList || []).map(s => s.staff_id);
    if (staffIds.length === 0) return { data: [], error: null };

    const { data, error } = await supabase
      .from('staff_availability')
      .select('*')
      .in('staff_id', staffIds)
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date');

    console.log('Staff availability:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getStaffAvailability error:', err);
    return { data: [], error: err };
  }
}

// `available`: true = mark available, false = mark unavailable, null = clear
// back to the neutral "unset" state (removes the record entirely).
export async function toggleStaffAvailability(departmentId, staffId, date, available) {
  console.log('toggleStaffAvailability called', departmentId, staffId, date, available);
  const dateStr = toLocalDateStr(date);

  try {
    if (available === null) {
      const { error } = await supabase
        .from('staff_availability')
        .delete()
        .eq('staff_id', staffId)
        .eq('date', dateStr);

      console.log('Cleared availability result:', error);
      return { data: null, error };
    }

    const { data, error } = await supabase
      .from('staff_availability')
      .upsert([{ department_id: departmentId, staff_id: staffId, date: dateStr, available }], { onConflict: 'staff_id,date' })
      .select();

    console.log('Toggle availability result:', data, error);
    return { data, error };
  } catch (err) {
    console.error('toggleStaffAvailability error:', err);
    return { data: null, error: err };
  }
}

// Writes the same available/unavailable value across many dates in one
// round trip — used to "materialize" recurring rules (standing day off,
// fortnightly off-weeks, leave blocks) as ordinary availability records.
// `leaveTypeId` is optional and left out of the payload entirely by default
// — omitting a column from a Postgres upsert leaves it untouched on an
// existing row, so callers that don't care about leave type (standing days
// off, fortnightly pattern, weekdays/all-month bulk actions) never
// clobber whatever leave type a day already had. Pass it explicitly
// (including `null`, to clear it) when the caller does care.
export async function bulkSetStaffAvailability(departmentId, staffId, dates, available, leaveTypeId) {
  console.log('bulkSetStaffAvailability called', departmentId, staffId, dates.length, available, leaveTypeId);
  if (!dates.length) return { data: [], error: null };

  try {
    const rows = dates.map(date => ({
      department_id: departmentId,
      staff_id: staffId,
      date: toLocalDateStr(date),
      available,
      ...(leaveTypeId !== undefined ? { leave_type_id: leaveTypeId } : {}),
    }));

    const { data, error } = await supabase
      .from('staff_availability')
      .upsert(rows, { onConflict: 'staff_id,date' })
      .select();

    return { data, error };
  } catch (err) {
    console.error('bulkSetStaffAvailability error:', err);
    return { data: null, error: err };
  }
}

// Removes unavailable (false) records in a date range — used to undo
// recurring rules / leave blocks. Deliberately leaves explicit "available"
// (true) records alone, since those are the staff member's own confirmations.
export async function clearStaffUnavailabilityRange(staffId, startDate, endDate) {
  console.log('clearStaffUnavailabilityRange called', staffId, startDate, endDate);

  try {
    const startStr = toLocalDateStr(startDate);
    const endStr = toLocalDateStr(endDate);

    const { error } = await supabase
      .from('staff_availability')
      .delete()
      .eq('staff_id', staffId)
      .eq('available', false)
      .gte('date', startStr)
      .lte('date', endStr);

    return { error };
  } catch (err) {
    console.error('clearStaffUnavailabilityRange error:', err);
    return { error: err };
  }
}

// Returns staff for the department annotated with `availability_status`
// ('available' | 'unavailable' | 'unset') for the given date, plus `data`
// containing only the staff explicitly confirmed available — an unset day
// (no record) is not treated as available, since it hasn't been confirmed.
export async function getStaffAvailabilityForDate(departmentId, date) {
  console.log('getStaffAvailabilityForDate called', departmentId, date);
  const dateStr = toLocalDateStr(date);

  try {
    const [staffRes, availRes] = await Promise.all([
      supabase
        .from('staff')
        .select('*')
        .eq('department_id', departmentId)
        .order('name'),
      supabase
        .from('staff_availability')
        .select('staff_id, available')
        .eq('date', dateStr),
    ]);

    if (staffRes.error) throw staffRes.error;
    if (availRes.error) throw availRes.error;

    const statusByStaff = new Map();
    (availRes.data || []).forEach(r => {
      statusByStaff.set(r.staff_id, r.available ? 'available' : 'unavailable');
    });

    const allStaff = (staffRes.data || []).map(s => ({
      ...s,
      availability_status: statusByStaff.get(s.staff_id) || 'unset',
    }));

    const availableStaff = allStaff.filter(s => s.availability_status === 'available');

    console.log('Available staff for date:', availableStaff.length, 'of', allStaff.length);
    return { data: availableStaff, allStaff, error: null };
  } catch (err) {
    console.error('getStaffAvailabilityForDate error:', err);
    return { data: [], allStaff: [], error: err };
  }
}

// ============================================================
// STAFF FTE
// ============================================================

// Corrects a misspelled staff name in place — every staff_assignments/
// duty_assignments/theatre_activities row referencing this staff_id joins
// the live row, so this rewrites how already-past dates display it, same
// past-changes-too caveat as renaming a shift/location/activity.
export async function updateStaffName(staffId, name) {
  console.log('updateStaffName called', staffId, name);

  try {
    const { data, error } = await supabase
      .from('staff')
      .update({ name })
      .eq('staff_id', staffId)
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Staff vs Officer vs Intern (see migrations/2026-08-22_staff_role_intern.sql)
// — decides whether App.js offers the officer roster view at all. Only
// ever set at invite time until now; this lets it be changed afterwards
// too, e.g. promoting someone to officer once they're already linked.
export async function updateStaffRole(staffId, role) {
  console.log('updateStaffRole called', staffId, role);

  try {
    const { data, error } = await supabase
      .from('staff')
      .update({ role })
      .eq('staff_id', staffId)
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function updateStaffEmail(staffId, email) {
  console.log('updateStaffEmail called', staffId, email);

  try {
    const { data, error } = await supabase
      .from('staff')
      .update({ email: email || null })
      .eq('staff_id', staffId)
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function updateStaffPhone(staffId, phone) {
  console.log('updateStaffPhone called', staffId, phone);

  try {
    const { data, error } = await supabase
      .from('staff')
      .update({ phone: phone || null })
      .eq('staff_id', staffId)
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function updateStaffCoffeeOrder(staffId, coffeeOrder) {
  console.log('updateStaffCoffeeOrder called', staffId, coffeeOrder);

  try {
    const { data, error } = await supabase
      .from('staff')
      .update({ coffee_order: coffeeOrder || null })
      .eq('staff_id', staffId)
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function updateStaffFTE(staffId, fte) {
  console.log('updateStaffFTE called', staffId, fte);

  try {
    const { data, error } = await supabase
      .from('staff')
      .update({ fte })
      .eq('staff_id', staffId)
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Rank (consultant/fellow/advanced_trainee/basic_trainee/intern — see
// migrations/2026-08-22_staff_rank_intern.sql) was previously only ever
// set once, at invite time. This lets an officer correct it afterwards —
// it drives consultant/registrar-role derivation and the ranked-options
// dropdowns everywhere a staff member gets assigned, so a wrong rank
// (e.g. an Intern showing as a Registrar) had no fix short of the database.
export async function updateStaffRank(staffId, rank) {
  console.log('updateStaffRank called', staffId, rank);

  try {
    const { data, error } = await supabase
      .from('staff')
      .update({ rank })
      .eq('staff_id', staffId)
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// ============================================================
// STAFF RANKS (per-department rank list)
// ============================================================
// Built on rank_supervision_rules (department_id, rank, requires_supervision,
// max_per_consultant, can_share_supervisor — pre-existing, used by the
// validate_supervision DB function) rather than a new table — see
// migrations/2026-08-31_staff_ranks.sql. staff.rank stays free text,
// validated against this table by a composite FK on (department_id, rank);
// renaming a row here cascades to every staff member holding it (ON UPDATE
// CASCADE), deleting one is blocked by the DB while anyone still holds it.
//
// max_per_consultant/can_share_supervisor aren't exposed in the Ranks
// Settings UI (only requires_supervision and ordering are) — a new rank
// gets conservative defaults (1, no sharing) and can be tuned further via
// SQL if finer supervision-capacity control is needed later.

export async function getStaffRanks(departmentId) {
  try {
    const { data, error } = await supabase
      .from('rank_supervision_rules')
      .select('*')
      .eq('department_id', departmentId)
      .order('sort_order');

    return { data: data || [], error };
  } catch (err) {
    console.error('getStaffRanks error:', err);
    return { data: [], error: err };
  }
}

export async function createStaffRank(departmentId, name, requiresSupervision) {
  try {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Rank name is required');

    const { data: existing, error: existingError } = await supabase
      .from('rank_supervision_rules')
      .select('sort_order')
      .eq('department_id', departmentId)
      .order('sort_order', { ascending: false })
      .limit(1);
    if (existingError) throw existingError;

    const nextSortOrder = existing.length > 0 ? existing[0].sort_order + 1 : 0;

    const { data, error } = await supabase
      .from('rank_supervision_rules')
      .insert([{
        department_id: departmentId,
        rank: trimmed,
        sort_order: nextSortOrder,
        requires_supervision: !!requiresSupervision,
        max_per_consultant: requiresSupervision ? 1 : null,
        can_share_supervisor: false,
      }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Renaming cascades to every staff.rank holding the old name — see the
// composite FK's ON UPDATE CASCADE in migrations/2026-08-31_staff_ranks.sql.
export async function renameStaffRank(ruleId, name) {
  try {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Rank name is required');

    const { data, error } = await supabase
      .from('rank_supervision_rules')
      .update({ rank: trimmed })
      .eq('rule_id', ruleId)
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function setStaffRankSupervision(ruleId, requiresSupervision) {
  try {
    const { data, error } = await supabase
      .from('rank_supervision_rules')
      .update({ requires_supervision: !!requiresSupervision })
      .eq('rule_id', ruleId)
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Persists a full reordering — orderedRuleIds is every rule_id for this
// department in its new display order.
export async function reorderStaffRanks(orderedRuleIds) {
  try {
    await Promise.all(orderedRuleIds.map((ruleId, index) =>
      supabase.from('rank_supervision_rules').update({ sort_order: index }).eq('rule_id', ruleId)
    ));
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

// Blocked by the DB (staff.rank's composite FK has no ON DELETE CASCADE)
// while any staff member still holds this rank — surfaced here as a plain
// message rather than a raw Postgres foreign-key-violation error.
export async function deleteStaffRank(ruleId) {
  try {
    const { error } = await supabase
      .from('rank_supervision_rules')
      .delete()
      .eq('rule_id', ruleId);

    if (error) {
      if (error.code === '23503') {
        return { error: new Error('This rank is still assigned to at least one staff member — reassign them first.') };
      }
      throw error;
    }
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

// ============================================================
// CASE MIX / ACTIVITY EXPOSURE
// ============================================================

// Shared 12-month rolling lookup: staff assignments joined to the activity
// they were worked against (staff_assignments has no activity_id of its own —
// it's derived by matching date + location_id + shift_id against theatre_activities).
async function getCaseMixRawData(departmentId, asOfDate) {
  const endDate = asOfDate ? new Date(asOfDate) : new Date();
  const endStr = toLocalDateStr(endDate);
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - 1);
  const startStr = toLocalDateStr(startDate);

  const [staffRes, activitiesRes, assignmentsRes, theatreRes] = await Promise.all([
    supabase
      .from('staff')
      .select('*')
      .eq('department_id', departmentId)
      .eq('active', true)
      .order('name'),
    supabase
      .from('activity_types')
      .select('activity_id, name')
      .eq('department_id', departmentId)
      .order('name'),
    supabase
      .from('staff_assignments')
      .select('staff_id, date, location_id')
      .eq('department_id', departmentId)
      .gte('date', startStr)
      .lte('date', endStr),
    supabase
      .from('theatre_activities')
      .select('date, location_id, activity_id')
      .eq('department_id', departmentId)
      .gte('date', startStr)
      .lte('date', endStr),
  ]);

  if (staffRes.error) throw staffRes.error;
  if (activitiesRes.error) throw activitiesRes.error;
  if (assignmentsRes.error) throw assignmentsRes.error;
  if (theatreRes.error) throw theatreRes.error;

  // Keyed by date + location only (not shift_id): each staff member now picks
  // their own shift (Whole Day / Half Day / Night) independently of the
  // theatre activity's own nominal shift_id, so matching on shift_id here
  // would silently miss any assignment that isn't on the activity's default
  // shift — which is now the common case, not the exception.
  const activityByKey = new Map();
  (theatreRes.data || []).forEach(ta => {
    activityByKey.set(`${ta.date}|${ta.location_id}`, ta.activity_id);
  });

  const totalShiftsByStaff = new Map();
  const statsByStaffActivity = new Map(); // `${staff_id}|${activity_id}` -> { count, lastDate }

  (assignmentsRes.data || []).forEach(a => {
    totalShiftsByStaff.set(a.staff_id, (totalShiftsByStaff.get(a.staff_id) || 0) + 1);

    const activityId = activityByKey.get(`${a.date}|${a.location_id}`);
    if (!activityId) return;

    const key = `${a.staff_id}|${activityId}`;
    const existing = statsByStaffActivity.get(key);
    if (existing) {
      existing.count += 1;
      if (a.date > existing.lastDate) existing.lastDate = a.date;
    } else {
      statsByStaffActivity.set(key, { count: 1, lastDate: a.date });
    }
  });

  return {
    staffList: staffRes.data || [],
    activityList: activitiesRes.data || [],
    totalShiftsByStaff,
    statsByStaffActivity,
  };
}

function computeExposureRate(timesWorked, totalShifts) {
  if (!totalShifts) return 0;
  return Math.round((timesWorked / totalShifts) * 1000) / 10; // 1 decimal place
}

export async function getCaseMixReport(departmentId) {
  console.log('getCaseMixReport called', departmentId);

  try {
    const { staffList, activityList, totalShiftsByStaff, statsByStaffActivity } =
      await getCaseMixRawData(departmentId, new Date());

    const report = [];
    staffList.forEach(staff => {
      const totalShifts = totalShiftsByStaff.get(staff.staff_id) || 0;
      activityList.forEach(activity => {
        const stats = statsByStaffActivity.get(`${staff.staff_id}|${activity.activity_id}`);
        const timesWorked = stats ? stats.count : 0;

        report.push({
          staff_id: staff.staff_id,
          staff_name: staff.name,
          activity_id: activity.activity_id,
          activity_name: activity.name,
          exposure_rate: computeExposureRate(timesWorked, totalShifts),
          last_worked_date: stats ? stats.lastDate : null,
        });
      });
    });

    console.log('Case mix report rows:', report.length);
    return { data: report, error: null };
  } catch (err) {
    console.error('getCaseMixReport error:', err);
    return { data: [], error: err };
  }
}

export async function getSortedStaffForActivity(departmentId, activityId, date) {
  console.log('getSortedStaffForActivity called', departmentId, activityId, date);

  try {
    const { staffList, totalShiftsByStaff, statsByStaffActivity } =
      await getCaseMixRawData(departmentId, date);

    const enriched = staffList.map(staff => {
      const totalShifts = totalShiftsByStaff.get(staff.staff_id) || 0;
      const stats = statsByStaffActivity.get(`${staff.staff_id}|${activityId}`);
      const timesWorked = stats ? stats.count : 0;

      return {
        ...staff,
        exposure_rate: computeExposureRate(timesWorked, totalShifts),
        last_worked_date: stats ? stats.lastDate : null,
      };
    });

    // Lowest exposure first (needs experience); ties broken by oldest last-worked date first.
    // Staff who have never worked the activity (null date) rank as "oldest" and sort first.
    enriched.sort((a, b) => {
      if (a.exposure_rate !== b.exposure_rate) return a.exposure_rate - b.exposure_rate;
      const aDate = a.last_worked_date || '0000-00-00';
      const bDate = b.last_worked_date || '0000-00-00';
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
    });

    return { data: enriched, error: null };
  } catch (err) {
    console.error('getSortedStaffForActivity error:', err);
    return { data: [], error: err };
  }
}

// ============================================================
// ON-CALL / WEEKEND FAIRNESS
// ============================================================

// For each staff member (12-month rolling window), how many weekend shifts
// and on-call duties they've done, compared to their "fair share" — their
// FTE as a fraction of total department FTE. Lets an officer see if one
// person is carrying more nights/weekends than their FTE would suggest.
export async function getFairnessReport(departmentId) {
  console.log('getFairnessReport called', departmentId);

  try {
    const endDate = new Date();
    const endStr = toLocalDateStr(endDate);
    const startDate = new Date(endDate);
    startDate.setFullYear(startDate.getFullYear() - 1);
    const startStr = toLocalDateStr(startDate);

    const [staffRes, assignmentsRes, dutyRes, dutyTypesRes] = await Promise.all([
      supabase
        .from('staff')
        .select('staff_id, name, fte')
        .eq('department_id', departmentId)
        .eq('active', true)
        .order('name'),
      supabase
        .from('staff_assignments')
        .select('staff_id, date')
        .eq('department_id', departmentId)
        .gte('date', startStr)
        .lte('date', endStr),
      supabase
        .from('duty_assignments')
        .select('staff_id, date, duty_type')
        .eq('department_id', departmentId)
        .gte('date', startStr)
        .lte('date', endStr),
      supabase
        .from('duty_types')
        .select('key')
        .eq('department_id', departmentId)
        .eq('counts_as_on_call', true),
    ]);

    if (staffRes.error) throw staffRes.error;
    if (assignmentsRes.error) throw assignmentsRes.error;
    if (dutyRes.error) throw dutyRes.error;
    if (dutyTypesRes.error) throw dutyTypesRes.error;

    const staffList = staffRes.data || [];
    // Which duty types count as "on call" is department-configurable (see
    // migrations/2026-08-22_duty_types.sql) rather than the fixed
    // first_on_call/second_on_call pair this used to hardcode.
    const onCallKeys = new Set((dutyTypesRes.data || []).map(d => d.key));
    const onCallDuties = (dutyRes.data || []).filter(d => onCallKeys.has(d.duty_type));

    const totalShiftsByStaff = new Map();
    const weekendShiftsByStaff = new Map();
    (assignmentsRes.data || []).forEach(a => {
      totalShiftsByStaff.set(a.staff_id, (totalShiftsByStaff.get(a.staff_id) || 0) + 1);
      const dayOfWeek = new Date(`${a.date}T00:00:00`).getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        weekendShiftsByStaff.set(a.staff_id, (weekendShiftsByStaff.get(a.staff_id) || 0) + 1);
      }
    });

    const onCallShiftsByStaff = new Map();
    onCallDuties.forEach(d => {
      onCallShiftsByStaff.set(d.staff_id, (onCallShiftsByStaff.get(d.staff_id) || 0) + 1);
    });

    const totalWeekendShifts = Array.from(weekendShiftsByStaff.values()).reduce((sum, n) => sum + n, 0);
    const totalOnCallShifts = onCallDuties.length;
    const totalFte = staffList.reduce((sum, s) => sum + (s.fte ?? DEFAULT_FTE), 0);

    const report = staffList.map(staff => {
      const fte = staff.fte ?? DEFAULT_FTE;
      const weekendShifts = weekendShiftsByStaff.get(staff.staff_id) || 0;
      const onCallShifts = onCallShiftsByStaff.get(staff.staff_id) || 0;

      return {
        staff_id: staff.staff_id,
        staff_name: staff.name,
        fte,
        total_shifts: totalShiftsByStaff.get(staff.staff_id) || 0,
        weekend_shifts: weekendShifts,
        weekend_fairness_ratio: computeFairnessRatio(weekendShifts, totalWeekendShifts, fte, totalFte),
        oncall_shifts: onCallShifts,
        oncall_fairness_ratio: computeFairnessRatio(onCallShifts, totalOnCallShifts, fte, totalFte),
      };
    });

    console.log('Fairness report rows:', report.length);
    return { data: report, error: null };
  } catch (err) {
    console.error('getFairnessReport error:', err);
    return { data: [], error: err };
  }
}

// ============================================================
// FATIGUE / SHIFT-SEQUENCING CONSTRAINTS
// ============================================================

const NIGHT_LOOKBACK_DAYS = 7; // far enough back to find the last night shift before a cooldown check

// For a date being rostered, works out per-staff fatigue constraints based
// on what they worked the days before. Both of the first two only count a
// genuine in-person night shift (on_call = false) — an on_call night is
// deliberately excluded, so a routine Day / Night on-call / Day / Night
// on-call rotation isn't treated as fatiguing the same way back-to-back
// in-person nights are:
//  - postNightRestStaffIds: worked an in-person Night-session shift the
//    day before — rest day, blocked from (overridable) assignment and
//    excluded outright from on-call duty options on `date`.
//  - nightCooldownStaffIds: two days out from their last in-person night
//    shift — the mandatory rest day has passed, but they still can't go
//    back onto a Day shift for one more day (Night shifts are unaffected).
//  - fatigueRiskStaffIds: was on a duty type marked counts_as_on_call
//    overnight the day before — not blocked, just flagged as a fatigue
//    risk when assigned.
export async function getStaffFatigueStatus(departmentId, date) {
  console.log('getStaffFatigueStatus called', departmentId, date);

  const empty = { postNightRestStaffIds: new Set(), nightCooldownStaffIds: new Set(), fatigueRiskStaffIds: new Set() };

  try {
    const dateStr = toLocalDateStr(date);
    const lookbackStart = new Date(date);
    lookbackStart.setDate(lookbackStart.getDate() - NIGHT_LOOKBACK_DAYS);
    const lookbackStartStr = toLocalDateStr(lookbackStart);
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toLocalDateStr(yesterday);

    const [assignmentsRes, dutyRes, dutyTypesRes] = await Promise.all([
      supabase
        .from('staff_assignments')
        .select('staff_id, date, on_call, shifts(session)')
        .eq('department_id', departmentId)
        .gte('date', lookbackStartStr)
        .lt('date', dateStr),
      supabase
        .from('duty_assignments')
        .select('staff_id, duty_type')
        .eq('department_id', departmentId)
        .eq('date', yesterdayStr),
      supabase
        .from('duty_types')
        .select('key')
        .eq('department_id', departmentId)
        .eq('counts_as_on_call', true),
    ]);

    if (assignmentsRes.error) throw assignmentsRes.error;
    if (dutyRes.error) throw dutyRes.error;
    if (dutyTypesRes.error) throw dutyTypesRes.error;

    // on_call rows are deliberately excluded here — being reachable
    // overnight but not physically present isn't the same fatigue load as
    // an in-person night shift, so it shouldn't trigger the mandatory
    // rest day / day-shift cooldown below (this previously blocked, or
    // silently excluded from the on-call dropdown, a routine Day / Night
    // on-call / Day / Night on-call rotation). A genuine back-to-back
    // in-person night shift (on_call = false) still counts.
    const lastNightDateByStaff = new Map();
    (assignmentsRes.data || []).forEach(a => {
      if (a.shifts?.session !== 'night' || a.on_call) return;
      const existing = lastNightDateByStaff.get(a.staff_id);
      if (!existing || a.date > existing) {
        lastNightDateByStaff.set(a.staff_id, a.date);
      }
    });

    const postNightRestStaffIds = new Set();
    const nightCooldownStaffIds = new Set();
    lastNightDateByStaff.forEach((lastNightStr, staffId) => {
      const daysSince = Math.round((date - new Date(`${lastNightStr}T00:00:00`)) / (1000 * 60 * 60 * 24));
      if (daysSince === 1) postNightRestStaffIds.add(staffId);
      else if (daysSince === 2) nightCooldownStaffIds.add(staffId);
    });

    const onCallKeys = new Set((dutyTypesRes.data || []).map(d => d.key));
    const fatigueRiskStaffIds = new Set(
      (dutyRes.data || [])
        .filter(d => onCallKeys.has(d.duty_type))
        .map(d => d.staff_id)
    );

    return { data: { postNightRestStaffIds, nightCooldownStaffIds, fatigueRiskStaffIds }, error: null };
  } catch (err) {
    console.error('getStaffFatigueStatus error:', err);
    return { data: empty, error: err };
  }
}

// ============================================================
// WEEK TEMPLATES — see migrations/2026-08-25_week_templates.sql. A
// department-configured "what has to happen every week" skeleton
// (locations + activities per day-of-week, no staff), set up in Settings
// and applied to a specific Monday-start week from the Calendar. Applying
// creates the real (empty) theatre_activities cards for that week — see
// applyWeekTemplate — so Day view, Volunteer/Variation opportunities and
// Fortnight all just work against them like any other card.
// ============================================================

export async function getWeekTemplates(departmentId) {
  console.log('getWeekTemplates called', departmentId);

  try {
    const { data, error } = await supabase
      .from('week_templates')
      .select('*')
      .eq('department_id', departmentId)
      .order('name');

    return { data: data || [], error };
  } catch (err) {
    console.error('getWeekTemplates error:', err);
    return { data: [], error: err };
  }
}

export async function createWeekTemplate(departmentId, name) {
  console.log('createWeekTemplate called', departmentId, name);

  try {
    const { data, error } = await supabase
      .from('week_templates')
      .insert([{ department_id: departmentId, name: name.trim() }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Entries cascade-delete with the template (ON DELETE CASCADE) — no
// separate cleanup needed. Any theatre_activities cards a past application
// of this template already created are untouched — deleting a template
// doesn't retroactively unstaff/remove real roster data.
export async function deleteWeekTemplate(weekTemplateId) {
  console.log('deleteWeekTemplate called', weekTemplateId);

  try {
    const { error } = await supabase
      .from('week_templates')
      .delete()
      .eq('week_template_id', weekTemplateId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

export async function getWeekTemplateEntries(weekTemplateId) {
  console.log('getWeekTemplateEntries called', weekTemplateId);

  try {
    const { data, error } = await supabase
      .from('week_template_entries')
      .select('*')
      .eq('week_template_id', weekTemplateId)
      .order('day_of_week');

    return { data: data || [], error };
  } catch (err) {
    console.error('getWeekTemplateEntries error:', err);
    return { data: [], error: err };
  }
}

export async function createWeekTemplateEntry(weekTemplateId, dayOfWeek, locationId, activityId, startTime, endTime, session) {
  console.log('createWeekTemplateEntry called', { weekTemplateId, dayOfWeek, locationId, activityId, startTime, endTime, session });

  try {
    const { data, error } = await supabase
      .from('week_template_entries')
      .insert([{
        week_template_id: weekTemplateId,
        day_of_week: dayOfWeek,
        location_id: locationId,
        activity_id: activityId,
        start_time: startTime,
        end_time: endTime,
        session: session || null,
      }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function deleteWeekTemplateEntry(weekTemplateEntryId) {
  console.log('deleteWeekTemplateEntry called', weekTemplateEntryId);

  try {
    const { error } = await supabase
      .from('week_template_entries')
      .delete()
      .eq('week_template_entry_id', weekTemplateEntryId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

// Which template (if any) is applied to each Monday-start week in range —
// the Calendar's own display, and what getAllocationStatusForRange checks
// against to decide whether a day's required set is the template's or just
// whatever cards exist.
export async function getWeekTemplateApplicationsForRange(departmentId, startWeekStr, endWeekStr) {
  console.log('getWeekTemplateApplicationsForRange called', departmentId, startWeekStr, endWeekStr);

  try {
    const { data, error } = await supabase
      .from('week_template_applications')
      .select('*, week_templates(name)')
      .eq('department_id', departmentId)
      .gte('week_start_date', startWeekStr)
      .lte('week_start_date', endWeekStr);

    return { data: data || [], error };
  } catch (err) {
    console.error('getWeekTemplateApplicationsForRange error:', err);
    return { data: [], error: err };
  }
}

// Creates the real (empty) theatre_activities card for every entry in the
// template, across the 7 dates of weekStartDate's week — skipping any date/
// location/activity combination that already has a card (so applying
// doesn't duplicate or disturb an already-staffed slot), then records the
// application so the Calendar/allocation-status can see it. shift_id is
// NOT NULL on theatre_activities, so each entry's own `session` is matched
// against an active shift the same way the Day view's Add Activity already
// does (falling back to any active shift) purely to satisfy that column —
// the card's actual times come from the entry's start_time/end_time.
export async function applyWeekTemplate(departmentId, weekStartDate, weekTemplateId) {
  console.log('applyWeekTemplate called', departmentId, weekStartDate, weekTemplateId);
  const weekStartStr = toLocalDateStr(weekStartDate);

  try {
    const [{ data: entries, error: entriesError }, { data: shifts, error: shiftsError }] = await Promise.all([
      supabase.from('week_template_entries').select('*').eq('week_template_id', weekTemplateId),
      supabase.from('shifts').select('shift_id, session, active').eq('department_id', departmentId),
    ]);
    if (entriesError) throw entriesError;
    if (shiftsError) throw shiftsError;

    const activeShifts = (shifts || []).filter(s => s.active !== false);

    for (const entry of entries || []) {
      const date = new Date(weekStartDate);
      date.setDate(date.getDate() + entry.day_of_week);
      const dateStr = toLocalDateStr(date);

      const { data: existing, error: findError } = await supabase
        .from('theatre_activities')
        .select('theatre_activity_id')
        .eq('department_id', departmentId)
        .eq('date', dateStr)
        .eq('location_id', entry.location_id)
        .eq('activity_id', entry.activity_id)
        .limit(1);
      if (findError) throw findError;
      if (existing && existing.length > 0) continue;

      const matchedShift = activeShifts.find(s => s.session === entry.session) || activeShifts[0];
      if (!matchedShift) continue; // no shifts configured at all — nothing to satisfy shift_id with

      const { error: insertError } = await supabase
        .from('theatre_activities')
        .insert([{
          department_id: departmentId,
          date: dateStr,
          location_id: entry.location_id,
          shift_id: matchedShift.shift_id,
          activity_id: entry.activity_id,
          start_time: entry.start_time,
          end_time: entry.end_time,
        }]);
      if (insertError) throw insertError;
    }

    const { data, error } = await supabase
      .from('week_template_applications')
      .upsert(
        [{ department_id: departmentId, week_start_date: weekStartStr, week_template_id: weekTemplateId }],
        { onConflict: 'department_id,week_start_date' }
      )
      .select()
      .single();
    if (error) throw error;

    return { data, error: null };
  } catch (err) {
    console.error('applyWeekTemplate error:', err);
    return { data: null, error: err };
  }
}

// ============================================================
// CALENDAR ALLOCATION STATUS
// ============================================================

// For each date in range, classifies staffing coverage against two
// independent things:
//
//   - on-call: every active duty_types slot needs someone rostered
//     (duty_assignments with a staff_id) that date, regardless of whether
//     a week template is involved at all. missingOnCallAbbrevs carries
//     each unfilled slot's abbreviation (e.g. "A" for Anaesthetics On
//     Call), shown directly on the Calendar cell.
//   - required activities: if the date's Monday-start week has a week
//     template applied (see week_template_applications), every one of the
//     template's entries for that day-of-week needs a matching card with
//     at least one person on it. If no template is applied to that week,
//     this falls back to the pre-existing rule: every theatre_activities
//     card that already exists that date needs at least one person on it
//     (a location/activity nobody's created a card for at all just isn't
//     part of the requirement).
//
// The two combine into a single status per date:
//   'none'   - nothing required at all (no template, no cards, no active
//              duty types) — there's nothing to be green or red about
//   'red'    - a required activity has nobody assigned
//   'orange' - every required activity is covered, but on-call is short
//   'green'  - everything required is covered
//
// missingOnCallAbbrevs is populated whenever on-call is short, even on a
// red day — the abbreviation is about on-call specifically, independent of
// which color the day ends up.
export async function getAllocationStatusForRange(departmentId, startDate, endDate) {
  console.log('getAllocationStatusForRange called', departmentId, startDate, endDate);

  try {
    const startStr = toLocalDateStr(startDate);
    const endStr = toLocalDateStr(endDate);
    const startWeekStr = toLocalDateStr(getMondayOfWeek(startDate));
    const endWeekStr = toLocalDateStr(getMondayOfWeek(endDate));

    const [theatreRes, assignRes, dutyTypesRes, dutyAssignRes, applicationsRes] = await Promise.all([
      supabase
        .from('theatre_activities')
        .select('theatre_activity_id, date, location_id, activity_id')
        .eq('department_id', departmentId)
        .gte('date', startStr)
        .lte('date', endStr),
      supabase
        .from('staff_assignments')
        .select('date, theatre_activity_id')
        .eq('department_id', departmentId)
        .gte('date', startStr)
        .lte('date', endStr),
      supabase
        .from('duty_types')
        .select('key, label, abbreviation')
        .eq('department_id', departmentId)
        .eq('active', true),
      supabase
        .from('duty_assignments')
        .select('date, duty_type, staff_id')
        .eq('department_id', departmentId)
        .gte('date', startStr)
        .lte('date', endStr),
      supabase
        .from('week_template_applications')
        .select('week_start_date, week_template_id')
        .eq('department_id', departmentId)
        .gte('week_start_date', startWeekStr)
        .lte('week_start_date', endWeekStr),
    ]);

    if (theatreRes.error) throw theatreRes.error;
    if (assignRes.error) throw assignRes.error;
    if (dutyTypesRes.error) throw dutyTypesRes.error;
    if (dutyAssignRes.error) throw dutyAssignRes.error;
    if (applicationsRes.error) throw applicationsRes.error;

    const applicationByWeek = new Map(); // week_start_date -> week_template_id
    (applicationsRes.data || []).forEach(a => applicationByWeek.set(a.week_start_date, a.week_template_id));

    const templateIds = [...new Set(Array.from(applicationByWeek.values()))];
    const entriesByTemplate = new Map(); // week_template_id -> entries[]
    if (templateIds.length > 0) {
      const { data: entries, error: entriesError } = await supabase
        .from('week_template_entries')
        .select('*')
        .in('week_template_id', templateIds);
      if (entriesError) throw entriesError;
      (entries || []).forEach(e => {
        if (!entriesByTemplate.has(e.week_template_id)) entriesByTemplate.set(e.week_template_id, []);
        entriesByTemplate.get(e.week_template_id).push(e);
      });
    }

    const cardsByDate = new Map(); // date -> theatre_activities[]
    (theatreRes.data || []).forEach(ta => {
      if (!cardsByDate.has(ta.date)) cardsByDate.set(ta.date, []);
      cardsByDate.get(ta.date).push(ta);
    });

    const filledCardIds = new Set();
    (assignRes.data || []).forEach(a => {
      if (a.theatre_activity_id) filledCardIds.add(a.theatre_activity_id);
    });

    const dutyTypes = dutyTypesRes.data || [];
    const filledDutyKeysByDate = new Map(); // date -> Set(duty_type key)
    (dutyAssignRes.data || []).forEach(d => {
      if (!d.staff_id) return;
      if (!filledDutyKeysByDate.has(d.date)) filledDutyKeysByDate.set(d.date, new Set());
      filledDutyKeysByDate.get(d.date).add(d.duty_type);
    });

    const statusByDate = {};
    for (let d = new Date(startDate); toLocalDateStr(d) <= endStr; d.setDate(d.getDate() + 1)) {
      const date = toLocalDateStr(d);
      const weekStart = toLocalDateStr(getMondayOfWeek(d));
      const dayOfWeek = (d.getDay() + 6) % 7; // 0 = Monday, matching week_template_entries

      const missingOnCall = dutyTypes.filter(dt => !(filledDutyKeysByDate.get(date) || new Set()).has(dt.key));
      const missingOnCallAbbrevs = missingOnCall.map(dt => dt.abbreviation || dt.label);

      const appliedTemplateId = applicationByWeek.get(weekStart);
      let requiredCount = 0;
      let unfilledCount = 0;

      if (appliedTemplateId) {
        const entries = (entriesByTemplate.get(appliedTemplateId) || []).filter(e => e.day_of_week === dayOfWeek);
        entries.forEach(entry => {
          requiredCount += 1;
          const matchingCard = (cardsByDate.get(date) || []).find(ta => ta.location_id === entry.location_id && ta.activity_id === entry.activity_id);
          if (!matchingCard || !filledCardIds.has(matchingCard.theatre_activity_id)) unfilledCount += 1;
        });
      } else {
        const cards = cardsByDate.get(date) || [];
        cards.forEach(ta => {
          requiredCount += 1;
          if (!filledCardIds.has(ta.theatre_activity_id)) unfilledCount += 1;
        });
      }

      // "Nothing at all" means genuinely nothing has been touched for
      // THIS date — no cards and nobody rostered on call — not that the
      // department happens to have zero duty types configured (previously
      // checked dutyTypes.length, which is a department-wide setting and
      // is essentially never 0, so this branch never actually fired and
      // every untouched date defaulted to orange instead of empty).
      const hasAnyOnCallSetThatDate = (filledDutyKeysByDate.get(date)?.size || 0) > 0;

      let status;
      if (requiredCount === 0 && !hasAnyOnCallSetThatDate) status = 'none';
      else if (unfilledCount > 0) status = 'red';
      else if (missingOnCallAbbrevs.length > 0) status = 'orange';
      else status = 'green';

      // An empty day hasn't been touched at all, so every duty type reads
      // as "missing" by construction — that's not the same as a day where
      // on-call was actually attempted and fell short, so no abbreviations
      // show on an empty day.
      statusByDate[date] = { status, missingOnCallAbbrevs: status === 'none' ? [] : missingOnCallAbbrevs };
    }

    return { data: statusByDate, error: null };
  } catch (err) {
    console.error('getAllocationStatusForRange error:', err);
    return { data: {}, error: err };
  }
}

// ============================================================
// VOLUNTEER SHIFTS
// ============================================================

const VOLUNTEER_LOOKAHEAD_DAYS = 30;

// Theatre activities in the next 30 days where the role matching this staff
// member's rank (per that department's staff_ranks.requires_supervision:
// false -> consultant, true -> registrar; a rank not found in the
// department's list has nothing to volunteer for) is still unfilled,
// they're not activity-restricted from it, and they've explicitly marked
// themselves available that date (an unconfirmed day doesn't count, same
// rule as officer-side assignment).
export async function getAvailableShiftsForStaff(staffId, departmentId) {
  console.log('getAvailableShiftsForStaff called', staffId, departmentId);

  try {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + VOLUNTEER_LOOKAHEAD_DAYS);
    const startStr = toLocalDateStr(today);
    const endStr = toLocalDateStr(endDate);

    const [staffRes, theatreRes, assignRes, availRes, volunteerRes] = await Promise.all([
      supabase
        .from('staff')
        .select('rank, activity_restrictions')
        .eq('staff_id', staffId)
        .single(),
      supabase
        .from('theatre_activities')
        .select('theatre_activity_id, date, location_id, locations(name), shifts(name, start_time, end_time), activity_types(name)')
        .eq('department_id', departmentId)
        .gte('date', startStr)
        .lte('date', endStr),
      supabase
        .from('staff_assignments')
        .select('theatre_activity_id, role')
        .eq('department_id', departmentId)
        .gte('date', startStr)
        .lte('date', endStr),
      supabase
        .from('staff_availability')
        .select('date, available')
        .eq('staff_id', staffId)
        .gte('date', startStr)
        .lte('date', endStr),
      supabase
        .from('volunteer_requests')
        .select('theatre_activity_id, role')
        .eq('staff_id', staffId),
    ]);

    if (staffRes.error) throw staffRes.error;
    if (theatreRes.error) throw theatreRes.error;
    if (assignRes.error) throw assignRes.error;
    if (availRes.error) throw availRes.error;
    if (volunteerRes.error) throw volunteerRes.error;

    const rank = staffRes.data?.rank || '';
    const { data: staffRanks } = await getStaffRanks(departmentId);
    const rankRow = staffRanks.find(r => r.rank === rank);
    const roleForRank = !rankRow ? null : rankRow.requires_supervision ? 'registrar' : 'consultant';
    if (!roleForRank) return { data: [], error: null };

    const restrictions = staffRes.data?.activity_restrictions || [];

    // Keyed by theatre_activity_id, not location+date: a location can host
    // more than one activity/card on the same day (e.g. AM Endoscopy and PM
    // Anaesthetics both at "Theatre 1"), and a role filled on one card
    // shouldn't hide a genuinely empty slot on a different card at the same
    // location. theatre_activity_id is always set here — duty-type
    // assignments (on-call) no longer create a staff_assignments row at
    // all, so every row this query sees belongs to a real card.
    const filledRolesByTheatreActivity = new Map(); // theatre_activity_id -> Set(role)
    (assignRes.data || []).forEach(a => {
      if (!a.theatre_activity_id) return;
      if (!filledRolesByTheatreActivity.has(a.theatre_activity_id)) filledRolesByTheatreActivity.set(a.theatre_activity_id, new Set());
      filledRolesByTheatreActivity.get(a.theatre_activity_id).add(a.role);
    });

    const availableDates = new Set(
      (availRes.data || []).filter(r => r.available === true).map(r => r.date)
    );

    const alreadyVolunteered = new Set(
      (volunteerRes.data || []).map(v => `${v.theatre_activity_id}|${v.role}`)
    );

    const opportunities = (theatreRes.data || [])
      .filter(ta => {
        const filledRoles = filledRolesByTheatreActivity.get(ta.theatre_activity_id) || new Set();
        if (filledRoles.has(roleForRank)) return false; // role already filled
        if (!availableDates.has(ta.date)) return false; // staff hasn't confirmed availability
        const activityName = ta.activity_types?.name;
        if (activityName && restrictions.includes(activityName)) return false; // restricted
        return true;
      })
      .map(ta => ({
        theatre_activity_id: ta.theatre_activity_id,
        location_id: ta.location_id,
        location: ta.locations?.name || 'Unknown location',
        date: ta.date,
        shift: ta.shifts?.name || null,
        shift_start: ta.shifts?.start_time || null,
        shift_end: ta.shifts?.end_time || null,
        activity: ta.activity_types?.name || null,
        role_needed: roleForRank,
        already_volunteered: alreadyVolunteered.has(`${ta.theatre_activity_id}|${roleForRank}`),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { data: opportunities, error: null };
  } catch (err) {
    console.error('getAvailableShiftsForStaff error:', err);
    return { data: [], error: err };
  }
}

// Idempotent — re-volunteering for the same activity+role is a no-op rather
// than an error, via the table's (theatre_activity_id, staff_id, role) unique constraint.
export async function createVolunteerRequest(departmentId, theatreActivityId, staffId, role) {
  console.log('createVolunteerRequest called', departmentId, theatreActivityId, staffId, role);

  try {
    const { data, error } = await supabase
      .from('volunteer_requests')
      .upsert(
        [{ department_id: departmentId, theatre_activity_id: theatreActivityId, staff_id: staffId, role }],
        { onConflict: 'theatre_activity_id,staff_id,role' }
      )
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Pending volunteers for a set of theatre activities (the ones currently
// visible in the officer's Day view), with the volunteering staff member's
// name attached for display.
export async function getVolunteerRequestsForActivities(theatreActivityIds) {
  console.log('getVolunteerRequestsForActivities called', theatreActivityIds);
  if (!theatreActivityIds || theatreActivityIds.length === 0) return { data: [], error: null };

  try {
    const { data, error } = await supabase
      .from('volunteer_requests')
      .select('*, staff(name, rank)')
      .in('theatre_activity_id', theatreActivityIds)
      .order('created_at');

    return { data: data || [], error };
  } catch (err) {
    console.error('getVolunteerRequestsForActivities error:', err);
    return { data: [], error: err };
  }
}

// Clears every pending volunteer request for a role once it's been filled —
// by whoever got assigned, not just the one the officer picked — since the
// opportunity the other volunteers were requesting no longer exists.
export async function clearVolunteerRequestsForRole(theatreActivityId, role) {
  console.log('clearVolunteerRequestsForRole called', theatreActivityId, role);

  try {
    const { error } = await supabase
      .from('volunteer_requests')
      .delete()
      .eq('theatre_activity_id', theatreActivityId)
      .eq('role', role);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

// ============================================================
// SICK REPORTS — see migrations/2026-08-25_sick_reports.sql. A staff
// member with a shift today can flag themselves sick from the Variation
// tab; an officer approves or denies it. Approval is meant to alert
// whoever's on call at the time, but real push notifications aren't wired
// up yet (see push-notifications-deferred in project memory) — for now,
// an approved report just needs to be visible in the app.
// ============================================================

// Whether staffId already has a pending/approved sick report for date —
// drives the "Notify Sick" button's own state (already sent / already
// approved) in staffRosterView.jsx.
export async function getMySickReportForDate(staffId, date) {
  console.log('getMySickReportForDate called', staffId, date);
  const dateStr = toLocalDateStr(date);

  try {
    const { data, error } = await supabase
      .from('sick_reports')
      .select('*')
      .eq('staff_id', staffId)
      .eq('date', dateStr)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return { data, error };
  } catch (err) {
    console.error('getMySickReportForDate error:', err);
    return { data: null, error: err };
  }
}

export async function createSickReport(departmentId, staffId, date) {
  console.log('createSickReport called', departmentId, staffId, date);
  const dateStr = toLocalDateStr(date);

  try {
    const { data, error } = await supabase
      .from('sick_reports')
      .insert([{ department_id: departmentId, staff_id: staffId, date: dateStr }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Pending sick reports for a department, most recent first — the officer
// Day view's approval banner.
export async function getPendingSickReports(departmentId) {
  console.log('getPendingSickReports called', departmentId);

  try {
    const { data, error } = await supabase
      .from('sick_reports')
      .select('*, staff(name)')
      .eq('department_id', departmentId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    return { data: data || [], error };
  } catch (err) {
    console.error('getPendingSickReports error:', err);
    return { data: [], error: err };
  }
}

export async function resolveSickReport(sickReportId, status, resolvedByStaffId) {
  console.log('resolveSickReport called', sickReportId, status, resolvedByStaffId);

  try {
    const { data, error } = await supabase
      .from('sick_reports')
      .update({ status, resolved_at: new Date().toISOString(), resolved_by: resolvedByStaffId })
      .eq('sick_report_id', sickReportId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// ============================================================
// PAYROLL EXPORT
// ============================================================

export async function getLeaveTypes(departmentId) {
  console.log('getLeaveTypes called', departmentId);

  try {
    const { data, error } = await supabase
      .from('leave_types')
      .select('*')
      .eq('department_id', departmentId)
      .order('name');

    return { data: data || [], error };
  } catch (err) {
    console.error('getLeaveTypes error:', err);
    return { data: [], error: err };
  }
}

export async function createLeaveType(departmentId, name, code) {
  console.log('createLeaveType called', departmentId, name, code);

  try {
    const { data, error } = await supabase
      .from('leave_types')
      .insert([{ department_id: departmentId, name, code }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    console.error('createLeaveType error:', err);
    return { data: null, error: err };
  }
}

export async function updateLeaveType(leaveTypeId, name, code) {
  console.log('updateLeaveType called', leaveTypeId, name, code);

  try {
    const { data, error } = await supabase
      .from('leave_types')
      .update({ name, code })
      .eq('leave_type_id', leaveTypeId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    console.error('updateLeaveType error:', err);
    return { data: null, error: err };
  }
}

export async function deleteLeaveType(leaveTypeId) {
  console.log('deleteLeaveType called', leaveTypeId);

  try {
    const { error } = await supabase
      .from('leave_types')
      .delete()
      .eq('leave_type_id', leaveTypeId);

    return { error };
  } catch (err) {
    console.error('deleteLeaveType error:', err);
    return { error: err };
  }
}

// ============================================================
// ADVANCED SKILLS
// ============================================================
// Per-department tag list (e.g. Anaesthetics, Obstetrics, Endoscopy) an
// officer assigns to staff and requires (one-of-a-set) on Activities/Duty
// Types to limit who's offered for a slot — see
// migrations/2026-08-26_advanced_skills.sql.

export async function getAdvancedSkills(departmentId) {
  try {
    const { data, error } = await supabase
      .from('advanced_skills')
      .select('*')
      .eq('department_id', departmentId)
      .order('sort_order');

    return { data: data || [], error };
  } catch (err) {
    console.error('getAdvancedSkills error:', err);
    return { data: [], error: err };
  }
}

export async function createAdvancedSkill(departmentId, name) {
  try {
    const { data: existing } = await supabase
      .from('advanced_skills')
      .select('sort_order')
      .eq('department_id', departmentId)
      .order('sort_order', { ascending: false })
      .limit(1);
    const nextSortOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const { data, error } = await supabase
      .from('advanced_skills')
      .insert([{ department_id: departmentId, name, sort_order: nextSortOrder }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    console.error('createAdvancedSkill error:', err);
    return { data: null, error: err };
  }
}

export async function updateAdvancedSkill(advancedSkillId, name) {
  try {
    const { data, error } = await supabase
      .from('advanced_skills')
      .update({ name })
      .eq('advanced_skill_id', advancedSkillId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    console.error('updateAdvancedSkill error:', err);
    return { data: null, error: err };
  }
}

// Hard-deletes the skill and strips it out of every staff member's,
// activity type's, and duty type's array wherever it's in use — otherwise
// those would be left holding a dangling advanced_skill_id that could never
// be unchecked again from the UI.
export async function deleteAdvancedSkill(advancedSkillId, departmentId) {
  try {
    const [staffRes, activitiesRes, dutyTypesRes] = await Promise.all([
      supabase.from('staff').select('staff_id, advanced_skills').eq('department_id', departmentId).contains('advanced_skills', [advancedSkillId]),
      supabase.from('activity_types').select('activity_id, required_advanced_skills').eq('department_id', departmentId).contains('required_advanced_skills', [advancedSkillId]),
      supabase.from('duty_types').select('duty_type_id, required_advanced_skills').eq('department_id', departmentId).contains('required_advanced_skills', [advancedSkillId]),
    ]);
    if (staffRes.error) throw staffRes.error;
    if (activitiesRes.error) throw activitiesRes.error;
    if (dutyTypesRes.error) throw dutyTypesRes.error;

    for (const s of staffRes.data || []) {
      const { error } = await supabase
        .from('staff')
        .update({ advanced_skills: (s.advanced_skills || []).filter(id => id !== advancedSkillId) })
        .eq('staff_id', s.staff_id);
      if (error) throw error;
    }
    for (const a of activitiesRes.data || []) {
      const { error } = await supabase
        .from('activity_types')
        .update({ required_advanced_skills: (a.required_advanced_skills || []).filter(id => id !== advancedSkillId) })
        .eq('activity_id', a.activity_id);
      if (error) throw error;
    }
    for (const d of dutyTypesRes.data || []) {
      const { error } = await supabase
        .from('duty_types')
        .update({ required_advanced_skills: (d.required_advanced_skills || []).filter(id => id !== advancedSkillId) })
        .eq('duty_type_id', d.duty_type_id);
      if (error) throw error;
    }

    const { error } = await supabase
      .from('advanced_skills')
      .delete()
      .eq('advanced_skill_id', advancedSkillId);

    return { error };
  } catch (err) {
    console.error('deleteAdvancedSkill error:', err);
    return { error: err };
  }
}

// Which advanced skills a staff member holds — settable by an officer from
// the Staff and Availability tab. Staff can hold more than one.
export async function updateStaffAdvancedSkills(staffId, advancedSkillIds) {
  try {
    const { data, error } = await supabase
      .from('staff')
      .update({ advanced_skills: advancedSkillIds })
      .eq('staff_id', staffId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    console.error('updateStaffAdvancedSkills error:', err);
    return { data: null, error: err };
  }
}

// Which advanced skills are required (any one of them) to be offered for
// this Activity's assignment slots. Empty = no restriction, same as
// locations.allowed_activity_ids.
export async function updateActivityTypeRequiredSkills(activityId, advancedSkillIds) {
  try {
    const { data, error } = await supabase
      .from('activity_types')
      .update({ required_advanced_skills: advancedSkillIds })
      .eq('activity_id', activityId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    console.error('updateActivityTypeRequiredSkills error:', err);
    return { data: null, error: err };
  }
}

// Same as updateActivityTypeRequiredSkills, for a Duty Type's on-call slot.
export async function updateDutyTypeRequiredSkills(dutyTypeId, advancedSkillIds) {
  try {
    const { data, error } = await supabase
      .from('duty_types')
      .update({ required_advanced_skills: advancedSkillIds })
      .eq('duty_type_id', dutyTypeId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    console.error('updateDutyTypeRequiredSkills error:', err);
    return { data: null, error: err };
  }
}

// Free-text leave/special code on a staff_assignments row — separate from
// createStaffAssignment/updateStaffAssignment so setting it doesn't disturb
// the staff/role/shift fields those two are already responsible for.
export async function updateStaffAssignmentLeaveCode(assignmentId, leaveCode) {
  console.log('updateStaffAssignmentLeaveCode called', assignmentId, leaveCode);
  const normalizedLeaveCode = leaveCode ? leaveCode : null;

  try {
    const { data, error } = await supabase
      .from('staff_assignments')
      .update({ leave_code: normalizedLeaveCode })
      .eq('assignment_id', assignmentId)
      .select();

    return { data, error };
  } catch (err) {
    console.error('updateStaffAssignmentLeaveCode error:', err);
    return { data: null, error: err };
  }
}

export async function updateStaffPayrollNumber(staffId, payrollNumber) {
  console.log('updateStaffPayrollNumber called', staffId, payrollNumber);

  try {
    const { error } = await supabase
      .from('staff')
      .update({ payroll_number: payrollNumber || null })
      .eq('staff_id', staffId);

    return { error };
  } catch (err) {
    console.error('updateStaffPayrollNumber error:', err);
    return { error: err };
  }
}

export async function updateStaffPositionId(staffId, positionId) {
  console.log('updateStaffPositionId called', staffId, positionId);

  try {
    const { error } = await supabase
      .from('staff')
      .update({ position_id: positionId || null })
      .eq('staff_id', staffId);

    return { error };
  } catch (err) {
    console.error('updateStaffPositionId error:', err);
    return { error: err };
  }
}

export async function updateStaffCostCentre(staffId, costCentre) {
  console.log('updateStaffCostCentre called', staffId, costCentre);

  try {
    const { error } = await supabase
      .from('staff')
      .update({ cost_centre: costCentre || null })
      .eq('staff_id', staffId);

    return { error };
  } catch (err) {
    console.error('updateStaffCostCentre error:', err);
    return { error: err };
  }
}

export async function getDepartment(departmentId) {
  console.log('getDepartment called', departmentId);

  try {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .eq('department_id', departmentId)
      .maybeSingle();

    return { data, error };
  } catch (err) {
    console.error('getDepartment error:', err);
    return { data: null, error: err };
  }
}

export async function updateDepartmentPayCentreNumber(departmentId, payCentreNumber) {
  console.log('updateDepartmentPayCentreNumber called', departmentId, payCentreNumber);

  try {
    const { error } = await supabase
      .from('departments')
      .update({ pay_centre_number: payCentreNumber || null })
      .eq('department_id', departmentId);

    return { error };
  } catch (err) {
    console.error('updateDepartmentPayCentreNumber error:', err);
    return { error: err };
  }
}

// See migrations/2026-08-24_coffee_place.sql — the café the Coffee Orders
// modal's "text the order" link is addressed to.
export async function updateDepartmentCoffeePlace(departmentId, coffeePlaceName, coffeePlacePhone) {
  console.log('updateDepartmentCoffeePlace called', departmentId, coffeePlaceName, coffeePlacePhone);

  try {
    const { error } = await supabase
      .from('departments')
      .update({ coffee_place_name: coffeePlaceName || null, coffee_place_phone: coffeePlacePhone || null })
      .eq('department_id', departmentId);

    return { error };
  } catch (err) {
    console.error('updateDepartmentCoffeePlace error:', err);
    return { error: err };
  }
}

// All staff_assignments for a department across a Mon-Sun week, with the
// staff's name/payroll_number, shift start/end times, and linked activity
// attached — the data source for the payroll Excel export, and (joined
// with refData.activities client-side for each row's activity_type
// abbreviation) the Fortnight view's abridged day cells. Mirrors
// getAllOnCallAssignmentsForWeek's "whole department, date range" shape
// rather than getStaffAssignmentsForWeek's single-staff one, since both
// consumers need every staff member at once.
export async function getAllStaffAssignmentsForRange(departmentId, rangeStartDate, numDays) {
  console.log('getAllStaffAssignmentsForRange called', departmentId, rangeStartDate, numDays);
  const startStr = toLocalDateStr(rangeStartDate);
  const endDate = new Date(rangeStartDate);
  endDate.setDate(endDate.getDate() + numDays - 1);
  const endStr = toLocalDateStr(endDate);

  try {
    const { data, error } = await supabase
      .from('staff_assignments')
      .select('*, staff(name, payroll_number, rank), locations(name), shifts(name, start_time, end_time, session), theatre_activities(activity_id, start_time, end_time)')
      .eq('department_id', departmentId)
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date');

    console.log('All staff assignments for range:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getAllStaffAssignmentsForRange error:', err);
    return { data: [], error: err };
  }
}

// Whole department's duty_assignments (on-call etc.) across a date range —
// the Fortnight grid's other data source alongside
// getAllStaffAssignmentsForRange, since duty-type assignments no longer
// create a staff_assignments row at all (see assignStaffFortnight).
export async function getDutyAssignmentsForRange(departmentId, rangeStartDate, numDays) {
  console.log('getDutyAssignmentsForRange called', departmentId, rangeStartDate, numDays);
  const startStr = toLocalDateStr(rangeStartDate);
  const endDate = new Date(rangeStartDate);
  endDate.setDate(endDate.getDate() + numDays - 1);
  const endStr = toLocalDateStr(endDate);

  try {
    const { data, error } = await supabase
      .from('duty_assignments')
      .select('*, staff(name)')
      .eq('department_id', departmentId)
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date');

    console.log('Duty assignments for range:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getDutyAssignmentsForRange error:', err);
    return { data: [], error: err };
  }
}

// ============================================================
// FORTNIGHT VIEW — person-first assignment into the same
// staff_assignments/theatre_activities tables the Day view uses (see
// migrations/2026-08-23_activity_abbreviation_and_fortnight_unify.sql,
// which drops the old separate, disconnected staff_shift_allocations
// table this used to read/write instead). getAllStaffAssignmentsForRange
// above is the read side; assignStaffFortnight below is the write side.
// ============================================================

// Adds staffId to the shift/location/activity picked in the Fortnight
// wizard.
//
// If the activity picked is one a duty type auto-created for itself (see
// createDutyType) — e.g. "ED On-Call" — this is a duty assignment, not a
// real activity: it only upserts the matching duty_assignments row and
// stops there. No theatre_activities card is created for it, exactly like
// assigning that duty type from the Duty Assignments panel — otherwise it
// would show as an ordinary card grouped into Morning/Afternoon/Night,
// which is the exact bug this was built to avoid.
//
// Otherwise, finds an existing theatre_activities card for this
// (date, location, activity) with a session overlapping the picked
// shift's own and joins it if one exists — e.g. a second person picking
// the same AM Endoscopy slot, even on a different shift that also covers
// the morning, lands on the same card — otherwise creates a new one
// using the shift's own times, same as a location's activity card always
// being time-scoped to match whichever shift it was created for.
//
// onCall marks the resulting staff_assignments row the same way the Day
// view's on-call checkbox does.
//
// theatreActivityIdOverride lets a caller join a specific existing card
// directly (used by the Fortnight junior wizard, which lists actual cards
// rather than a shift+location+activity combination) — the person's own
// shiftId may legitimately differ from whichever shift originally created
// that card (e.g. a registrar working a "Day" shift joining a card a
// consultant's "Long Day" shift created), so the normal find-by-shift_id
// lookup below would otherwise miss it and create a duplicate card.
export async function assignStaffFortnight(departmentId, date, staffId, shiftId, locationId, activityId, onCall = false, theatreActivityIdOverride = null) {
  console.log('assignStaffFortnight called', { departmentId, date, staffId, shiftId, locationId, activityId, onCall, theatreActivityIdOverride });
  const dateStr = toLocalDateStr(date);

  try {
    const { data: dutyType, error: dutyTypeError } = await supabase
      .from('duty_types')
      .select('key')
      .eq('department_id', departmentId)
      .eq('activity_type_id', activityId)
      .maybeSingle();
    if (dutyTypeError) throw dutyTypeError;

    if (dutyType) {
      const { error } = await supabase
        .from('duty_assignments')
        .upsert(
          [{ department_id: departmentId, date: dateStr, duty_type: dutyType.key, staff_id: staffId }],
          { onConflict: 'department_id,date,duty_type' }
        );
      if (error) throw error;
      return { data: null, error: null };
    }

    const [{ data: candidateTaRows, error: findError }, { data: shift, error: shiftError }, { data: staffRow, error: staffError }] = await Promise.all([
      theatreActivityIdOverride
        ? { data: null, error: null }
        : supabase
            .from('theatre_activities')
            .select('theatre_activity_id, start_time, end_time')
            .eq('department_id', departmentId)
            .eq('date', dateStr)
            .eq('location_id', locationId)
            .eq('activity_id', activityId)
            .order('theatre_activity_id'),
      supabase.from('shifts').select('start_time, end_time').eq('shift_id', shiftId).single(),
      supabase.from('staff').select('rank').eq('staff_id', staffId).single(),
    ]);
    if (findError) throw findError;
    if (shiftError) throw shiftError;
    if (staffError) throw staffError;

    // Same location+activity, an overlapping session — not an exact
    // shift_id match — is what makes two picks "the same card": two
    // people picking different shifts that both land in the same
    // session(s) (e.g. "Day" and "Long Day" both covering Morning) still
    // means one card, same as Add Activity's own duplicate check.
    //
    // The candidate has to cover EVERY session the picked shift spans,
    // not just overlap one of them — a card's session grouping on read
    // comes from ITS OWN stored start/end, not each person's real shift,
    // so joining a card that only partially covers this shift would
    // silently drop the uncovered part from display (e.g. an ED card
    // already exists at 08:00-18:00, and this person's own shift is
    // 10:30-20:30 — spanning into Night too; matching on "any" overlap
    // joined the day card and their Night hours never showed up
    // anywhere). Requiring full coverage means that case creates its own
    // card instead, using this shift's own times, so it naturally spans
    // every session it should — the cascade below still joins them onto
    // the pre-existing day card too, so they don't disappear from
    // Morning/Afternoon either.
    //
    // Earliest match wins if more than one fully covers it (no unique
    // constraint on this combination any more, so that's possible).
    let theatreActivityId;
    if (theatreActivityIdOverride) {
      theatreActivityId = theatreActivityIdOverride;
    } else {
      const pickedShiftGroups = getSessionGroups(shift);
      const match = (candidateTaRows || []).find(ta => {
        const taGroups = getSessionGroups({ start_time: ta.start_time, end_time: ta.end_time });
        return pickedShiftGroups.every(g => taGroups.includes(g));
      });
      theatreActivityId = match?.theatre_activity_id;
    }
    let alreadyOnCard = false;
    if (!theatreActivityId) {
      const { data: newTa, error: createError } = await supabase
        .from('theatre_activities')
        .insert([{
          department_id: departmentId,
          date: dateStr,
          location_id: locationId,
          shift_id: shiftId,
          activity_id: activityId,
          start_time: shift.start_time,
          end_time: shift.end_time,
        }])
        .select('theatre_activity_id')
        .single();
      if (createError) throw createError;
      theatreActivityId = newTa.theatre_activity_id;
    } else {
      const { count, error: dupError } = await supabase
        .from('staff_assignments')
        .select('assignment_id', { count: 'exact', head: true })
        .eq('theatre_activity_id', theatreActivityId)
        .eq('staff_id', staffId);
      if (dupError) throw dupError;
      alreadyOnCard = count > 0;
    }

    const { data: staffRanksForRole } = await getStaffRanks(departmentId);
    const rankRowForRole = staffRanksForRole.find(r => r.rank === staffRow.rank);
    // No matching rank (rank not set) defaults to the safer assumption —
    // needs supervision — rather than silently treating them as senior.
    const role = (!rankRowForRole || rankRowForRole.requires_supervision) ? 'registrar' : 'consultant';

    let data = null;
    if (!alreadyOnCard) {
      const result = await createStaffAssignment(departmentId, date, locationId, staffId, shiftId, role, null, theatreActivityId, onCall);
      if (result.error) throw result.error;
      data = result.data;
    }

    // A shift spanning more than one session (e.g. 10:30-22:00 covering
    // Afternoon + Night) shouldn't need adding by hand to every other card
    // for the SAME activity at this location that falls inside it —
    // mirrors cascadeAssignmentAcrossSections in the Day view, just
    // writing straight through instead of staging a draft, since Fortnight
    // has no draft/Complete-Allocation step of its own.
    //
    // Skipped when joining a specific card via theatreActivityIdOverride —
    // there the officer deliberately picked exactly one existing card (see
    // cardsInSessionForJunior in officer-roster-view-supabase.jsx), and
    // spilling onto sibling cards for the same activity/location would add
    // them somewhere they weren't asked to go.
    const shiftGroups = getSessionGroups(shift);
    if (!theatreActivityIdOverride && shiftGroups.length > 1) {
      const { data: siblings, error: siblingsError } = await supabase
        .from('theatre_activities')
        .select('theatre_activity_id, start_time, end_time')
        .eq('department_id', departmentId)
        .eq('date', dateStr)
        .eq('location_id', locationId)
        .eq('activity_id', activityId)
        .neq('theatre_activity_id', theatreActivityId);
      if (siblingsError) throw siblingsError;

      for (const sibling of siblings || []) {
        const siblingGroups = getSessionGroups({ start_time: sibling.start_time, end_time: sibling.end_time });
        if (!siblingGroups.some(g => shiftGroups.includes(g))) continue;

        const { count: siblingCount, error: siblingDupError } = await supabase
          .from('staff_assignments')
          .select('assignment_id', { count: 'exact', head: true })
          .eq('theatre_activity_id', sibling.theatre_activity_id)
          .eq('staff_id', staffId);
        if (siblingDupError) throw siblingDupError;
        if (siblingCount > 0) continue;

        const { error: cascadeError } = await createStaffAssignment(departmentId, date, locationId, staffId, shiftId, role, null, sibling.theatre_activity_id, onCall);
        if (cascadeError) throw cascadeError;
      }
    }

    return { data, error: null, theatreActivityId };
  } catch (err) {
    console.error('assignStaffFortnight error:', err);
    return { data: null, error: err };
  }
}

// ============================================================
// ROSTER EXCEL IMPORT — WRITE
// ============================================================
//
// Takes the already-parsed output of parseConsultantWeek/parseRmoWeek/
// parseInternWeek (src/rosterExcelImport.js) and writes it into
// Supabase. Deliberately defaults to a dry run (dryRun: true) — this
// writes real roster data, so every call reports exactly what it would
// do (or did) per person/day, rather than silently succeeding or
// failing partway through with no record of what happened.
//
// Resolution order per segment: staff name -> location name -> activity
// name -> an exact-matching (or newly created) shift -> a card via
// assignStaffFortnight, which already handles finding-or-joining an
// existing card by session overlap, deriving consultant/registrar from
// rank, and cascading across sessions for a shift spanning more than
// one — none of that needed rebuilding. A leave code writes no
// assignment at all (the "day off is the absence of a row" convention
// already used throughout this schema) and instead marks
// staff_availability unavailable for that date.
//
// Deliberately does NOT create missing locations/activities — those are
// structural and the department sets them up in Settings themselves; a
// segment naming one that doesn't exist is reported as a per-entry
// error, never silently invented.

// DD/MM/YYYY (as Excel displays it, and as extractConsultantWeek/
// extractRmoWeek/extractInternWeek's date row comes through) -> Date.
function parseExcelDate(ddmmyyyy) {
  const [d, m, y] = (ddmmyyyy || '').split('/').map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

// Exact-time match only (not nearest/session-bucket) — these times are
// real working hours that matter for fatigue tracking and payroll, so a
// 10:30-20:30 shift should never get silently folded into an existing
// 10:30-21:00 one just because they're close.
export async function findOrCreateShift(departmentId, startTime, endTime) {
  if (!startTime || !endTime) {
    return { data: null, error: new Error('Cannot resolve a shift without both a start and end time') };
  }

  try {
    const { data: existing, error: findError } = await supabase
      .from('shifts')
      .select('shift_id')
      .eq('department_id', departmentId)
      .eq('start_time', startTime)
      .eq('end_time', endTime)
      .eq('active', true)
      .limit(1);
    if (findError) throw findError;
    if (existing && existing.length > 0) return { data: existing[0].shift_id, error: null };

    const session = sessionForDutyTimes(startTime, endTime);
    const { data: newShift, error: createError } = await createShift(
      departmentId, `Imported ${startTime}–${endTime}`, 'weekday', startTime, endTime, session
    );
    if (createError) throw createError;
    return { data: newShift.shift_id, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

// people: the array returned by parseConsultantWeek/parseRmoWeek/
// parseInternWeek. refLists: { staffList, locations, activities,
// leaveTypes } — already-loaded department reference data (e.g.
// officer-roster-view-supabase.jsx's refData), passed in rather than
// fetched again.
export async function importRosterWeek(departmentId, people, refLists, { dryRun = true } = {}) {
  const { staffList, locations, activities, leaveTypes } = refLists;
  const results = [];

  for (const person of people) {
    const staff = matchStaffName(person.rawLabel, staffList);
    if (!staff) {
      results.push({ rawLabel: person.rawLabel, ok: false, reason: 'No matching staff record' });
      continue;
    }

    for (const day of person.days) {
      if (!day.rawShift || !day.resolvedShift) continue;
      const resolved = day.resolvedShift;
      const entry = { rawLabel: person.rawLabel, staffId: staff.staff_id, staffName: staff.name, date: day.date, rawShift: day.rawShift };

      if (resolved.unmapped) {
        results.push({ ...entry, ok: false, reason: `Unmapped code: "${resolved.unmapped}"` });
        continue;
      }

      const date = parseExcelDate(day.date);
      if (!date) {
        results.push({ ...entry, ok: false, reason: `Could not parse date "${day.date}"` });
        continue;
      }

      if (resolved.leaveCode) {
        const leaveType = leaveTypes.find(lt => lt.code === resolved.leaveCode);
        if (dryRun) {
          results.push({ ...entry, ok: true, action: 'mark unavailable', leaveCode: resolved.leaveCode, leaveTypeId: leaveType?.leave_type_id ?? null });
          continue;
        }
        const { error } = await bulkSetStaffAvailability(departmentId, staff.staff_id, [date], false, leaveType?.leave_type_id ?? null);
        results.push({ ...entry, ok: !error, action: 'mark unavailable', leaveCode: resolved.leaveCode, error: error?.message });
        continue;
      }

      for (const segment of resolved.segments || []) {
        const location = locations.find(l => l.name.trim().toLowerCase() === segment.location.toLowerCase());
        const activity = activities.find(a => a.name.trim().toLowerCase() === segment.activity.toLowerCase());
        if (!location || !activity) {
          const missing = [!location ? `location "${segment.location}"` : null, !activity ? `activity "${segment.activity}"` : null].filter(Boolean).join(' and ');
          results.push({ ...entry, ok: false, reason: `Not found: ${missing}` });
          continue;
        }
        if (!segment.start || !segment.end) {
          results.push({ ...entry, ok: false, reason: `No fixed time for ${segment.location}/${segment.activity} — can't resolve a shift` });
          continue;
        }

        if (dryRun) {
          results.push({ ...entry, ok: true, action: 'assign', location: location.name, activity: activity.name, start: segment.start, end: segment.end });
          continue;
        }

        const { data: shiftId, error: shiftError } = await findOrCreateShift(departmentId, segment.start, segment.end);
        if (shiftError) {
          results.push({ ...entry, ok: false, reason: `Failed to resolve shift: ${shiftError.message}` });
          continue;
        }

        const { error: assignError } = await assignStaffFortnight(departmentId, date, staff.staff_id, shiftId, location.location_id, activity.activity_id);
        results.push({ ...entry, ok: !assignError, action: 'assign', location: location.name, activity: activity.name, start: segment.start, end: segment.end, error: assignError?.message });
      }
    }
  }

  return { data: results, error: null };
}

// ============================================================
// ROSTER EXCEL EXPORT — READ
// ============================================================
//
// The reverse of the import above: reads one week's real staff_assignments
// (+theatre_activities+shifts+locations), staff_availability (leave), and
// duty_assignments (on-call) out of Supabase and shapes it into the
// per-person-per-day form src/rosterExcelExport.js turns into worksheet
// rows.
//
// Deliberately renders each clinical segment as plain "Location / Activity
// HH:MM-HH:MM" text (done in rosterExcelExport.js) rather than trying to
// reconstruct the import's terse shorthand (ED, OT, Endo...) — several of
// those codes collapse multiple distinct activities onto one abbreviation
// (e.g. "Obs Clinic"/"ANC"/"ObsC"/"Obs" all mean the same thing on the way
// in), so there's no single correct code to reverse to. Leave is the one
// place a short code survives round-trip cleanly, since leave_types.code
// (AL/SL/GP/PDL) is now the authoritative source rather than something to
// guess at.
//
// Note: the Excel import never writes CALL OBLIGATION notes into
// duty_assignments (see importRosterWeek above — it only handles
// leaveCode and segments), so the "Call Obligation" row this produces only
// reflects on-call assigned through the app itself (Fortnight/Day view),
// not whatever was in a CALL OBLIGATION cell of an originally-imported
// week.
const DAY_LABELS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function fetchRosterExportWeek(departmentId, weekStartDate, refLists) {
  const { activities, leaveTypes, staffList, staffRanks = [] } = refLists;
  const requiresSupervisionByRank = new Map(staffRanks.map(r => [r.rank, r.requires_supervision]));

  const weekStart = new Date(weekStartDate);
  weekStart.setHours(0, 0, 0, 0);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const dateStrs = dates.map(toLocalDateStr);

  try {
    const [
      { data: assignments, error: aErr },
      { data: availability, error: avErr },
      { data: duties, error: dErr },
      { data: dutyTypes, error: dtErr },
    ] = await Promise.all([
      getAllStaffAssignmentsForRange(departmentId, weekStart, 7),
      getStaffAvailability(departmentId, weekStart),
      getDutyAssignmentsForRange(departmentId, weekStart, 7),
      getDutyTypes(departmentId),
    ]);
    if (aErr) throw aErr;
    if (avErr) throw avErr;
    if (dErr) throw dErr;
    if (dtErr) throw dtErr;

    const activityNameById = new Map((activities || []).map(a => [a.activity_id, a.name]));
    const leaveTypeById = new Map((leaveTypes || []).map(lt => [lt.leave_type_id, lt]));
    const dutyLabelByKey = new Map((dutyTypes || []).map(dt => [dt.key, dt.label]));

    const byStaff = new Map(); // staff_id -> { name, rank, byDate: Map(dateStr -> day) }

    function ensurePerson(staffId, name, rank) {
      if (!byStaff.has(staffId)) byStaff.set(staffId, { name, rank, byDate: new Map() });
      return byStaff.get(staffId);
    }
    function ensureDay(person, dateStr) {
      if (!person.byDate.has(dateStr)) person.byDate.set(dateStr, { segments: [], leaveCode: null, dutyLabels: [] });
      return person.byDate.get(dateStr);
    }

    for (const a of assignments || []) {
      if (!a.staff || !a.shifts) continue; // defensive — every real clinical row has both
      const activityName = activityNameById.get(a.theatre_activities?.activity_id);
      const locationName = a.locations?.name;
      if (!activityName || !locationName) continue; // duty-type picks never reach here (see assignStaffFortnight)
      const person = ensurePerson(a.staff_id, a.staff.name, a.staff.rank);
      const day = ensureDay(person, a.date);
      day.segments.push({
        location: locationName,
        activity: activityName,
        start: (a.shifts.start_time || '').slice(0, 5),
        end: (a.shifts.end_time || '').slice(0, 5),
      });
    }

    for (const av of availability || []) {
      if (av.available !== false) continue;
      const staffRow = (staffList || []).find(s => s.staff_id === av.staff_id);
      if (!staffRow) continue;
      const person = ensurePerson(av.staff_id, staffRow.name, staffRow.rank);
      const day = ensureDay(person, av.date);
      day.leaveCode = leaveTypeById.get(av.leave_type_id)?.code || 'Leave';
    }

    for (const d of duties || []) {
      if (!d.staff) continue;
      const person = ensurePerson(d.staff_id, d.staff.name, d.staff.rank);
      const day = ensureDay(person, d.date);
      day.dutyLabels.push(dutyLabelByKey.get(d.duty_type) || d.duty_type);
    }

    const dateLabels = dates.map(d => `${DAY_LABELS_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);

    const section = (rankFilter) => Array.from(byStaff.values())
      .filter(p => rankFilter(p.rank))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => ({
        name: p.name,
        days: dateStrs.map(ds => p.byDate.get(ds) || { segments: [], leaveCode: null, dutyLabels: [] }),
      }));

    return {
      data: {
        weekStart: dateStrs[0],
        weekEnd: dateStrs[6],
        dateLabels,
        // "Intern" keeps its own labeled section by that literal name (a
        // universal enough term to single out regardless of department);
        // every other rank splits on requires_supervision. A rank not
        // found in this department's list (shouldn't happen — see the
        // composite FK in migrations/2026-08-31_staff_ranks.sql) defaults
        // to the "rmo" section rather than silently vanishing from the export.
        consultants: section(r => requiresSupervisionByRank.get(r) === false),
        rmo: section(r => r !== 'intern' && requiresSupervisionByRank.get(r) !== false),
        interns: section(r => r === 'intern'),
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: err };
  }
}

// ============================================================
// SHIFT PATTERN RULES
// ============================================================
// A rule occupies a fixed 7-day window ending on the day a shift is being
// assigned: shift_1_id = 6 days before, shift_2_id = 5 days before, ...
// shift_6_id = yesterday, shift_7_id = the shift being assigned today (see
// migrations/2026-08-23_shift_pattern_rules_7day.sql — this used to be a
// 4-day window). NULL in any position is the "Any Shift" wildcard — a rule
// that only cares about the most recent 1-6 days leaves its leading
// position(s) null.

export async function getShiftPatternRules(departmentId) {
  console.log('getShiftPatternRules called', departmentId);

  try {
    const { data, error } = await supabase
      .from('shift_pattern_rules')
      .select(
        '*, shift_1:shift_1_id(shift_id, name), shift_2:shift_2_id(shift_id, name), shift_3:shift_3_id(shift_id, name), shift_4:shift_4_id(shift_id, name), shift_5:shift_5_id(shift_id, name), shift_6:shift_6_id(shift_id, name), shift_7:shift_7_id(shift_id, name)'
      )
      .eq('department_id', departmentId)
      .order('created_at');

    return { data: data || [], error };
  } catch (err) {
    console.error('getShiftPatternRules error:', err);
    return { data: [], error: err };
  }
}

export async function addShiftPatternRule(departmentId, shiftIds, action, description) {
  console.log('addShiftPatternRule called', departmentId, shiftIds, action, description);
  const [shift1, shift2, shift3, shift4, shift5, shift6, shift7] = shiftIds;

  try {
    const { data, error } = await supabase
      .from('shift_pattern_rules')
      .insert([
        {
          department_id: departmentId,
          shift_1_id: shift1 || null,
          shift_2_id: shift2 || null,
          shift_3_id: shift3 || null,
          shift_4_id: shift4 || null,
          shift_5_id: shift5 || null,
          shift_6_id: shift6 || null,
          shift_7_id: shift7 || null,
          rule_action: action,
          description,
        },
      ])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    console.error('addShiftPatternRule error:', err);
    return { data: null, error: err };
  }
}

export async function updateShiftPatternRule(ruleId, shiftIds, action, description) {
  console.log('updateShiftPatternRule called', ruleId, shiftIds, action, description);
  const [shift1, shift2, shift3, shift4, shift5, shift6, shift7] = shiftIds;

  try {
    const { data, error } = await supabase
      .from('shift_pattern_rules')
      .update({
        shift_1_id: shift1 || null,
        shift_2_id: shift2 || null,
        shift_3_id: shift3 || null,
        shift_4_id: shift4 || null,
        shift_5_id: shift5 || null,
        shift_6_id: shift6 || null,
        shift_7_id: shift7 || null,
        rule_action: action,
        description,
      })
      .eq('rule_id', ruleId)
      .select()
      .single();

    return { data, error };
  } catch (err) {
    console.error('updateShiftPatternRule error:', err);
    return { data: null, error: err };
  }
}

export async function deleteShiftPatternRule(ruleId) {
  console.log('deleteShiftPatternRule called', ruleId);

  try {
    const { error } = await supabase
      .from('shift_pattern_rules')
      .delete()
      .eq('rule_id', ruleId);

    return { error };
  } catch (err) {
    console.error('deleteShiftPatternRule error:', err);
    return { error: err };
  }
}

// Wipes every shift pattern rule for a department in one go — for
// starting over rather than deleting a demo/test rule set one row at a
// time. Scoped by department_id so it can never touch another department's
// rules.
export async function deleteAllShiftPatternRules(departmentId) {
  console.log('deleteAllShiftPatternRules called', departmentId);

  try {
    const { error } = await supabase
      .from('shift_pattern_rules')
      .delete()
      .eq('department_id', departmentId);

    return { error };
  } catch (err) {
    console.error('deleteAllShiftPatternRules error:', err);
    return { error: err };
  }
}

// Checks a staff member's 6 previous days plus the shift about to be
// assigned against the department's shift pattern rules, and returns the
// most specific (most non-wildcard positions) matching rule's action. A day
// with no staff_assignments row (a genuine day off) is treated as the
// "Day Off" shift seeded per-department — see
// migrations/2026-08-16_shift_pattern_rules.sql. Defaults to ALLOW when no
// rule matches: patterns are opt-in restrictions, not a whitelist.
export async function validateShiftAssignment(staffId, date, shiftId, departmentId) {
  console.log('validateShiftAssignment called', staffId, date, shiftId, departmentId);
  const allow = { valid: true, action: 'ALLOW', rule: null };

  try {
    const dateStr = toLocalDateStr(date);
    const lookbackStart = new Date(date);
    lookbackStart.setDate(lookbackStart.getDate() - 6);
    const lookbackStartStr = toLocalDateStr(lookbackStart);

    const [rulesRes, assignmentsRes, offShiftRes] = await Promise.all([
      supabase.from('shift_pattern_rules').select('*').eq('department_id', departmentId),
      supabase
        .from('staff_assignments')
        .select('date, shift_id')
        .eq('department_id', departmentId)
        .eq('staff_id', staffId)
        .gte('date', lookbackStartStr)
        .lt('date', dateStr),
      supabase.from('shifts').select('shift_id').eq('department_id', departmentId).eq('name', 'Day Off').maybeSingle(),
    ]);

    if (rulesRes.error) throw rulesRes.error;
    if (assignmentsRes.error) throw assignmentsRes.error;

    const rules = rulesRes.data || [];
    if (rules.length === 0) return { data: allow, error: null };

    const offShiftId = offShiftRes.data?.shift_id ?? null;
    const shiftByDate = new Map((assignmentsRes.data || []).map(a => [a.date, a.shift_id]));

    const sequence = [6, 5, 4, 3, 2, 1].map(daysAgo => {
      const d = new Date(date);
      d.setDate(d.getDate() - daysAgo);
      const dStr = toLocalDateStr(d);
      return shiftByDate.has(dStr) ? shiftByDate.get(dStr) : offShiftId;
    });
    sequence.push(shiftId);

    let best = null;
    let bestSpecificity = -1;
    for (const rule of rules) {
      const cols = [rule.shift_1_id, rule.shift_2_id, rule.shift_3_id, rule.shift_4_id, rule.shift_5_id, rule.shift_6_id, rule.shift_7_id];
      const isMatch = cols.every((col, i) => col === null || col === sequence[i]);
      if (!isMatch) continue;
      const specificity = cols.filter(c => c !== null).length;
      if (specificity > bestSpecificity) {
        best = rule;
        bestSpecificity = specificity;
      }
    }

    if (!best) return { data: allow, error: null };

    const rule = { description: best.description, rule_action: best.rule_action };
    if (best.rule_action === 'ALLOW') return { data: { valid: true, action: 'ALLOW', rule }, error: null };
    return { data: { valid: false, action: best.rule_action, rule }, error: null };
  } catch (err) {
    console.error('validateShiftAssignment error:', err);
    // Fail open — a broken rules lookup shouldn't block a genuine assignment.
    return { data: allow, error: err };
  }
}

// ============================================================
// AUTH / MEMBERSHIPS
// ============================================================

export async function signIn(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  } catch (err) {
    console.error('signIn error:', err);
    return { data: null, error: err };
  }
}

export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    return { error };
  } catch (err) {
    console.error('signOut error:', err);
    return { error: err };
  }
}

// ---- Two-factor authentication (TOTP via Supabase Auth's built-in MFA) ----
// No secrets of our own to store or verify — GoTrue holds the TOTP secret
// and does the code check server-side; these just wrap its `auth.mfa` API
// in the same { data, error } shape as everything else here.

// currentLevel/nextLevel are 'aal1' (password only) or 'aal2' (password +
// a verified second factor). nextLevel > currentLevel is the signal App.js
// uses to show the MfaChallenge step-up screen after a plain password
// sign-in for someone who has 2FA turned on.
export async function getMfaAssuranceLevel() {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return { data, error };
  } catch (err) {
    console.error('getMfaAssuranceLevel error:', err);
    return { data: null, error: err };
  }
}

export async function listMfaFactors() {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors();
    return { data, error };
  } catch (err) {
    console.error('listMfaFactors error:', err);
    return { data: null, error: err };
  }
}

// Starts enrolling a new TOTP factor — returns an id to challenge/verify
// against, plus a ready-to-render QR code (data: URI) and the plain-text
// secret as a manual-entry fallback. The factor sits unverified (and
// useless for sign-in) until confirmMfaEnrollment succeeds.
export async function enrollMfaFactor() {
  try {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    return { data, error };
  } catch (err) {
    console.error('enrollMfaFactor error:', err);
    return { data: null, error: err };
  }
}

// Confirms a freshly enrolled factor (or answers a step-up challenge at
// sign-in) with the 6-digit code from the authenticator app. Wraps the
// challenge+verify pair Supabase splits into two calls, since every caller
// here needs both anyway.
export async function verifyMfaCode(factorId, code) {
  try {
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;

    const { data, error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
    return { data, error };
  } catch (err) {
    console.error('verifyMfaCode error:', err);
    return { data: null, error: err };
  }
}

export async function unenrollMfaFactor(factorId) {
  try {
    const { data, error } = await supabase.auth.mfa.unenroll({ factorId });
    return { data, error };
  } catch (err) {
    console.error('unenrollMfaFactor error:', err);
    return { data: null, error: err };
  }
}

// Every active staff row linked to the current auth session — one row per
// department the signed-in person belongs to (staff is already the
// per-person-per-department table, so "multi-department" just means more
// than one row sharing the same user_id; no separate join table needed).
// Each membership carries its own `role` ('staff' | 'officer'), since a
// person can be an officer in one department and plain staff in another.
// A super admin (profiles.is_super_admin) isn't necessarily on any `staff`
// row at all — the flag grants them officer-level DB access to every
// department regardless (see is_department_officer in
// migrations/2026-08-21_super_admin.sql), including ones added after they
// were made an admin. So a super admin's "memberships" here are synthesized
// from every department that exists, not looked up from `staff`. Both
// branches return the same flat shape so callers (App.js, DepartmentSwitcher)
// don't need to know which case they're in.
export async function getMyMemberships() {
  console.log('getMyMemberships called');

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) return { data: [], isSuperAdmin: false, error: null };

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (profile?.is_super_admin) {
      const { data, error } = await supabase
        .from('departments')
        .select('department_id, name')
        .order('name');
      if (error) throw error;

      const memberships = (data || []).map(d => ({
        staff_id: null,
        department_id: d.department_id,
        department_name: d.name,
        role: 'officer',
        preferredView: 'officer',
      }));

      console.log('Memberships (super admin):', memberships.length);
      return { data: memberships, isSuperAdmin: true, error: null };
    }

    const { data, error } = await supabase
      .from('staff')
      .select('staff_id, department_id, name, rank, role, preferred_view, departments(name)')
      .eq('user_id', user.id)
      .eq('active', true)
      .order('name');

    if (error) throw error;

    const memberships = (data || []).map(s => ({
      staff_id: s.staff_id,
      department_id: s.department_id,
      department_name: s.departments?.name,
      role: s.role,
      preferredView: s.preferred_view,
    }));

    console.log('Memberships:', memberships.length);
    return { data: memberships, isSuperAdmin: false, error: null };
  } catch (err) {
    console.error('getMyMemberships error:', err);
    return { data: [], isSuperAdmin: false, error: err };
  }
}

// Lets a staff member edit specific fields on their own `staff` row
// (phone, email, coffee_order, activity_restrictions — the same four
// fields staffRosterView.jsx already exposes as self-service) without
// touching fte/payroll_number/role/user_id/rank/active, which stay
// officer-only. Routed through SECURITY DEFINER RPCs rather than a table
// policy since RLS can't restrict by column, only by row. See
// migrations/2026-08-21_rls_policies_self_service.sql. Each mirrors the
// equivalent officer-side function above (updateStaffPhone, etc.) in
// return shape, so callers can swap one for the other without changes.
export async function updateMyPhone(staffId, phone) {
  console.log('updateMyPhone called', staffId, phone);
  try {
    const { error } = await supabase.rpc('update_my_phone', { p_staff_id: staffId, p_phone: phone || null });
    return { error };
  } catch (err) {
    console.error('updateMyPhone error:', err);
    return { error: err };
  }
}

export async function updateMyEmail(staffId, email) {
  console.log('updateMyEmail called', staffId, email);
  try {
    const { error } = await supabase.rpc('update_my_email', { p_staff_id: staffId, p_email: email || null });
    return { error };
  } catch (err) {
    console.error('updateMyEmail error:', err);
    return { error: err };
  }
}

export async function updateMyCoffeeOrder(staffId, coffeeOrder) {
  console.log('updateMyCoffeeOrder called', staffId, coffeeOrder);
  try {
    const { error } = await supabase.rpc('update_my_coffee_order', { p_staff_id: staffId, p_coffee_order: coffeeOrder || null });
    return { error };
  } catch (err) {
    console.error('updateMyCoffeeOrder error:', err);
    return { error: err };
  }
}

export async function updateMyActivityRestrictions(staffId, activityNames) {
  console.log('updateMyActivityRestrictions called', staffId, activityNames);
  try {
    const { error } = await supabase.rpc('update_my_activity_restrictions', { p_staff_id: staffId, p_activity_names: activityNames });
    return { error };
  } catch (err) {
    console.error('updateMyActivityRestrictions error:', err);
    return { error: err };
  }
}

// Persists which view (officer or staff) an officer wants to land on next
// time they log into this department — see
// migrations/2026-08-22_officer_preferred_view.sql. A no-op for super
// admins (staff_id is null there; the RPC's WHERE clause simply matches no
// row), which is fine — the toggle in App.js still works for the rest of
// their session, it just doesn't persist across logins.
export async function updateMyPreferredView(staffId, view) {
  console.log('updateMyPreferredView called', staffId, view);
  try {
    const { error } = await supabase.rpc('update_my_preferred_view', { p_staff_id: staffId, p_view: view });
    return { error };
  } catch (err) {
    console.error('updateMyPreferredView error:', err);
    return { error: err };
  }
}

// Creates a brand-new, empty department — nothing else references its
// department_id yet, so staff/roster/etc. are naturally blank until
// populated. Gated by the departments_insert_super_admin RLS policy (see
// migrations/2026-08-22_departments_insert_policy.sql), which only a super
// admin can satisfy; a non-super-admin's insert is rejected by Postgres
// itself, surfacing here as `error`.
export async function createDepartment(name) {
  console.log('createDepartment called', name);
  try {
    const { data, error } = await supabase
      .from('departments')
      .insert({ department_id: crypto.randomUUID(), name })
      .select('department_id, name')
      .single();

    return { data, error };
  } catch (err) {
    console.error('createDepartment error:', err);
    return { data: null, error: err };
  }
}

// Invites a new staff login via the invite-staff Edge Function (creating an
// auth user requires the service_role key, which must never reach the
// browser — see supabase/functions/invite-staff/index.ts). The function
// re-checks officer status itself server-side; this call fails harmlessly
// if the caller isn't actually an officer for departmentId.
// staffId (optional): links this invite to an already-existing, unlinked
// staff row (see the "Invite" action on a "Not linked" row in
// StaffAccountsTab) instead of creating a new one — see
// supabase/functions/invite-staff/index.ts for the two modes.
export async function inviteStaff(departmentId, name, email, rank, role, staffId = null) {
  console.log('inviteStaff called', departmentId, name, email, rank, role, staffId);

  try {
    const { data, error } = await supabase.functions.invoke('invite-staff', {
      body: {
        departmentId,
        name,
        email,
        rank,
        role,
        staffId,
        // Same redirect the "Forgot password" flow uses (Login.jsx) — without
        // it, Supabase falls back to the project's default Site URL, which
        // may not point at this deployment, and the invite link never lands
        // on the SetPassword screen.
        redirectTo: window.location.origin + window.location.pathname,
      },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    return { data: data?.data ?? data, error: null };
  } catch (err) {
    console.error('inviteStaff error:', err);
    return { data: null, error: err };
  }
}

// Fallback for when the invite/reinvite email gets spam-filtered: sets a
// random temporary password on an already-linked account (server-side —
// see supabase/functions/generate-temp-password/index.ts) so the officer
// can relay it out-of-band (WhatsApp, SMS, in person). Also flags the
// account so the recipient is forced through SetPassword on next login
// (see my_must_reset_password/clear_my_must_reset_password below).
export async function generateTempPassword(departmentId, staffId) {
  console.log('generateTempPassword called', departmentId, staffId);

  try {
    const { data, error } = await supabase.functions.invoke('generate-temp-password', {
      body: { departmentId, staffId },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    return { data: data?.data ?? data, error: null };
  } catch (err) {
    console.error('generateTempPassword error:', err);
    return { data: null, error: err };
  }
}

// Whether the current session's account was just given a temporary
// password by an officer and hasn't chosen its own yet — checked by App.js
// alongside the invite/recovery-link check to force SetPassword either way.
// Goes through a SECURITY DEFINER function rather than a direct table read
// since `profiles` has no RLS policies (see
// migrations/2026-08-27_must_reset_password.sql).
export async function getMustResetPassword() {
  try {
    const { data, error } = await supabase.rpc('my_must_reset_password');
    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Clears the flag above once the account holder has set their own
// password via SetPassword.
export async function clearMustResetPassword() {
  try {
    const { error } = await supabase.rpc('clear_my_must_reset_password');
    return { error };
  } catch (err) {
    return { error: err };
  }
}
