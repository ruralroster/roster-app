import { createClient } from '@supabase/supabase-js';
import { DEFAULT_FTE, computeFairnessRatio } from './availabilityUtils';
import { toLocalDateStr } from './dateUtils';

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
    const [locRes, activitiesRes, shiftsRes, staffRes, leaveTypesRes, departmentRes] = await Promise.all([
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
    ]);

    console.log('Locations:', locRes.data?.length || 0, locRes.error);
    console.log('Activities:', activitiesRes.data?.length || 0, activitiesRes.error);
    console.log('Shifts:', shiftsRes.data?.length || 0, shiftsRes.error);
    console.log('Staff:', staffRes.data?.length || 0, staffRes.error);
    console.log('Leave types:', leaveTypesRes.data?.length || 0, leaveTypesRes.error);
    console.log('Department:', departmentRes.data, departmentRes.error);

    return {
      locations: locRes.data || [],
      activities: activitiesRes.data || [],
      shifts: shiftsRes.data || [],
      staff: staffRes.data || [],
      leaveTypes: leaveTypesRes.data || [],
      department: departmentRes.data || null,
      errors: [locRes.error, activitiesRes.error, shiftsRes.error, staffRes.error, leaveTypesRes.error, departmentRes.error].filter(Boolean),
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

// ============================================================
// STAFF ASSIGNMENTS
// ============================================================

export async function getStaffAssignmentsForDate(departmentId, date) {
  console.log('getStaffAssignmentsForDate called', departmentId, date);
  const dateStr = toLocalDateStr(date);
  
  try {
    const { data, error } = await supabase
      .from('staff_assignments')
      .select('*, staff(name, rank, coffee_order), locations(name), shifts(name, start_time, end_time, session)')
      .eq('department_id', departmentId)
      .eq('date', dateStr);

    console.log('Staff assignments:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getStaffAssignmentsForDate error:', err);
    return { data: [], error: err };
  }
}

export async function createStaffAssignment(departmentId, date, locationId, staffId, shiftId, role, fatigueOverrideReason = null, theatreActivityId = null) {
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
        },
      ])
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function updateStaffAssignment(assignmentId, staffId, role, shiftId, fatigueOverrideReason = null, theatreActivityId = null) {
  try {
    const { data, error } = await supabase
      .from('staff_assignments')
      .update({ staff_id: staffId, role, shift_id: shiftId, fatigue_override_reason: fatigueOverrideReason, theatre_activity_id: theatreActivityId })
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
  const normalizedStaffId = staffId ? staffId : null;

  try {
    // onConflict must target the table's actual unique constraint
    // (date, duty_type) — without it, upsert() defaults to the primary key
    // (duty_id, always a fresh UUID), so it attempts a plain INSERT and
    // errors out on the constraint instead of updating the existing row.
    const { data, error } = await supabase
      .from('duty_assignments')
      .upsert(
        [
          {
            department_id: departmentId,
            date: dateStr,
            duty_type: dutyType,
            staff_id: normalizedStaffId,
          },
        ],
        { onConflict: 'date,duty_type' }
      )
      .select();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
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

// Same past-changes-too caveat as updateLocationName/updateActivityTypeName
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

export async function createLocation(departmentId, name) {
  try {
    const { data, error } = await supabase
      .from('locations')
      .insert([{ department_id: departmentId, name }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Renames a location in place. Every theatre_activity/staff_assignment that
// references this location_id joins the live `locations` row for display,
// so this changes what past dates show too — correct for fixing a mislabel,
// but not the right tool for "this location has a new name going forward":
// deactivate the old one and create a new one for that instead.
export async function updateLocationName(locationId, name) {
  try {
    const { data, error } = await supabase
      .from('locations')
      .update({ name })
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

export async function createActivityType(departmentId, name) {
  try {
    const { data, error } = await supabase
      .from('activity_types')
      .insert([{ department_id: departmentId, name }])
      .select()
      .single();

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Renames an activity type in place — same past-changes-too caveat as
// updateLocationName: every theatre_activity referencing this activity_id
// joins the live row, so this rewrites how already-past dates display it.
export async function updateActivityTypeName(activityId, name) {
  try {
    const { data, error } = await supabase
      .from('activity_types')
      .update({ name })
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
      .select('*, locations(name), shifts(name, start_time, end_time, session)')
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
    const consultants = staffList.filter(s => s.rank === 'consultant');
    const registrars = staffList.filter(s => s.rank.includes('trainee'));

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

export async function createTheatreActivity(departmentId, date, locationId, shiftId, activityId) {
  console.log('createTheatreActivity called', { departmentId, date, locationId, shiftId, activityId });

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

    const [staffRes, assignmentsRes, dutyRes] = await Promise.all([
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
    ]);

    if (staffRes.error) throw staffRes.error;
    if (assignmentsRes.error) throw assignmentsRes.error;
    if (dutyRes.error) throw dutyRes.error;

    const staffList = staffRes.data || [];
    const onCallDuties = (dutyRes.data || []).filter(
      d => d.duty_type === 'first_on_call' || d.duty_type === 'second_on_call'
    );

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
// on what they worked the days before:
//  - postNightRestStaffIds: worked a Night-session shift the day before —
//    hard rest day, cannot be assigned anything on `date`.
//  - nightCooldownStaffIds: two days out from their last night shift — the
//    mandatory rest day has passed, but they still can't go back onto a Day
//    shift for one more day (Night shifts are unaffected).
//  - fatigueRiskStaffIds: was on first/second on-call overnight the day
//    before — not blocked, just flagged as a fatigue risk when assigned.
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

    const [assignmentsRes, dutyRes] = await Promise.all([
      supabase
        .from('staff_assignments')
        .select('staff_id, date, shifts(session)')
        .eq('department_id', departmentId)
        .gte('date', lookbackStartStr)
        .lt('date', dateStr),
      supabase
        .from('duty_assignments')
        .select('staff_id, duty_type')
        .eq('department_id', departmentId)
        .eq('date', yesterdayStr),
    ]);

    if (assignmentsRes.error) throw assignmentsRes.error;
    if (dutyRes.error) throw dutyRes.error;

    const lastNightDateByStaff = new Map();
    (assignmentsRes.data || []).forEach(a => {
      if (a.shifts?.session !== 'night') return;
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

    const fatigueRiskStaffIds = new Set(
      (dutyRes.data || [])
        .filter(d => d.duty_type === 'first_on_call' || d.duty_type === 'second_on_call')
        .map(d => d.staff_id)
    );

    return { data: { postNightRestStaffIds, nightCooldownStaffIds, fatigueRiskStaffIds }, error: null };
  } catch (err) {
    console.error('getStaffFatigueStatus error:', err);
    return { data: empty, error: err };
  }
}

// ============================================================
// CALENDAR ALLOCATION STATUS
// ============================================================

// For each date in range, classifies staffing coverage across that day's
// theatre activities (each activity has exactly two role slots: consultant
// and registrar):
//   'none'   - no theatre activities exist for that date at all
//   'red'    - at least one activity has nobody assigned to either role
//   'yellow' - every activity has at least one role filled, but not all
//              activities have both roles filled
//   'green'  - every activity has both roles filled
export async function getAllocationStatusForRange(departmentId, startDate, endDate) {
  console.log('getAllocationStatusForRange called', departmentId, startDate, endDate);

  try {
    const startStr = toLocalDateStr(startDate);
    const endStr = toLocalDateStr(endDate);

    const [theatreRes, assignRes] = await Promise.all([
      supabase
        .from('theatre_activities')
        .select('date, location_id')
        .eq('department_id', departmentId)
        .gte('date', startStr)
        .lte('date', endStr),
      supabase
        .from('staff_assignments')
        .select('date, location_id, role')
        .eq('department_id', departmentId)
        .gte('date', startStr)
        .lte('date', endStr),
    ]);

    if (theatreRes.error) throw theatreRes.error;
    if (assignRes.error) throw assignRes.error;

    const locationsByDate = new Map(); // date -> Set(location_id)
    (theatreRes.data || []).forEach(ta => {
      if (!locationsByDate.has(ta.date)) locationsByDate.set(ta.date, new Set());
      locationsByDate.get(ta.date).add(ta.location_id);
    });

    const rolesByDateLocation = new Map(); // `${date}|${location_id}` -> Set(role)
    (assignRes.data || []).forEach(a => {
      const key = `${a.date}|${a.location_id}`;
      if (!rolesByDateLocation.has(key)) rolesByDateLocation.set(key, new Set());
      rolesByDateLocation.get(key).add(a.role);
    });

    const statusByDate = {};
    locationsByDate.forEach((locationIds, date) => {
      let hasEmptyActivity = false;
      let hasIncompleteActivity = false;

      locationIds.forEach(locationId => {
        const roles = rolesByDateLocation.get(`${date}|${locationId}`) || new Set();
        if (roles.size === 0) hasEmptyActivity = true;
        else if (roles.size < 2) hasIncompleteActivity = true;
      });

      if (hasEmptyActivity) statusByDate[date] = 'red';
      else if (hasIncompleteActivity) statusByDate[date] = 'yellow';
      else statusByDate[date] = 'green';
    });

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
// member's rank (consultant -> consultant, *trainee* -> registrar; any other
// rank has nothing to volunteer for) is still unfilled, they're not
// activity-restricted from it, and they've explicitly marked themselves
// available that date (an unconfirmed day doesn't count, same rule as
// officer-side assignment).
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
        .select('location_id, date, role')
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
    const roleForRank = rank === 'consultant' ? 'consultant' : rank.includes('trainee') ? 'registrar' : null;
    if (!roleForRank) return { data: [], error: null };

    const restrictions = staffRes.data?.activity_restrictions || [];

    const filledRolesByKey = new Map(); // `${date}|${location_id}` -> Set(role)
    (assignRes.data || []).forEach(a => {
      const key = `${a.date}|${a.location_id}`;
      if (!filledRolesByKey.has(key)) filledRolesByKey.set(key, new Set());
      filledRolesByKey.get(key).add(a.role);
    });

    const availableDates = new Set(
      (availRes.data || []).filter(r => r.available === true).map(r => r.date)
    );

    const alreadyVolunteered = new Set(
      (volunteerRes.data || []).map(v => `${v.theatre_activity_id}|${v.role}`)
    );

    const opportunities = (theatreRes.data || [])
      .filter(ta => {
        const filledRoles = filledRolesByKey.get(`${ta.date}|${ta.location_id}`) || new Set();
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

// All staff_assignments for a department across a Mon-Sun week, with the
// staff's name/payroll_number and shift start/end times attached — the data
// source for the payroll Excel export. Mirrors getAllOnCallAssignmentsForWeek's
// "whole department, date range" shape rather than getStaffAssignmentsForWeek's
// single-staff one, since payroll needs every staff member at once.
export async function getAllStaffAssignmentsForRange(departmentId, rangeStartDate, numDays) {
  console.log('getAllStaffAssignmentsForRange called', departmentId, rangeStartDate, numDays);
  const startStr = toLocalDateStr(rangeStartDate);
  const endDate = new Date(rangeStartDate);
  endDate.setDate(endDate.getDate() + numDays - 1);
  const endStr = toLocalDateStr(endDate);

  try {
    const { data, error } = await supabase
      .from('staff_assignments')
      .select('*, staff(name, payroll_number), locations(name), shifts(name, start_time, end_time, session)')
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

// ============================================================
// FORTNIGHT VIEW — staff-to-shift allocation (no location/role, unlike
// staff_assignments; see migrations/2026-08-15_fortnight_allocations.sql)
// ============================================================

// Whole department's shift allocations across a date range, for the
// fortnight grid's "who else is on" brief view and the department-wide list
// shown in the shift-picker modal.
export async function getStaffShiftAllocationsForRange(departmentId, startDate, endDate) {
  console.log('getStaffShiftAllocationsForRange called', departmentId, startDate, endDate);
  const startStr = toLocalDateStr(startDate);
  const endStr = toLocalDateStr(endDate);

  try {
    const { data, error } = await supabase
      .from('staff_shift_allocations')
      .select('*, staff(name, rank, fte), shifts(name, start_time, end_time, session)')
      .eq('department_id', departmentId)
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date');

    console.log('Staff shift allocations for range:', data?.length || 0, error);
    return { data: data || [], error };
  } catch (err) {
    console.error('getStaffShiftAllocationsForRange error:', err);
    return { data: [], error: err };
  }
}

// One shift per staff member per day — upsert on (staff_id, date) so
// re-picking a shift for a day they're already allocated replaces it rather
// than stacking a second row.
export async function upsertStaffShiftAllocation(departmentId, staffId, date, shiftId) {
  console.log('upsertStaffShiftAllocation called', departmentId, staffId, date, shiftId);
  const dateStr = toLocalDateStr(date);

  try {
    const { data, error } = await supabase
      .from('staff_shift_allocations')
      .upsert(
        [{ department_id: departmentId, staff_id: staffId, date: dateStr, shift_id: shiftId }],
        { onConflict: 'staff_id,date' }
      )
      .select('*, staff(name, rank, fte), shifts(name, start_time, end_time, session)')
      .single();

    return { data, error };
  } catch (err) {
    console.error('upsertStaffShiftAllocation error:', err);
    return { data: null, error: err };
  }
}

export async function deleteStaffShiftAllocation(staffId, date) {
  console.log('deleteStaffShiftAllocation called', staffId, date);
  const dateStr = toLocalDateStr(date);

  try {
    const { error } = await supabase
      .from('staff_shift_allocations')
      .delete()
      .eq('staff_id', staffId)
      .eq('date', dateStr);

    return { error };
  } catch (err) {
    console.error('deleteStaffShiftAllocation error:', err);
    return { error: err };
  }
}

// ============================================================
// SHIFT PATTERN RULES
// ============================================================
// A rule occupies a fixed 4-day window ending on the day a shift is being
// assigned: shift_1_id = 3 days before, shift_2_id = 2 days before,
// shift_3_id = yesterday, shift_4_id = the shift being assigned today.
// NULL in any position is the "Any Shift" wildcard — a rule that only
// cares about the most recent 1-3 days leaves its leading position(s) null.

export async function getShiftPatternRules(departmentId) {
  console.log('getShiftPatternRules called', departmentId);

  try {
    const { data, error } = await supabase
      .from('shift_pattern_rules')
      .select(
        '*, shift_1:shift_1_id(shift_id, name), shift_2:shift_2_id(shift_id, name), shift_3:shift_3_id(shift_id, name), shift_4:shift_4_id(shift_id, name)'
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
  const [shift1, shift2, shift3, shift4] = shiftIds;

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
  const [shift1, shift2, shift3, shift4] = shiftIds;

  try {
    const { data, error } = await supabase
      .from('shift_pattern_rules')
      .update({
        shift_1_id: shift1 || null,
        shift_2_id: shift2 || null,
        shift_3_id: shift3 || null,
        shift_4_id: shift4 || null,
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

// Checks a staff member's 3 previous days plus the shift about to be
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
    lookbackStart.setDate(lookbackStart.getDate() - 3);
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

    const sequence = [3, 2, 1].map(daysAgo => {
      const d = new Date(date);
      d.setDate(d.getDate() - daysAgo);
      const dStr = toLocalDateStr(d);
      return shiftByDate.has(dStr) ? shiftByDate.get(dStr) : offShiftId;
    });
    sequence.push(shiftId);

    let best = null;
    let bestSpecificity = -1;
    for (const rule of rules) {
      const cols = [rule.shift_1_id, rule.shift_2_id, rule.shift_3_id, rule.shift_4_id];
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
    if (!user) return { data: [], error: null };

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
      }));

      console.log('Memberships (super admin):', memberships.length);
      return { data: memberships, error: null };
    }

    const { data, error } = await supabase
      .from('staff')
      .select('staff_id, department_id, name, rank, role, departments(name)')
      .eq('user_id', user.id)
      .eq('active', true)
      .order('name');

    if (error) throw error;

    const memberships = (data || []).map(s => ({
      staff_id: s.staff_id,
      department_id: s.department_id,
      department_name: s.departments?.name,
      role: s.role,
    }));

    console.log('Memberships:', memberships.length);
    return { data: memberships, error: null };
  } catch (err) {
    console.error('getMyMemberships error:', err);
    return { data: [], error: err };
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

// Invites a new staff login via the invite-staff Edge Function (creating an
// auth user requires the service_role key, which must never reach the
// browser — see supabase/functions/invite-staff/index.ts). The function
// re-checks officer status itself server-side; this call fails harmlessly
// if the caller isn't actually an officer for departmentId.
export async function inviteStaff(departmentId, name, email, rank, role) {
  console.log('inviteStaff called', departmentId, name, email, rank, role);

  try {
    const { data, error } = await supabase.functions.invoke('invite-staff', {
      body: { departmentId, name, email, rank, role },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    return { data: data?.data ?? data, error: null };
  } catch (err) {
    console.error('inviteStaff error:', err);
    return { data: null, error: err };
  }
}
