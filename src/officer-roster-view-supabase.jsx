import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import StaffProfilesTab from './StaffProfilesTab';
import StaffAccountsTab from './StaffAccountsTab';
import StaffAvailabilityTab, { RANK_OPTIONS } from './StaffAvailabilityTab';
import ShiftPatternRulesUI from './ShiftPatternRulesUI';
import CaseMixReport from './CaseMixReport';
import FairnessReport from './FairnessReport';
import CollapsibleSection from './CollapsibleSection';
import { toLocalDateStr } from './dateUtils';
import { ChevronLeft, ChevronRight, X, AlertCircle, Loader } from 'lucide-react';
import { createTheatreActivity,
  initializeDepartment,
  getTheatreActivitiesForDate,
  getStaffAssignmentsForDate,
  getDutyAssignmentsForDate,
  getStaffAvailabilityForDate,
  createStaffAssignment,
  updateStaffAssignment,
  deleteStaffAssignment,
  updateDutyAssignment,
  updateTheatreActivity,
  updateTheatreActivityTimes,
  copyLastWeekActivities,
  createShift,
  updateShift,
  deactivateShift,
  reactivateShift,
  createDutyType,
  updateDutyType,
  deactivateDutyType,
  reactivateDutyType,
  syncDutyOnCallActivity,
  createLocation,
  updateLocation,
  updateLocationAllowedActivities,
  deactivateLocation,
  reactivateLocation,
  createActivityType,
  updateActivityTypeName,
  deleteActivityType,
  getSortedStaffForActivity,
  deleteTheatreActivity,
  getStaffFatigueStatus,
  getStaffList,
  getAllocationStatusForRange,
  getVolunteerRequestsForActivities,
  clearVolunteerRequestsForRole,
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  updateStaffAssignmentLeaveCode,
  updateDepartmentPayCentreNumber,
  getAllStaffAssignmentsForRange,
  assignStaffFortnight,
  validateShiftAssignment,
} from './supabaseClient';
import { downloadPayrollExcel, getMondayOfWeek } from './payrollExport';
import { getSessionGroups, SESSION_GROUP_ORDER, SESSION_GROUP_LABELS, SESSION_DEFAULT_TIMES } from './shiftSessionUtils';
import { formatFte, DEFAULT_FTE } from './availabilityUtils';

const CALENDAR_WEEKS_SHOWN = 4;
const CALENDAR_DAYS_SHOWN = CALENDAR_WEEKS_SHOWN * 7;

const EMPTY_FATIGUE_STATUS = { postNightRestStaffIds: new Set(), nightCooldownStaffIds: new Set(), fatigueRiskStaffIds: new Set() };

const ALLOCATION_STATUS_STYLES = {
  none: { classes: 'bg-white border-gray-200 text-gray-900 hover:border-blue-500 hover:bg-blue-50', swatch: 'bg-white border-gray-300', label: 'No activities' },
  green: { classes: 'bg-green-500 border-green-600 text-white hover:bg-green-600', swatch: 'bg-green-500 border-green-600', label: 'Fully allocated' },
  yellow: { classes: 'bg-yellow-400 border-yellow-500 text-gray-900 hover:bg-yellow-500', swatch: 'bg-yellow-400 border-yellow-500', label: 'Partially allocated' },
  red: { classes: 'bg-red-500 border-red-600 text-white hover:bg-red-600', swatch: 'bg-red-500 border-red-600', label: 'Unallocated activities' },
};

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

// eslint-disable-next-line no-unused-vars -- staffId (the signed-in officer's own staff_id, now known via App.js) is threaded through for upcoming self-service/audit features; not consumed internally yet.
export default function OfficerRosterView({ departmentId: departmentIdProp, staffId, topBarActionsRef } = {}) {
  const departmentId = departmentIdProp || process.env.REACT_APP_DEPARTMENT_ID;

  // Copy Last Week's Activities / + Add Activity portal into App.js's fixed
  // top bar (see topBarActionsRef prop) — a ref's .current isn't populated
  // until after App.js's own commit, so this state exists purely to force a
  // re-render once it is, letting the portal actually mount.
  const [topBarActionsNode, setTopBarActionsNode] = useState(null);
  useEffect(() => {
    setTopBarActionsNode(topBarActionsRef?.current || null);
  }, [topBarActionsRef]);

  // UI State
  const [activeTab, setActiveTab] = useState('calendar');
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => startOfWeek(new Date()));
  const [calendarAllocationStatus, setCalendarAllocationStatus] = useState({}); // dateStr -> 'none'|'green'|'yellow'|'red'
  const [fortnightStart, setFortnightStart] = useState(() => getMondayOfWeek(new Date()));
  const [fortnightRankFilter, setFortnightRankFilter] = useState('');
  const [fortnightSelectedStaffId, setFortnightSelectedStaffId] = useState('');
  const [fortnightAllocations, setFortnightAllocations] = useState([]);
  const [loadingFortnight, setLoadingFortnight] = useState(false);
  const [fortnightModalDate, setFortnightModalDate] = useState(null); // Date | null — which day cell's picker is open
  // Fortnight assignment wizard step within that modal — see
  // handleOpenFortnightModal/handleFortnightPickShift/PickLocation/PickActivity.
  const [fortnightWizardStep, setFortnightWizardStep] = useState('shift'); // 'shift' | 'location' | 'activity'
  const [fortnightWizardShiftId, setFortnightWizardShiftId] = useState(null);
  const [fortnightWizardLocationId, setFortnightWizardLocationId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Reference Data (from DB)
  const [refData, setRefData] = useState({
    locations: [],
    activities: [],
    shifts: [],
    staff: [],
    leaveTypes: [],
    department: null,
    dutyTypes: [],
  });
  // Bumped whenever staff are added/removed, so components that fetch their
  // own staff-derived data independently (Case Mix, Fairness, Staff Profiles,
  // the ranked assignment dropdowns) know to refetch instead of going stale.
  const [staffVersion, setStaffVersion] = useState(0);

  // Date-specific Data
  const [theatreActivities, setTheatreActivities] = useState([]);
  const [staffAssignments, setStaffAssignments] = useState([]);
  const [dutyAssignments, setDutyAssignments] = useState({});
  const [staffAvailabilityStatus, setStaffAvailabilityStatus] = useState(null); // Map staff_id -> 'available' | 'unavailable' | 'unset'
  const [fatigueStatus, setFatigueStatus] = useState(EMPTY_FATIGUE_STATUS);
  const [sortedStaffByActivity, setSortedStaffByActivity] = useState({});
  const [volunteerRequests, setVolunteerRequests] = useState([]); // pending volunteer_requests for the visible theatreActivities
  const [loadingDate, setLoadingDate] = useState(false);
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [newActivityLocation, setNewActivityLocation] = useState('');
  const [newActivityType, setNewActivityType] = useState('');
  const [newActivitySession, setNewActivitySession] = useState('full');
  // The actual authority for which Morning/Afternoon/Night section(s) this
  // activity groups under (see getSessionGroups) — pre-filled from the
  // location's default hours, or from the picked Session's matching shift,
  // but directly editable so e.g. Endoscopy can be narrowed to 08:00-12:00
  // even at a location whose default runs 08:00-18:00.
  const [newActivityStartTime, setNewActivityStartTime] = useState('');
  const [newActivityEndTime, setNewActivityEndTime] = useState('');
  const [pendingAssignment, setPendingAssignment] = useState(null); // { theatreActivityId, locationId, role, staffId, staffName, overrideReason }
  const [overridePrompt, setOverridePrompt] = useState(null); // { theatreActivityId, locationId, role, staffId, staffName, blockType, shiftId, reason }
  const [patternRuleAlert, setPatternRuleAlert] = useState(null); // { theatreActivityId, locationId, role, staffId, staffName, shiftId, action: 'BLOCK'|'WARN', description }
  // Staged, per-activity staffing edits — theatre_activity_id -> array of
  // draft entries. Nothing here touches the DB; entries are seeded from
  // staffAssignments the first time a card is edited (see getDraftEntries)
  // and only committed on "Complete Allocation" (handleCompleteAllocation).
  // A card with no key here is showing straight DB state, untouched.
  const [drafts, setDrafts] = useState({});
  const [noConsultantConfirm, setNoConsultantConfirm] = useState(null); // { theatreActivityId } | null — "are you sure" step when Complete Allocation finds no consultant

  // Management UI State
  const [newActivityName, setNewActivityName] = useState('');
  const [newLocationName, setNewLocationName] = useState('');
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  
  // Shift Management State (list itself lives in refData.shifts — the single
  // source of truth also used by the Day view — not a separate local copy)
  const [newShiftName, setNewShiftName] = useState('');
  const [newShiftDayType, setNewShiftDayType] = useState('weekday');
  const [newShiftStartTime, setNewShiftStartTime] = useState('08:00');
  const [newShiftEndTime, setNewShiftEndTime] = useState('16:30');
  const [newShiftSession, setNewShiftSession] = useState('full');
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [editShiftName, setEditShiftName] = useState('');
  const [editShiftDayType, setEditShiftDayType] = useState('weekday');
  const [editShiftStartTime, setEditShiftStartTime] = useState('');
  const [editShiftEndTime, setEditShiftEndTime] = useState('');
  const [editShiftSession, setEditShiftSession] = useState('full');

  // Duty Type Management State (list itself lives in refData.dutyTypes —
  // the single source of truth also used by the Duty Assignments panel)
  const [newDutyTypeLabel, setNewDutyTypeLabel] = useState('');
  const [newDutyTypeCountsAsOnCall, setNewDutyTypeCountsAsOnCall] = useState(true);
  const [newDutyTypeStartTime, setNewDutyTypeStartTime] = useState('');
  const [newDutyTypeEndTime, setNewDutyTypeEndTime] = useState('');
  const [editingDutyTypeId, setEditingDutyTypeId] = useState(null);
  const [editDutyTypeLabel, setEditDutyTypeLabel] = useState('');
  const [editDutyTypeCountsAsOnCall, setEditDutyTypeCountsAsOnCall] = useState(true);
  const [editDutyTypeSortOrder, setEditDutyTypeSortOrder] = useState(0);
  const [editDutyTypeStartTime, setEditDutyTypeStartTime] = useState('');
  const [editDutyTypeEndTime, setEditDutyTypeEndTime] = useState('');

  // Location Management State. Default hours are optional (blank = "always
  // open", e.g. an Emergency Department) — just a pre-fill offered when
  // creating a new activity at this location, not an enforced constraint.
  const [newLocationInput, setNewLocationInput] = useState('');
  const [newLocationDefaultStart, setNewLocationDefaultStart] = useState('');
  const [newLocationDefaultEnd, setNewLocationDefaultEnd] = useState('');
  const [editingLocationId, setEditingLocationId] = useState(null);
  const [editLocationName, setEditLocationName] = useState('');
  const [editLocationDefaultStart, setEditLocationDefaultStart] = useState('');
  const [editLocationDefaultEnd, setEditLocationDefaultEnd] = useState('');
  // Which location's Allowed Activities modal is open, if any.
  const [editingLocationActivitiesId, setEditingLocationActivitiesId] = useState(null);

  // Activity Management State
  const [newActivityInput, setNewActivityInput] = useState('');
  const [newActivityAbbreviation, setNewActivityAbbreviation] = useState('');
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [editActivityName, setEditActivityName] = useState('');
  const [editActivityAbbreviation, setEditActivityAbbreviation] = useState('');

  // Leave Type Management State
  const [newLeaveTypeName, setNewLeaveTypeName] = useState('');
  const [newLeaveTypeCode, setNewLeaveTypeCode] = useState('');
  const [editingLeaveTypeId, setEditingLeaveTypeId] = useState(null);
  const [editLeaveTypeName, setEditLeaveTypeName] = useState('');
  const [editLeaveTypeCode, setEditLeaveTypeCode] = useState('');

  // Department Settings State (Pay Centre Number local edit buffer, kept
  // separate from refData.department so typing doesn't need a round-trip)
  const [payCentreNumberInput, setPayCentreNumberInput] = useState('');
  const [savingPayCentreNumber, setSavingPayCentreNumber] = useState(false);

  // Leave/Special Code popover state — which assignment is being edited and
  // the in-progress value, following the same "local draft object, confirm
  // commits it" shape as pendingAssignment/overridePrompt above.
  const [editingLeaveCode, setEditingLeaveCode] = useState(null); // { assignmentId, value }
  const [exportingPayroll, setExportingPayroll] = useState(false);
  const [showPayrollModal, setShowPayrollModal] = useState(false);

  // Initialize department data on mount
  useEffect(() => {
    const init = async () => {
      if (!departmentId) {
        setError('Department ID not configured. Set REACT_APP_DEPARTMENT_ID in .env');
        setLoading(false);
        return;
      }

      try {
        const result = await initializeDepartment(departmentId);
        if (result.errors.length > 0) {
          console.error('Initialization errors:', result.errors);
        }
        setRefData(result);
        setPayCentreNumberInput(result.department?.pay_centre_number || '');
        setError(null);
      } catch (err) {
        setError(`Failed to load department: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [departmentId]);

  const refreshStaffList = async () => {
    if (!departmentId) return;
    try {
      const { data, error: fetchError } = await getStaffList(departmentId);
      if (fetchError) throw fetchError;
      setRefData(prev => ({ ...prev, staff: data }));
      setStaffVersion(v => v + 1);
      setError(null);
    } catch (err) {
      setError(`Failed to refresh staff list: ${err.message}`);
    }
  };

  useEffect(() => {
    const loadDateData = async () => {
      if (!selectedDate || !departmentId) return;

      setLoadingDate(true);
      try {
        const [theatreRes, staffRes, dutyRes, availRes, fatigueRes] = await Promise.all([
          getTheatreActivitiesForDate(departmentId, selectedDate),
          getStaffAssignmentsForDate(departmentId, selectedDate),
          getDutyAssignmentsForDate(departmentId, selectedDate),
          getStaffAvailabilityForDate(departmentId, selectedDate),
          getStaffFatigueStatus(departmentId, selectedDate),
        ]);

        if (theatreRes.error) throw theatreRes.error;
        if (staffRes.error) throw staffRes.error;
        if (dutyRes.error) throw dutyRes.error;
        if (availRes.error) throw availRes.error;
        if (fatigueRes.error) throw fatigueRes.error;

        setTheatreActivities(theatreRes.data);
        setStaffAssignments(staffRes.data);
        setStaffAvailabilityStatus(new Map(availRes.allStaff.map(s => [s.staff_id, s.availability_status])));
        setFatigueStatus(fatigueRes.data);

        // Map duty assignments by type for easy lookup
        const dutyMap = {};
        dutyRes.data.forEach(duty => {
          dutyMap[duty.duty_type] = duty.staff_id;
        });
        setDutyAssignments(dutyMap);
      } catch (err) {
        setError(`Failed to load date data: ${err.message}`);
      } finally {
        setLoadingDate(false);
      }
    };

    loadDateData();
  }, [selectedDate, departmentId, staffVersion]);

  // Load case-mix-sorted staff lists for each activity present on this date,
  // so assignment dropdowns can rank staff by exposure rate (lowest first).
  useEffect(() => {
    const loadSortedStaff = async () => {
      if (!departmentId || !selectedDate || theatreActivities.length === 0) {
        setSortedStaffByActivity({});
        return;
      }

      const activityIds = [...new Set(theatreActivities.map(ta => ta.activity_id).filter(Boolean))];

      try {
        const results = await Promise.all(
          activityIds.map(activityId => getSortedStaffForActivity(departmentId, activityId, selectedDate))
        );

        const map = {};
        activityIds.forEach((activityId, idx) => {
          map[activityId] = results[idx].data;
        });
        setSortedStaffByActivity(map);
      } catch (err) {
        console.error('Failed to load case mix sorted staff:', err);
      }
    };

    loadSortedStaff();
  }, [departmentId, selectedDate, theatreActivities, staffVersion]);

  const refreshVolunteerRequests = async () => {
    const activityIds = theatreActivities.map(ta => ta.theatre_activity_id);
    if (activityIds.length === 0) {
      setVolunteerRequests([]);
      return;
    }
    try {
      const { data, error } = await getVolunteerRequestsForActivities(activityIds);
      if (error) throw error;
      setVolunteerRequests(data);
    } catch (err) {
      console.error('Failed to load volunteer requests:', err);
    }
  };

  useEffect(() => {
    refreshVolunteerRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theatreActivities]);

  // Calendar tab allocation-status colouring — refetches whenever the visible
  // 4-week window changes, and also when returning to the calendar tab (so
  // assignments made in the Day view are reflected without needing the week
  // itself to change).
  useEffect(() => {
    const loadAllocationStatus = async () => {
      if (!departmentId || activeTab !== 'calendar') return;

      const rangeEnd = new Date(calendarWeekStart);
      rangeEnd.setDate(rangeEnd.getDate() + CALENDAR_DAYS_SHOWN - 1);

      try {
        const { data, error } = await getAllocationStatusForRange(departmentId, calendarWeekStart, rangeEnd);
        if (error) throw error;
        setCalendarAllocationStatus(data);
      } catch (err) {
        console.error('Failed to load calendar allocation status:', err);
      }
    };

    loadAllocationStatus();
  }, [departmentId, calendarWeekStart, activeTab]);

  // Fortnight tab — whole department's real staff_assignments for the
  // visible 14-day window (same data the Day view reads/writes, see
  // assignStaffFortnight), refetched whenever that window changes or an
  // assignment is added/removed (via fortnightRefreshKey).
  const [fortnightRefreshKey, setFortnightRefreshKey] = useState(0);
  useEffect(() => {
    const loadFortnightAllocations = async () => {
      if (!departmentId || activeTab !== 'fortnight') return;

      setLoadingFortnight(true);

      try {
        const { data, error } = await getAllStaffAssignmentsForRange(departmentId, fortnightStart, 14);
        if (error) throw error;
        setFortnightAllocations(data);
        setError(null);
      } catch (err) {
        setError(`Failed to load fortnight allocations: ${err.message}`);
      } finally {
        setLoadingFortnight(false);
      }
    };

    loadFortnightAllocations();
  }, [departmentId, fortnightStart, activeTab, fortnightRefreshKey]);

  // Returns staff matching filterFn, ordered by exposure rate for the given
  // activity (lowest first) when case-mix data is available; falls back to
  // reference-data order otherwise.
  const getRankedStaffOptions = (activityId, filterFn) => {
    const ranked = sortedStaffByActivity[activityId];
    if (ranked) return ranked.filter(filterFn); // already active-only (getSortedStaffForActivity filters at the query)
    return refData.staff.filter(s => s.active !== false).filter(filterFn);
  };

  const getVolunteersForActivity = (theatreActivityId, role) => {
    return volunteerRequests
      .filter(v => v.theatre_activity_id === theatreActivityId && v.role === role && v.staff)
      .map(v => ({ ...v.staff, staff_id: v.staff_id }));
  };

  const getTotalVolunteerCount = (theatreActivityId) => {
    return volunteerRequests.filter(v => v.theatre_activity_id === theatreActivityId).length;
  };

  // Activity restrictions are a staff preference, not a hard rule — an
  // officer can still assign a restricted person if there's genuinely no
  // one else, so this never blocks selection. It only drives a visible
  // warning, both while picking (in the dropdown) and afterwards (as a
  // badge next to the assignment), so the choice stays visible rather than
  // silently overriding what the staff member asked for.
  const isActivityRestricted = (staffId, activityId) => {
    const staff = refData.staff.find(s => s.staff_id === staffId);
    const activity = refData.activities.find(a => a.activity_id === activityId);
    if (!staff || !activity) return false;
    return (staff.activity_restrictions || []).includes(activity.name);
  };

  // A staff member is only assignable once they've explicitly confirmed
  // availability for the date — an unconfirmed ('unset') day is not enough.
  // Fatigue overrides this: a mandatory rest day after a night shift blocks
  // assignment outright, regardless of what they've marked themselves — but
  // unlike an unconfirmed/unavailable day, this specific block can be
  // overridden (with a reason) since it's a soft policy, not a hard fact.
  const getAssignabilityInfo = (staffId) => {
    const fatigueRisk = fatigueStatus.fatigueRiskStaffIds.has(staffId);

    if (fatigueStatus.postNightRestStaffIds.has(staffId)) {
      return { blocked: true, overridable: true, blockType: 'post_night_rest', label: ' — Resting after night shift', fatigueRisk };
    }

    if (staffAvailabilityStatus === null) return { blocked: false, overridable: false, blockType: null, label: '', fatigueRisk };
    const status = staffAvailabilityStatus.get(staffId) || 'unset';
    if (status === 'available') return { blocked: false, overridable: false, blockType: null, label: '', fatigueRisk };
    if (status === 'unavailable') return { blocked: true, overridable: false, blockType: 'unavailable', label: ' — Unavailable', fatigueRisk };
    return { blocked: true, overridable: false, blockType: 'unconfirmed', label: ' — Not Confirmed', fatigueRisk };
  };

  const handleConfirmOverride = () => {
    if (!overridePrompt || overridePrompt.reason.trim().length < 10) return;
    const reason = overridePrompt.reason.trim();

    if (overridePrompt.blockType === 'night_cooldown') {
      handleAssignStaff(overridePrompt.theatreActivityId, overridePrompt.locationId, overridePrompt.shiftId, overridePrompt.staffId, overridePrompt.role, reason);
      return;
    }

    // post_night_rest: staff is confirmed, but still needs a shift type chosen
    setPendingAssignment({
      theatreActivityId: overridePrompt.theatreActivityId,
      locationId: overridePrompt.locationId,
      role: overridePrompt.role,
      staffId: overridePrompt.staffId,
      staffName: overridePrompt.staffName,
      overrideReason: reason,
    });
    setOverridePrompt(null);
  };

  // Duty roster (am/pm coordinator, on-call) should only offer confirmed-available
  // staff — including the same "worked a night, not available the next day" rule
  // used for theatre assignment. The currently-assigned person for a duty is kept
  // in the list (marked unavailable) rather than silently dropped, so the <select>
  // doesn't appear to reset if someone becomes unavailable after being assigned.
  const isAvailableForDuty = (staffId) => {
    if (staffAvailabilityStatus === null) return true;
    if (fatigueStatus.postNightRestStaffIds.has(staffId)) return false;
    return (staffAvailabilityStatus.get(staffId) || 'unset') === 'available';
  };

  const getDutyStaffOptions = (dutyType) => {
    const currentStaffId = dutyAssignments[dutyType];
    return refData.staff
      .filter(s => (s.active !== false && isAvailableForDuty(s.staff_id)) || s.staff_id === currentStaffId)
      .map(s => ({ ...s, unavailable: s.active === false || !isAvailableForDuty(s.staff_id) }));
  };

  // Handlers for staff assignment. skipPatternCheck is set when re-calling
  // this after an officer has already seen and accepted a WARN-level shift
  // pattern rule via the Override button.
  // Adds one person to a card's staged draft (see getDraftEntries/
  // addEntryToDraft above) — nothing is written to the DB here. The old
  // per-add validateSupervision() hard-block is gone: with multiple people
  // now addable in any order, "is there a consultant yet" can no longer be
  // judged one add at a time. That check now happens once, at Complete
  // Allocation (handleCompleteAllocation), as a warning rather than a
  // block. The fatigue-pattern check below is unrelated (it's about this
  // one person's own shift history, not the location's staffing) and still
  // fires per-add, same as before.
  const handleAssignStaff = async (theatreActivityId, locationId, shiftId, staffId, role, overrideReason = null, skipPatternCheck = false) => {
    if (!selectedDate || !departmentId) return;

    try {
      const staff = refData.staff.find(s => s.staff_id === staffId);
      if (!staff) throw new Error('Staff not found');

      if (!skipPatternCheck) {
        // validateShiftAssignment() fails open (returns a valid:true ALLOW
        // result) on its own internal errors, so a rules-lookup failure
        // shouldn't block a genuine assignment here either.
        const { data: patternResult } = await validateShiftAssignment(staffId, selectedDate, shiftId, departmentId);

        if (!patternResult.valid) {
          setPatternRuleAlert({
            theatreActivityId,
            locationId,
            role,
            staffId,
            staffName: staff.name,
            shiftId,
            action: patternResult.action,
            description: patternResult.rule.description,
          });
          setOpenDropdown(null);
          setPendingAssignment(null);
          setOverridePrompt(null);
          return;
        }
      }

      addEntryToDraft(theatreActivityId, locationId, {
        localId: crypto.randomUUID(),
        assignmentId: null,
        staffId,
        staffName: staff.name,
        role,
        shiftId,
        onCall: false,
        fatigueOverrideReason: overrideReason,
        leaveCode: null,
      });

      cascadeAssignmentAcrossSections(theatreActivityId, locationId, shiftId, staffId, staff.name, role);

      setOpenDropdown(null);
      setPendingAssignment(null);
      setOverridePrompt(null);
      setPatternRuleAlert(null);
      setError(null);
    } catch (err) {
      setError(`Failed to assign staff: ${err.message}`);
    }
  };

  const handleConfirmPatternOverride = () => {
    if (!patternRuleAlert) return;
    handleAssignStaff(patternRuleAlert.theatreActivityId, patternRuleAlert.locationId, patternRuleAlert.shiftId, patternRuleAlert.staffId, patternRuleAlert.role, patternRuleAlert.description, true);
  };

  const handleActivityChange = async (theatreActivityId, newActivityId) => {
    try {
      const { error } = await updateTheatreActivity(theatreActivityId, newActivityId);
      if (error) throw error;

      // Refresh
      const { data, error: fetchError } = await getTheatreActivitiesForDate(departmentId, selectedDate);
      if (fetchError) throw fetchError;
      setTheatreActivities(data);
    } catch (err) {
      setError(`Failed to update activity: ${err.message}`);
    }
  };

  // Directly editable from the card itself — the authority for which
  // Morning/Afternoon/Night section(s) this activity groups under (see
  // getSessionGroups), independent of whatever shift it's also linked to.
  const handleActivityTimesChange = async (ta, startTime, endTime) => {
    if (!startTime || !endTime) return;

    try {
      const { error } = await updateTheatreActivityTimes(ta.theatre_activity_id, startTime, endTime);
      if (error) throw error;

      setTheatreActivities(prev => prev.map(a =>
        a.theatre_activity_id === ta.theatre_activity_id ? { ...a, start_time: startTime, end_time: endTime } : a
      ));
    } catch (err) {
      setError(`Failed to update activity times: ${err.message}`);
    }
  };

  const handleDutyChange = async (dutyTypeKey, staffId) => {
    if (!selectedDate || !departmentId) return;

    try {
      const { error } = await updateDutyAssignment(departmentId, selectedDate, dutyTypeKey, staffId);
      if (error) throw error;

      setDutyAssignments(prev => ({
        ...prev,
        [dutyTypeKey]: staffId,
      }));

      // Project this onto a card in the right section(s), if the duty type
      // has start/end times configured (see syncDutyOnCallActivity).
      const dutyType = refData.dutyTypes.find(d => d.key === dutyTypeKey);
      if (dutyType) {
        const { error: syncError } = await syncDutyOnCallActivity(departmentId, selectedDate, dutyType, staffId || null);
        if (syncError) throw syncError;

        const { data: theatreData, error: theatreError } = await getTheatreActivitiesForDate(departmentId, selectedDate);
        if (theatreError) throw theatreError;
        setTheatreActivities(theatreData);

        const { data: assignData, error: assignError } = await getStaffAssignmentsForDate(departmentId, selectedDate);
        if (assignError) throw assignError;
        setStaffAssignments(assignData);
      }

      setError(null);
    } catch (err) {
      setError(`Failed to update duty: ${err.message}`);
    }
  };

  // Fortnight assignment wizard — shift, then location, then activity, in
  // that order. Each step just narrows the choice; the actual write only
  // happens once an activity is picked (see assignStaffFortnight), which
  // finds-or-creates the matching theatre_activities card and adds this
  // person to it exactly as "Add Activity" + assign staff does in the Day
  // view, just starting from the person instead of the location.
  const handleOpenFortnightModal = (date) => {
    setFortnightModalDate(date);
    setFortnightWizardStep('shift');
    setFortnightWizardShiftId(null);
    setFortnightWizardLocationId(null);
  };

  const handleCloseFortnightModal = () => {
    setFortnightModalDate(null);
    setFortnightWizardStep('shift');
    setFortnightWizardShiftId(null);
    setFortnightWizardLocationId(null);
  };

  const handleFortnightPickShift = (shiftId) => {
    setFortnightWizardShiftId(shiftId);
    setFortnightWizardStep('location');
  };

  const handleFortnightPickLocation = (locationId) => {
    setFortnightWizardLocationId(locationId);
    setFortnightWizardStep('activity');
  };

  const handleFortnightPickActivity = async (activityId) => {
    if (!departmentId || !fortnightModalDate || !fortnightSelectedStaffId || !fortnightWizardShiftId || !fortnightWizardLocationId) return;

    try {
      const { error } = await assignStaffFortnight(
        departmentId, fortnightModalDate, fortnightSelectedStaffId, fortnightWizardShiftId, fortnightWizardLocationId, activityId
      );
      if (error) throw error;

      handleCloseFortnightModal();
      setFortnightRefreshKey(k => k + 1);
      setError(null);
    } catch (err) {
      setError(`Failed to assign: ${err.message}`);
    }
  };

  // "Already on this day" is grouped one line per person (see the Fortnight
  // grid cells' own grouping) — someone with two activities that day has
  // two assignment rows behind one line, so removing them clears all of
  // that person's rows for the day rather than just one.
  const handleRemoveFortnightPersonDay = async (assignmentIds) => {
    try {
      const results = await Promise.all(assignmentIds.map(id => deleteStaffAssignment(id)));
      const failed = results.find(r => r.error);
      if (failed) throw failed.error;

      setFortnightRefreshKey(k => k + 1);
      setError(null);
    } catch (err) {
      setError(`Failed to remove assignment: ${err.message}`);
    }
  };

  const handleCopyLastWeek = async () => {
    if (!selectedDate || !departmentId) return;

    try {
      const { data, error } = await copyLastWeekActivities(departmentId, selectedDate);
      if (error) throw error;

      // Refresh
      const { data: theatreData, error: theatreError } = await getTheatreActivitiesForDate(departmentId, selectedDate);
      if (theatreError) throw theatreError;
      setTheatreActivities(theatreData);

      setError(null); // Clear any errors
    } catch (err) {
      setError(`Failed to copy week: ${err.message}`);
    }
  };

  // Pre-fills the Add Activity time fields. For Morning/Afternoon/Night,
  // always use the fixed SESSION_DEFAULT_TIMES — these are specific,
  // unambiguous choices and shouldn't be second-guessed by a location's
  // generic default hours (e.g. picking Night at a Ward, which defaults to
  // day hours, must still prefill Night's actual times, not the Ward's).
  // Only Whole Day defers to the location's own hours when set (e.g. Ward's
  // "explicitly manned" 08:00-18:00), since that's genuinely what "whole
  // day" means for that specific location; falls back to the fixed 08:00-
  // 18:00 default otherwise. Either way, still hand-editable afterward.
  const prefillActivityTimes = (locationId, session) => {
    if (session === 'full') {
      const location = refData.locations.find(l => l.location_id === locationId);
      if (location?.default_start_time && location?.default_end_time) {
        setNewActivityStartTime(location.default_start_time.slice(0, 5));
        setNewActivityEndTime(location.default_end_time.slice(0, 5));
        return;
      }
    }
    const defaults = SESSION_DEFAULT_TIMES[session];
    if (defaults) {
      setNewActivityStartTime(defaults.start);
      setNewActivityEndTime(defaults.end);
    }
  };

  // Called as soon as an activity is picked (location, times must already be
  // set) — the modal closes immediately rather than waiting on a separate
  // submit step. newActivityStartTime/EndTime (pre-filled from the
  // location's default hours or the picked Session, but directly editable —
  // see prefillActivityTimes) are what actually decide which of the
  // Morning/Afternoon/Night Allocations sections this groups under; the
  // Session-matched shift is only still used for the activity's shift_id
  // (naming, pattern rules, volunteer listing) — individual staff pick
  // their own shift independently when assigned below.
  const handleAddActivity = async (activityId) => {
    if (!newActivityLocation || !activityId || !selectedDate || !departmentId) {
      setError('Please select a location and an activity');
      return;
    }
    if (!newActivityStartTime || !newActivityEndTime) {
      setError('Please set a start and end time for this activity');
      return;
    }

    const sessionShift = refData.shifts.find(s => s.session === newActivitySession && s.active !== false && !/on.?call/i.test(s.name || ''));
    const defaultShift = sessionShift || refData.shifts.find(s => s.active !== false);
    if (!defaultShift) {
      setError('No shifts configured — add a shift in Settings first');
      return;
    }

    try {
      const { error: addError } = await createTheatreActivity(
        departmentId,
        selectedDate,
        newActivityLocation,
        defaultShift.shift_id,
        activityId,
        newActivityStartTime,
        newActivityEndTime
      );
      if (addError) throw addError;

      // Refresh theatre activities for this date
      const { data, error: fetchError } = await getTheatreActivitiesForDate(departmentId, selectedDate);
      if (fetchError) throw fetchError;
      setTheatreActivities(data);

      // Reset form
      setShowAddActivity(false);
      setNewActivityLocation('');
      setNewActivityType('');
      setNewActivitySession('full');
      setNewActivityStartTime('');
      setNewActivityEndTime('');
      setError(null);
    } catch (err) {
      setError(`Failed to add activity: ${err.message}`);
    }
  };

  const handleRemoveActivity = async (ta) => {
    if (!window.confirm(`Remove ${ta.locations.name} from this day? This will also remove any staff assigned there.`)) {
      return;
    }

    try {
      const { error } = await deleteTheatreActivity(ta.theatre_activity_id, departmentId, selectedDate, ta.location_id);
      if (error) throw error;

      const [theatreRes, staffRes] = await Promise.all([
        getTheatreActivitiesForDate(departmentId, selectedDate),
        getStaffAssignmentsForDate(departmentId, selectedDate),
      ]);
      if (theatreRes.error) throw theatreRes.error;
      if (staffRes.error) throw staffRes.error;
      setTheatreActivities(theatreRes.data);
      setStaffAssignments(staffRes.data);
      setError(null);
    } catch (err) {
      setError(`Failed to remove activity: ${err.message}`);
    }
  };

  // Shift Management Handlers
  const handleCreateShift = async () => {
    if (!newShiftName.trim() || !departmentId) return;

    try {
      const { data, error } = await createShift(
        departmentId,
        newShiftName,
        newShiftDayType,
        newShiftStartTime,
        newShiftEndTime,
        newShiftSession
      );

      if (error) throw error;

      setRefData(prev => ({ ...prev, shifts: [...prev.shifts, data] }));
      setNewShiftName('');
      setNewShiftDayType('weekday');
      setNewShiftStartTime('08:00');
      setNewShiftEndTime('16:30');
      setNewShiftSession('full');
      setError(null);
    } catch (err) {
      setError(`Failed to create shift: ${err.message}`);
    }
  };

  const handleUpdateShift = async () => {
    if (!editingShiftId || !editShiftName.trim() || !editShiftStartTime || !editShiftEndTime) return;

    try {
      const { data, error } = await updateShift(editingShiftId, editShiftName.trim(), editShiftDayType, editShiftStartTime, editShiftEndTime, editShiftSession);
      if (error) throw error;

      setRefData(prev => ({ ...prev, shifts: prev.shifts.map(s => s.shift_id === editingShiftId ? data : s) }));
      setEditingShiftId(null);
      setEditShiftName('');
      setEditShiftDayType('weekday');
      setEditShiftStartTime('');
      setEditShiftEndTime('');
      setEditShiftSession('full');
      setError(null);
    } catch (err) {
      setError(`Failed to update shift: ${err.message}`);
    }
  };

  const handleDeactivateShift = async (shiftId) => {
    if (!window.confirm("Deactivate this shift? It won't be offered for new assignments, but everything already using it is unaffected.")) {
      return;
    }

    try {
      const { error } = await deactivateShift(shiftId);
      if (error) throw error;

      setRefData(prev => ({ ...prev, shifts: prev.shifts.map(s => s.shift_id === shiftId ? { ...s, active: false } : s) }));
      setError(null);
    } catch (err) {
      setError(`Failed to deactivate shift: ${err.message}`);
    }
  };

  const handleReactivateShift = async (shiftId) => {
    try {
      const { error } = await reactivateShift(shiftId);
      if (error) throw error;

      setRefData(prev => ({ ...prev, shifts: prev.shifts.map(s => s.shift_id === shiftId ? { ...s, active: true } : s) }));
      setError(null);
    } catch (err) {
      setError(`Failed to reactivate shift: ${err.message}`);
    }
  };

  const handleStartEditShift = (shift) => {
    setEditingShiftId(shift.shift_id);
    setEditShiftName(shift.name);
    setEditShiftDayType(shift.day_type);
    setEditShiftStartTime(shift.start_time);
    setEditShiftEndTime(shift.end_time);
    setEditShiftSession(shift.session);
  };

  const handleCreateDutyType = async () => {
    if (!newDutyTypeLabel.trim() || !departmentId) return;

    try {
      const nextSortOrder = refData.dutyTypes.reduce((max, d) => Math.max(max, d.sort_order), -1) + 1;
      const { data, activityType, shift, error } = await createDutyType(
        departmentId, newDutyTypeLabel, newDutyTypeCountsAsOnCall, nextSortOrder,
        newDutyTypeStartTime || null, newDutyTypeEndTime || null
      );
      if (error) throw error;

      setRefData(prev => ({
        ...prev,
        dutyTypes: [...prev.dutyTypes, data],
        activities: activityType ? [...prev.activities, activityType] : prev.activities,
        shifts: shift ? [...prev.shifts, shift] : prev.shifts,
      }));
      setNewDutyTypeLabel('');
      setNewDutyTypeCountsAsOnCall(true);
      setNewDutyTypeStartTime('');
      setNewDutyTypeEndTime('');
      setError(null);
    } catch (err) {
      setError(`Failed to create duty type: ${err.message}`);
    }
  };

  const handleUpdateDutyType = async () => {
    if (!editingDutyTypeId || !editDutyTypeLabel.trim()) return;

    try {
      const editingDutyType = refData.dutyTypes.find(d => d.duty_type_id === editingDutyTypeId);
      const { data, activityType, shift, error } = await updateDutyType(
        departmentId, editingDutyTypeId, editDutyTypeLabel.trim(), editDutyTypeCountsAsOnCall, editDutyTypeSortOrder,
        editDutyTypeStartTime || null, editDutyTypeEndTime || null, editingDutyType?.activity_type_id, editingDutyType?.shift_id
      );
      if (error) throw error;

      setRefData(prev => ({
        ...prev,
        dutyTypes: prev.dutyTypes.map(d => d.duty_type_id === editingDutyTypeId ? data : d),
        activities: activityType ? prev.activities.map(a => a.activity_id === activityType.activity_id ? activityType : a) : prev.activities,
        shifts: shift
          ? (prev.shifts.some(s => s.shift_id === shift.shift_id)
            ? prev.shifts.map(s => s.shift_id === shift.shift_id ? shift : s)
            : [...prev.shifts, shift])
          : prev.shifts,
      }));
      setEditingDutyTypeId(null);
      setEditDutyTypeLabel('');
      setEditDutyTypeCountsAsOnCall(true);
      setEditDutyTypeSortOrder(0);
      setEditDutyTypeStartTime('');
      setEditDutyTypeEndTime('');
      setError(null);
    } catch (err) {
      setError(`Failed to update duty type: ${err.message}`);
    }
  };

  const handleDeactivateDutyType = async (dutyTypeId) => {
    if (!window.confirm("Deactivate this duty type? It won't be offered in the Duty Assignments panel, but past history using it is unaffected.")) {
      return;
    }

    try {
      const { error } = await deactivateDutyType(dutyTypeId);
      if (error) throw error;

      setRefData(prev => ({ ...prev, dutyTypes: prev.dutyTypes.map(d => d.duty_type_id === dutyTypeId ? { ...d, active: false } : d) }));
      setError(null);
    } catch (err) {
      setError(`Failed to deactivate duty type: ${err.message}`);
    }
  };

  const handleReactivateDutyType = async (dutyTypeId) => {
    try {
      const { error } = await reactivateDutyType(dutyTypeId);
      if (error) throw error;

      setRefData(prev => ({ ...prev, dutyTypes: prev.dutyTypes.map(d => d.duty_type_id === dutyTypeId ? { ...d, active: true } : d) }));
      setError(null);
    } catch (err) {
      setError(`Failed to reactivate duty type: ${err.message}`);
    }
  };

  const handleStartEditDutyType = (dutyType) => {
    setEditingDutyTypeId(dutyType.duty_type_id);
    setEditDutyTypeLabel(dutyType.label);
    setEditDutyTypeCountsAsOnCall(dutyType.counts_as_on_call);
    setEditDutyTypeSortOrder(dutyType.sort_order);
    setEditDutyTypeStartTime(dutyType.start_time?.slice(0, 5) || '');
    setEditDutyTypeEndTime(dutyType.end_time?.slice(0, 5) || '');
  };

  // Location Management Handlers
  const handleCreateLocation = async () => {
    if (!newLocationInput.trim() || !departmentId) return;

    try {
      const { data, error } = await createLocation(departmentId, newLocationInput, newLocationDefaultStart || null, newLocationDefaultEnd || null);
      if (error) throw error;

      setRefData(prev => ({ ...prev, locations: [...prev.locations, data] }));
      setNewLocationInput('');
      setNewLocationDefaultStart('');
      setNewLocationDefaultEnd('');
      setError(null);
    } catch (err) {
      setError(`Failed to create location: ${err.message}`);
    }
  };

  const handleDeactivateLocation = async (locationId) => {
    if (!window.confirm("Deactivate this location? It won't be offered for new activities, but everything already scheduled there is unaffected.")) {
      return;
    }

    try {
      const { error } = await deactivateLocation(locationId);
      if (error) throw error;

      setRefData(prev => ({ ...prev, locations: prev.locations.map(l => l.location_id === locationId ? { ...l, active: false } : l) }));
      setError(null);
    } catch (err) {
      setError(`Failed to deactivate location: ${err.message}`);
    }
  };

  const handleReactivateLocation = async (locationId) => {
    try {
      const { error } = await reactivateLocation(locationId);
      if (error) throw error;

      setRefData(prev => ({ ...prev, locations: prev.locations.map(l => l.location_id === locationId ? { ...l, active: true } : l) }));
      setError(null);
    } catch (err) {
      setError(`Failed to reactivate location: ${err.message}`);
    }
  };

  const handleStartEditLocation = (location) => {
    setEditingLocationId(location.location_id);
    setEditLocationName(location.name);
    setEditLocationDefaultStart(location.default_start_time?.slice(0, 5) || '');
    setEditLocationDefaultEnd(location.default_end_time?.slice(0, 5) || '');
  };

  const handleUpdateLocation = async () => {
    if (!editingLocationId || !editLocationName.trim()) return;

    try {
      const { data, error } = await updateLocation(editingLocationId, editLocationName.trim(), editLocationDefaultStart || null, editLocationDefaultEnd || null);
      if (error) throw error;

      setRefData(prev => ({ ...prev, locations: prev.locations.map(l => l.location_id === editingLocationId ? data : l) }));
      setEditingLocationId(null);
      setEditLocationName('');
      setEditLocationDefaultStart('');
      setEditLocationDefaultEnd('');
      setError(null);
    } catch (err) {
      setError(`Failed to rename location: ${err.message}`);
    }
  };

  // Auto-saves as soon as an activity is added/removed from the location's
  // allowed list — no separate Save step, same as the checkbox-toggle
  // pattern used for staff activity restrictions in StaffProfilesTab.
  const handleUpdateLocationAllowedActivities = async (locationId, activityIds) => {
    try {
      const { data, error } = await updateLocationAllowedActivities(locationId, activityIds);
      if (error) throw error;

      setRefData(prev => ({ ...prev, locations: prev.locations.map(l => l.location_id === locationId ? data : l) }));
      setError(null);
    } catch (err) {
      setError(`Failed to update allowed activities: ${err.message}`);
    }
  };

  // Every activity picker that starts from a location (the Fortnight
  // wizard, the Day view's Add Activity dialog, and an existing card's own
  // Activity dropdown) narrows to this — see
  // migrations/2026-08-23_location_allowed_activities.sql. Unconfigured
  // (null/empty) means no restriction, so nothing changes for a location
  // an officer hasn't set this up for yet.
  const activitiesAllowedAtLocation = (locationId) => {
    const location = refData.locations.find(l => l.location_id === locationId);
    const allowedIds = location?.allowed_activity_ids;
    if (!allowedIds || allowedIds.length === 0) return refData.activities;
    return refData.activities.filter(a => allowedIds.includes(a.activity_id));
  };

  // Same as activitiesAllowedAtLocation, but guarantees a card's own
  // currently-set activity stays selectable even if it's since fallen
  // outside the location's allowed list (restriction added/changed after
  // the fact) — same "keep it, just flag unavailable" precedent as
  // getDutyStaffOptions.
  const activityOptionsFor = (locationId, currentActivityId) => {
    const allowed = activitiesAllowedAtLocation(locationId);
    if (!currentActivityId || allowed.some(a => a.activity_id === currentActivityId)) return allowed;
    const current = refData.activities.find(a => a.activity_id === currentActivityId);
    return current ? [...allowed, current] : allowed;
  };

  // Activity Management Handlers
  const handleCreateActivity = async () => {
    if (!newActivityInput.trim() || !departmentId) return;

    try {
      const { data, error } = await createActivityType(departmentId, newActivityInput, newActivityAbbreviation.trim() || null);
      if (error) throw error;

      setRefData(prev => ({ ...prev, activities: [...prev.activities, data] }));
      setNewActivityInput('');
      setNewActivityAbbreviation('');
      setError(null);
    } catch (err) {
      setError(`Failed to create activity: ${err.message}`);
    }
  };

  const handleDeleteActivity = async (activityId) => {
    if (!window.confirm('Delete this activity type? Any theatre activities and staff assignments using it will be removed too.')) {
      return;
    }

    try {
      const { error } = await deleteActivityType(activityId);
      if (error) throw error;

      setRefData(prev => ({ ...prev, activities: prev.activities.filter(a => a.activity_id !== activityId) }));
      setError(null);
    } catch (err) {
      setError(`Failed to delete activity: ${err.message}`);
    }
  };

  const handleStartEditActivity = (activity) => {
    setEditingActivityId(activity.activity_id);
    setEditActivityName(activity.name);
    setEditActivityAbbreviation(activity.abbreviation || '');
  };

  const handleUpdateActivity = async () => {
    if (!editingActivityId || !editActivityName.trim()) return;

    try {
      const { data, error } = await updateActivityTypeName(editingActivityId, editActivityName.trim(), editActivityAbbreviation.trim() || null);
      if (error) throw error;

      setRefData(prev => ({ ...prev, activities: prev.activities.map(a => a.activity_id === editingActivityId ? data : a) }));
      setEditingActivityId(null);
      setEditActivityName('');
      setEditActivityAbbreviation('');
      setError(null);
    } catch (err) {
      setError(`Failed to rename activity: ${err.message}`);
    }
  };

  // Leave Type Management Handlers
  const handleCreateLeaveType = async () => {
    if (!newLeaveTypeName.trim() || !newLeaveTypeCode.trim() || !departmentId) return;

    try {
      const { data, error } = await createLeaveType(departmentId, newLeaveTypeName.trim(), newLeaveTypeCode.trim());
      if (error) throw error;

      setRefData(prev => ({ ...prev, leaveTypes: [...prev.leaveTypes, data].sort((a, b) => a.name.localeCompare(b.name)) }));
      setNewLeaveTypeName('');
      setNewLeaveTypeCode('');
      setError(null);
    } catch (err) {
      setError(`Failed to create leave type: ${err.message}`);
    }
  };

  const handleStartEditLeaveType = (leaveType) => {
    setEditingLeaveTypeId(leaveType.leave_type_id);
    setEditLeaveTypeName(leaveType.name);
    setEditLeaveTypeCode(leaveType.code);
  };

  const handleUpdateLeaveType = async () => {
    if (!editingLeaveTypeId || !editLeaveTypeName.trim() || !editLeaveTypeCode.trim()) return;

    try {
      const { data, error } = await updateLeaveType(editingLeaveTypeId, editLeaveTypeName.trim(), editLeaveTypeCode.trim());
      if (error) throw error;

      setRefData(prev => ({
        ...prev,
        leaveTypes: prev.leaveTypes.map(lt => lt.leave_type_id === editingLeaveTypeId ? data : lt).sort((a, b) => a.name.localeCompare(b.name)),
      }));
      setEditingLeaveTypeId(null);
      setEditLeaveTypeName('');
      setEditLeaveTypeCode('');
      setError(null);
    } catch (err) {
      setError(`Failed to update leave type: ${err.message}`);
    }
  };

  const handleDeleteLeaveType = async (leaveTypeId) => {
    if (!window.confirm('Delete this leave type? Any assignments already using its code keep the text, but it will no longer appear as a preset option.')) {
      return;
    }

    try {
      const { error } = await deleteLeaveType(leaveTypeId);
      if (error) throw error;

      setRefData(prev => ({ ...prev, leaveTypes: prev.leaveTypes.filter(lt => lt.leave_type_id !== leaveTypeId) }));
      setError(null);
    } catch (err) {
      setError(`Failed to delete leave type: ${err.message}`);
    }
  };

  // Department Settings Handlers
  const handleSavePayCentreNumber = async () => {
    if (!departmentId) return;

    setSavingPayCentreNumber(true);
    try {
      const { error } = await updateDepartmentPayCentreNumber(departmentId, payCentreNumberInput.trim());
      if (error) throw error;

      setRefData(prev => ({ ...prev, department: { ...prev.department, pay_centre_number: payCentreNumberInput.trim() || null } }));
      setError(null);
    } catch (err) {
      setError(`Failed to save pay centre number: ${err.message}`);
    } finally {
      setSavingPayCentreNumber(false);
    }
  };

  // Leave/Special Code Handler (on an existing staff assignment)
  const handleSaveLeaveCode = async () => {
    if (!editingLeaveCode || !selectedDate || !departmentId) return;

    try {
      const { error } = await updateStaffAssignmentLeaveCode(editingLeaveCode.assignmentId, editingLeaveCode.value.trim());
      if (error) throw error;

      const { data, error: fetchError } = await getStaffAssignmentsForDate(departmentId, selectedDate);
      if (fetchError) throw fetchError;
      setStaffAssignments(data);

      setEditingLeaveCode(null);
      setError(null);
    } catch (err) {
      setError(`Failed to save leave code: ${err.message}`);
    }
  };

  // Payroll Export Handler — covers a Mon-Sun/Mon-Sun (14-day) fortnight,
  // the whole department's roster, starting from fortnightStart (a Monday).
  const handleExportPayroll = async (fortnightStart) => {
    if (!fortnightStart || !departmentId) return;

    setExportingPayroll(true);
    try {
      const [assignRes, staffRes] = await Promise.all([
        getAllStaffAssignmentsForRange(departmentId, fortnightStart, 14),
        getStaffList(departmentId),
      ]);
      if (assignRes.error) throw assignRes.error;
      if (staffRes.error) throw staffRes.error;

      downloadPayrollExcel({
        departmentName: refData.department?.name || 'Department',
        payCentreNumber: refData.department?.pay_centre_number || '',
        periodStart: fortnightStart,
        numDays: 14,
        staffList: staffRes.data,
        assignments: assignRes.data,
      });
      setError(null);
      setShowPayrollModal(false);
    } catch (err) {
      setError(`Failed to export payroll: ${err.message}`);
    } finally {
      setExportingPayroll(false);
    }
  };

  // Fortnight options offered in the payroll export modal: 14-day blocks
  // anchored to the Monday of the current week (2 past, this one, 3 ahead)
  // — there's no real payroll-period epoch in the data model, so "this
  // week" is treated as the start of a fortnight bucket by convention.
  const getPayrollFortnightOptions = () => {
    const anchor = getMondayOfWeek(new Date());
    return [-2, -1, 0, 1, 2, 3].map(offset => {
      const start = new Date(anchor);
      start.setDate(start.getDate() + offset * 14);
      const end = new Date(start);
      end.setDate(end.getDate() + 13);
      return { start, end };
    });
  };

  const getDateStatus = (date) => {
    // For MVP, return blank for all dates
    // Real implementation would query database for that date
    return 'blank';
  };

  const formatDate = (date) => date.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const isSameDate = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  // "Dr Sarah Jones" -> "SJ" — drops a leading title so initials reflect the
  // person's actual name, for the fortnight grid's brief per-day view.
  const getFirstName = (name) => {
    if (!name) return '?';
    const words = name.split(' ').filter(Boolean).filter(w => !/^(Dr|Mr|Mrs|Ms|Prof)\.?$/i.test(w));
    return words[0] || '?';
  };

  // Scoped to a specific theatre_activity (a Day activity and a Night
  // activity at the same location are independent, each with their own
  // consultant/registrar) — falls back to the old location-only match for
  // rows created before theatre_activity_id existed, so they don't just
  // disappear from the roster.
  const getAssignmentsForActivity = (theatreActivityId, locationId) => {
    const scoped = staffAssignments.filter(a => a.theatre_activity_id === theatreActivityId);
    if (scoped.length > 0) return scoped;
    return staffAssignments.filter(a => !a.theatre_activity_id && a.location_id === locationId);
  };

  const toDraftEntry = (a) => ({
    localId: a.assignment_id,
    assignmentId: a.assignment_id,
    staffId: a.staff_id,
    staffName: a.staff?.name,
    role: a.role,
    shiftId: a.shift_id,
    onCall: !!a.on_call,
    fatigueOverrideReason: a.fatigue_override_reason,
    leaveCode: a.leave_code,
  });

  // The staffing list a card actually renders: its staged draft if one's in
  // progress, otherwise straight off staffAssignments. Any mutator below
  // (add/remove/toggle) materializes a draft the first time it's called for
  // a given activity, seeded from this same DB-derived list.
  const getDraftEntries = (theatreActivityId, locationId) => {
    return drafts[theatreActivityId] || getAssignmentsForActivity(theatreActivityId, locationId).map(toDraftEntry);
  };

  const addEntryToDraft = (theatreActivityId, locationId, entry) => {
    setDrafts(prev => ({
      ...prev,
      [theatreActivityId]: [...(prev[theatreActivityId] || getAssignmentsForActivity(theatreActivityId, locationId).map(toDraftEntry)), entry],
    }));
  };

  // A shift long enough to span more than one of Morning/Afternoon/Night
  // (e.g. 10:30-22:00) shouldn't need adding by hand to every other card
  // for the SAME activity at this location that falls inside it — that's
  // the same person, same shift, same task, just a different card because
  // each session's slice of the day is its own theatre_activities row
  // (e.g. an "ED" activity split into a Morning card and a Night card). So
  // once the person's shift is known to cover >1 group (getSessionGroups
  // on the shift itself), auto-stage the same staffId/role/shiftId onto
  // every sibling card with the same activity_id at this location+date
  // whose own time window overlaps one of those groups too — skipping any
  // where they're already an entry.
  //
  // Deliberately scoped to the same activity_id, not just the same
  // location: the shared "On Call" location (see syncDutyOnCallActivity)
  // can host several genuinely distinct, simultaneous duty types — e.g.
  // ED On-Call and Anaesthetics On-Call both overnight — and matching on
  // location alone wrongly copied someone assigned to one duty type's card
  // onto every other duty type's card there too.
  //
  // Each card's own Complete Allocation still has to be run to commit and
  // to re-check consultant cover, same as any other draft change.
  const cascadeAssignmentAcrossSections = (theatreActivityId, locationId, shiftId, staffId, staffName, role) => {
    const shift = refData.shifts.find(s => s.shift_id === shiftId);
    const shiftGroups = getSessionGroups(shift);
    if (shiftGroups.length <= 1) return;

    const originActivityId = theatreActivities.find(t => t.theatre_activity_id === theatreActivityId)?.activity_id;
    if (!originActivityId) return;

    theatreActivities
      .filter(sibling => sibling.location_id === locationId && sibling.activity_id === originActivityId && sibling.theatre_activity_id !== theatreActivityId)
      .forEach(sibling => {
        const siblingGroups = getSessionGroups({ start_time: sibling.start_time, end_time: sibling.end_time });
        if (!siblingGroups.some(g => shiftGroups.includes(g))) return;

        const siblingEntries = getDraftEntries(sibling.theatre_activity_id, sibling.location_id);
        if (siblingEntries.some(e => e.staffId === staffId && e.role === role)) return;

        addEntryToDraft(sibling.theatre_activity_id, sibling.location_id, {
          localId: crypto.randomUUID(),
          assignmentId: null,
          staffId,
          staffName,
          role,
          shiftId,
          onCall: false,
          fatigueOverrideReason: null,
          leaveCode: null,
        });
      });
  };

  const removeEntryFromDraft = (theatreActivityId, locationId, localId) => {
    setDrafts(prev => ({
      ...prev,
      [theatreActivityId]: (prev[theatreActivityId] || getAssignmentsForActivity(theatreActivityId, locationId).map(toDraftEntry)).filter(e => e.localId !== localId),
    }));
  };

  const toggleOnCallInDraft = (theatreActivityId, locationId, localId) => {
    setDrafts(prev => ({
      ...prev,
      [theatreActivityId]: (prev[theatreActivityId] || getAssignmentsForActivity(theatreActivityId, locationId).map(toDraftEntry))
        .map(e => (e.localId === localId ? { ...e, onCall: !e.onCall } : e)),
    }));
  };

  // Commits a card's staged draft: diffs it against what's actually in the
  // DB (by assignment_id) and issues exactly the inserts/updates/deletes
  // needed, rather than blowing away and recreating everything. Warns
  // (non-blocking, needs a second click) if the result has no consultant —
  // present or on-call both count, only zero consultants trips it.
  const handleCompleteAllocation = async (ta, confirmNoConsultant = false) => {
    const entries = getDraftEntries(ta.theatre_activity_id, ta.location_id);

    if (!entries.some(e => e.role === 'consultant') && !confirmNoConsultant) {
      setNoConsultantConfirm({ theatreActivityId: ta.theatre_activity_id });
      return;
    }
    setNoConsultantConfirm(null);

    try {
      const original = getAssignmentsForActivity(ta.theatre_activity_id, ta.location_id);
      const originalIds = new Set(original.map(a => a.assignment_id));
      const keptIds = new Set(entries.filter(e => e.assignmentId).map(e => e.assignmentId));
      const filledRoles = new Set();

      for (const id of originalIds) {
        if (!keptIds.has(id)) {
          const { error } = await deleteStaffAssignment(id);
          if (error) throw error;
        }
      }

      for (const entry of entries) {
        filledRoles.add(entry.role);
        if (!entry.assignmentId) {
          const { error } = await createStaffAssignment(
            departmentId, selectedDate, ta.location_id, entry.staffId, entry.shiftId,
            entry.role, entry.fatigueOverrideReason, ta.theatre_activity_id, entry.onCall
          );
          if (error) throw error;
        } else {
          const originalEntry = original.find(a => a.assignment_id === entry.assignmentId);
          const changed = originalEntry && (originalEntry.on_call !== entry.onCall || originalEntry.shift_id !== entry.shiftId);
          if (changed) {
            const { error } = await updateStaffAssignment(
              entry.assignmentId, entry.staffId, entry.role, entry.shiftId,
              entry.fatigueOverrideReason, ta.theatre_activity_id, entry.onCall
            );
            if (error) throw error;
          }
        }
      }

      const { data, error: fetchError } = await getStaffAssignmentsForDate(departmentId, selectedDate);
      if (fetchError) throw fetchError;
      setStaffAssignments(data);

      setDrafts(prev => {
        const next = { ...prev };
        delete next[ta.theatre_activity_id];
        return next;
      });

      for (const role of filledRoles) {
        await clearVolunteerRequestsForRole(ta.theatre_activity_id, role);
      }
      await refreshVolunteerRequests();
      setError(null);
    } catch (err) {
      setError(`Failed to complete allocation: ${err.message}`);
    }
  };

  const handleDiscardDraft = (theatreActivityId) => {
    setDrafts(prev => {
      const next = { ...prev };
      delete next[theatreActivityId];
      return next;
    });
    setNoConsultantConfirm(prev => (prev?.theatreActivityId === theatreActivityId ? null : prev));
  };

  const getConsultantAllocationCount = (staffId) => {
    if (!selectedDate) return 0;
    return staffAssignments.filter(a => a.staff_id === staffId && a.role === 'consultant').length;
  };

  const StaffBadge = ({ name, clickable = true }) => (
    <button
      onClick={() => clickable && setSelectedStaff(name)}
      className="px-3 py-2 text-sm rounded font-medium transition bg-blue-100 text-blue-900 hover:bg-blue-200"
    >
      {name}
    </button>
  );

  const FatigueRiskBadge = () => (
    <span
      title="Was on overnight on-call the night before — flagged as a fatigue risk"
      className="px-2 py-0.5 bg-orange-100 text-orange-800 text-xs font-semibold rounded border border-orange-300"
    >
      ⚠ Fatigue Risk
    </span>
  );

  const ActivityRestrictionBadge = () => (
    <span
      title="This staff member marked themselves as unable to do this activity — assigned anyway"
      className="px-2 py-0.5 bg-red-100 text-red-800 text-xs font-semibold rounded border border-red-300"
    >
      ⚠ Restricted Activity
    </span>
  );

  // Optional leave/special code on an existing staff assignment (e.g. "Cairns
  // Leave" recorded against a day someone's rostered but actually on leave).
  // Shown as a small badge with an edit popover — never required, so an
  // assignment with no leave_code just shows a muted "+ Leave code" prompt.
  const LEAVE_CODE_CUSTOM = '__custom__';
  const LeaveCodeControl = ({ assignment }) => {
    const isEditing = editingLeaveCode?.assignmentId === assignment.assignment_id;

    if (isEditing) {
      const matchesPreset = refData.leaveTypes.some(lt => lt.code === editingLeaveCode.value);
      const selectValue = editingLeaveCode.value === '' ? '' : (matchesPreset ? editingLeaveCode.value : LEAVE_CODE_CUSTOM);

      return (
        <div className="flex items-center gap-1">
          <select
            value={selectValue}
            onChange={(e) => {
              const next = e.target.value === LEAVE_CODE_CUSTOM ? '' : e.target.value;
              setEditingLeaveCode({ assignmentId: assignment.assignment_id, value: next });
            }}
            className="px-2 py-1 border border-gray-300 rounded text-xs"
          >
            <option value="">— No leave/special code —</option>
            {refData.leaveTypes.map(lt => (
              <option key={lt.leave_type_id} value={lt.code}>{lt.name}</option>
            ))}
            <option value={LEAVE_CODE_CUSTOM}>Custom…</option>
          </select>
          {(selectValue === LEAVE_CODE_CUSTOM) && (
            <input
              type="text"
              autoFocus
              placeholder="Custom code"
              value={editingLeaveCode.value}
              onChange={(e) => setEditingLeaveCode({ assignmentId: assignment.assignment_id, value: e.target.value })}
              className="px-2 py-1 border border-gray-300 rounded text-xs w-28"
            />
          )}
          <button onClick={handleSaveLeaveCode} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition">
            Save
          </button>
          <button onClick={() => setEditingLeaveCode(null)} className="px-2 py-1 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded text-xs transition">
            Cancel
          </button>
        </div>
      );
    }

    return (
      <button
        onClick={() => setEditingLeaveCode({ assignmentId: assignment.assignment_id, value: assignment.leave_code || '' })}
        className={assignment.leave_code
          ? 'px-2 py-0.5 bg-purple-100 text-purple-900 text-xs font-semibold rounded border border-purple-300'
          : 'text-xs text-gray-400 italic hover:text-gray-600'}
      >
        {assignment.leave_code || '+ Leave code'}
      </button>
    );
  };

  // ============================================================
  // RENDER CONTENT
  // ============================================================

  const renderContent = () => {
    if (activeTab === 'calendar') {
      const today = new Date();
      const days = [];
      for (let i = 0; i < CALENDAR_DAYS_SHOWN; i++) {
        const d = new Date(calendarWeekStart);
        d.setDate(d.getDate() + i);
        days.push(d);
      }

      return (
        <div className="p-4">
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <div className="flex items-center justify-between mb-6">
                <button
                  onClick={() => {
                    const d = new Date(calendarWeekStart);
                    d.setDate(d.getDate() - 7);
                    setCalendarWeekStart(d);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <ChevronLeft size={24} />
                </button>
                <h1 className="text-lg font-bold text-gray-900 text-center">
                  {days[0].toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  {' – '}
                  {days[days.length - 1].toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </h1>
                <button
                  onClick={() => {
                    const d = new Date(calendarWeekStart);
                    d.setDate(d.getDate() + 7);
                    setCalendarWeekStart(d);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <ChevronRight size={24} />
                </button>
              </div>

              <button
                onClick={() => setShowPayrollModal(true)}
                className="mb-6 px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white font-medium rounded-lg transition text-sm"
              >
                Export to Payroll
              </button>

              <div className="grid grid-cols-7 gap-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="text-center text-xs font-bold text-gray-600 py-2">
                    {day}
                  </div>
                ))}

                {days.map((date, idx) => {
                  const isToday = isSameDate(date, today);
                  const isFirstOfMonth = date.getDate() === 1;
                  const dateStr = toLocalDateStr(date);
                  const status = calendarAllocationStatus[dateStr] || 'none';
                  const statusStyle = ALLOCATION_STATUS_STYLES[status];
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        setSelectedDate(date);
                        setActiveTab('day');
                      }}
                      title={statusStyle.label}
                      className={`aspect-square p-2 rounded-lg font-semibold text-sm transition flex flex-col items-center justify-center gap-0.5 border-2 cursor-pointer ${statusStyle.classes} ${
                        isToday ? 'ring-2 ring-blue-600 ring-offset-1' : ''
                      }`}
                    >
                      {isFirstOfMonth && (
                        <span className="text-[10px] font-medium uppercase opacity-75 leading-none">
                          {date.toLocaleDateString('en-AU', { month: 'short' })}
                        </span>
                      )}
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-3 mt-4">
                {Object.entries(ALLOCATION_STATUS_STYLES).map(([key, style]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <span className={`w-3 h-3 rounded border ${style.swatch}`} />
                    <span className="text-xs text-gray-600">{style.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {showPayrollModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-lg w-full max-w-sm">
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-900">Export to Payroll</h2>
                  <button onClick={() => setShowPayrollModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                    <X size={20} />
                  </button>
                </div>
                <div className="p-4">
                  <p className="text-xs text-gray-600 mb-3">
                    Pick the fortnight to export — the whole department's roster for those 14 days.
                  </p>
                  <div className="space-y-2">
                    {getPayrollFortnightOptions().map(({ start, end }) => (
                      <button
                        key={toLocalDateStr(start)}
                        onClick={() => handleExportPayroll(start)}
                        disabled={exportingPayroll}
                        className="w-full text-left px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 transition"
                      >
                        {start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        {' – '}
                        {end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {isSameDate(getMondayOfWeek(new Date()), start) && (
                          <span className="ml-2 text-xs text-blue-600 font-semibold">(current)</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {exportingPayroll && <p className="text-xs text-gray-500 mt-3">Exporting…</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (activeTab === 'fortnight') {
      const days = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date(fortnightStart);
        d.setDate(d.getDate() + i);
        days.push(d);
      }

      const allocationsByDate = {};
      fortnightAllocations.forEach(a => {
        (allocationsByDate[a.date] = allocationsByDate[a.date] || []).push(a);
      });

      // Per-activity abbreviation for the grid's abridged cells — set in
      // Settings → Activities, falling back to the full name so an unset
      // abbreviation doesn't just disappear.
      const activityLabelFor = (a) => {
        const activityId = a.theatre_activities?.activity_id;
        if (!activityId) return null;
        const activity = refData.activities.find(act => act.activity_id === activityId);
        return activity?.abbreviation || activity?.name || null;
      };

      // Session code(s) an assignment's own shift bridges — reuses the same
      // getSessionGroups logic the Day view groups cards by, rather than
      // picking just the earliest, so a long shift spanning e.g. AM into
      // Night shows as "AM/Night" and not a misleadingly narrow "AM".
      const SESSION_LABEL = { morning: 'AM', afternoon: 'PM', night: 'Night' };
      const sessionLabelsFor = (a) => getSessionGroups(a.shifts).map(g => SESSION_LABEL[g]);

      // One entry per person, further grouped by activity — used by both
      // the grid's abridged day cells and the modal's "Already on this
      // day" list, so the two always read the same way.
      const groupAllocationsByStaff = (allocations) => {
        const byStaff = new Map();
        allocations.forEach(a => {
          if (!byStaff.has(a.staff_id)) {
            byStaff.set(a.staff_id, { staffId: a.staff_id, name: a.staff?.name, activityGroups: new Map(), assignmentIds: [] });
          }
          const person = byStaff.get(a.staff_id);
          person.assignmentIds.push(a.assignment_id);
          const activityKey = a.theatre_activities?.activity_id || 'none';
          if (!person.activityGroups.has(activityKey)) {
            person.activityGroups.set(activityKey, { label: activityLabelFor(a), sessions: new Set() });
          }
          const group = person.activityGroups.get(activityKey);
          sessionLabelsFor(a).forEach(s => group.sessions.add(s));
        });
        return byStaff;
      };

      const selectedStaff = refData.staff.find(s => s.staff_id === fortnightSelectedStaffId);
      const selectedStaffAllocations = fortnightAllocations.filter(a => a.staff_id === fortnightSelectedStaffId);
      // Shifts, not assignment rows: a day where someone covers two
      // activities (e.g. AM Endoscopy then PM Anaesthetics) is one day off
      // their FTE count, not two, so this counts distinct dates.
      const selectedStaffDatesCovered = new Set(selectedStaffAllocations.map(a => a.date)).size;
      const expectedShifts = selectedStaff ? (selectedStaff.fte ?? DEFAULT_FTE) * 10 : 0;
      const remainingShifts = expectedShifts - selectedStaffDatesCovered;

      const modalDateStr = fortnightModalDate ? toLocalDateStr(fortnightModalDate) : null;
      const modalDateAllocations = modalDateStr ? (allocationsByDate[modalDateStr] || []) : [];
      const activeShifts = refData.shifts.filter(s => s.active !== false && !/on.?call/i.test(s.name || ''));
      const activeLocations = refData.locations.filter(l => l.active !== false);
      const wizardShift = refData.shifts.find(s => s.shift_id === fortnightWizardShiftId);
      const wizardLocation = refData.locations.find(l => l.location_id === fortnightWizardLocationId);

      return (
        <div className="p-4 pb-24">
          <div className="max-w-3xl mx-auto">
            {error && (
              <div className="mb-6 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Staff picker + FTE counter */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Rank</label>
              <select
                value={fortnightRankFilter}
                onChange={(e) => { setFortnightRankFilter(e.target.value); setFortnightSelectedStaffId(''); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All ranks</option>
                {RANK_OPTIONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>

              <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Staff Member</label>
              <select
                value={fortnightSelectedStaffId}
                onChange={(e) => setFortnightSelectedStaffId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select a staff member —</option>
                {refData.staff.filter(s => s.active !== false && (!fortnightRankFilter || s.rank === fortnightRankFilter)).map(s => (
                  <option key={s.staff_id} value={s.staff_id}>{s.name} ({s.rank})</option>
                ))}
              </select>

              {selectedStaff ? (
                <div className={`mt-4 p-3 rounded-lg border ${remainingShifts < 0 ? 'bg-orange-50 border-orange-300' : 'bg-blue-50 border-blue-200'}`}>
                  <p className="text-sm font-semibold text-gray-900">
                    {selectedStaffDatesCovered} of {expectedShifts.toFixed(1)} shifts allocated this fortnight ({formatFte(selectedStaff.fte ?? DEFAULT_FTE)} FTE)
                  </p>
                  <p className={`text-xs mt-1 ${remainingShifts < 0 ? 'text-orange-700 font-semibold' : 'text-gray-600'}`}>
                    {remainingShifts >= 0 ? `${remainingShifts.toFixed(1)} remaining` : `${Math.abs(remainingShifts).toFixed(1)} over FTE`}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-500 mt-3">Select a staff member, then click a day below to allocate them a shift.</p>
              )}
            </div>

            {/* Fortnight grid */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => {
                    const d = new Date(fortnightStart);
                    d.setDate(d.getDate() - 14);
                    setFortnightStart(d);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <ChevronLeft size={24} />
                </button>
                <h1 className="text-lg font-bold text-gray-900 text-center">
                  {days[0].toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  {' – '}
                  {days[13].toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </h1>
                <button
                  onClick={() => {
                    const d = new Date(fortnightStart);
                    d.setDate(d.getDate() + 14);
                    setFortnightStart(d);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <ChevronRight size={24} />
                </button>
              </div>

              {loadingFortnight ? (
                <div className="text-center py-8">
                  <Loader size={32} className="text-blue-600 animate-spin mx-auto mb-2" />
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-2">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                    <div key={day} className="text-center text-xs font-bold text-gray-600 py-1">{day}</div>
                  ))}
                  {days.map((date, idx) => {
                    const dateStr = toLocalDateStr(date);
                    const dayAllocations = allocationsByDate[dateStr] || [];
                    const staffOwnAllocation = dayAllocations.find(a => a.staff_id === fortnightSelectedStaffId);

                    // One line per person per day, grouped further by
                    // activity — see groupAllocationsByStaff.
                    const byStaff = groupAllocationsByStaff(dayAllocations);

                    return (
                      <div
                        key={idx}
                        role="button"
                        tabIndex={fortnightSelectedStaffId ? 0 : -1}
                        onClick={() => fortnightSelectedStaffId && handleOpenFortnightModal(date)}
                        onKeyDown={(e) => { if (fortnightSelectedStaffId && (e.key === 'Enter' || e.key === ' ')) handleOpenFortnightModal(date); }}
                        title={!fortnightSelectedStaffId ? 'Select a staff member first' : undefined}
                        className={`min-h-[76px] p-1.5 rounded-lg border text-left align-top transition ${
                          !fortnightSelectedStaffId
                            ? 'border-gray-100 bg-gray-50 cursor-not-allowed'
                            : staffOwnAllocation
                              ? 'border-blue-400 bg-blue-50 hover:bg-blue-100 cursor-pointer'
                              : 'border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
                        }`}
                      >
                        <div className="text-xs font-semibold text-gray-700 mb-1">{date.getDate()}</div>
                        <div className="space-y-0.5">
                          {Array.from(byStaff.values()).map(person => (
                            <div
                              key={person.staffId}
                              className={`text-[10px] leading-tight px-1 py-0.5 rounded truncate flex items-center justify-between gap-1 ${
                                person.staffId === fortnightSelectedStaffId ? 'bg-blue-600 text-white font-semibold' : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              <span className="truncate">
                                {getFirstName(person.name)}
                                {Array.from(person.activityGroups.values()).map((group, i) => {
                                  const sessions = Array.from(group.sessions).join('/');
                                  return (
                                    <span key={i}> ({group.label ? `${group.label} - ` : ''}{sessions})</span>
                                  );
                                })}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveFortnightPersonDay(person.assignmentIds); }}
                                title={`Remove ${person.name}'s allocations for this day`}
                                className="flex-shrink-0 leading-none opacity-70 hover:opacity-100"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Fortnight Assignment Wizard — shift, then location, then
              activity, writing straight into staff_assignments/
              theatre_activities like the Day view does (see
              handleFortnightPickActivity/assignStaffFortnight). */}
          {fortnightModalDate && selectedStaff && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-red-600">{selectedStaff.name}</h2>
                    <p className="text-sm text-gray-600">
                      {fortnightModalDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                  </div>
                  <button onClick={handleCloseFortnightModal} className="p-1 hover:bg-gray-100 rounded-lg">
                    <X size={20} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Left: the assignment wizard */}
                  <div>
                    {/* Step breadcrumb — click an earlier step to go back and change it */}
                    {fortnightWizardStep !== 'shift' && (
                      <div className="mb-3 flex items-center gap-1 text-xs text-gray-500 flex-wrap">
                        <button onClick={() => setFortnightWizardStep('shift')} className="text-blue-600 hover:underline font-medium">
                          {wizardShift?.name}
                        </button>
                        {fortnightWizardStep === 'activity' && (
                          <>
                            <span>›</span>
                            <button onClick={() => setFortnightWizardStep('location')} className="text-blue-600 hover:underline font-medium">
                              {wizardLocation?.name}
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {fortnightWizardStep === 'shift' && (
                      <>
                        <p className="text-xs font-semibold text-gray-600 uppercase mb-2">1. Choose a shift</p>
                        {activeShifts.length === 0 ? (
                          <p className="text-sm text-gray-500">No shifts configured — add some in Settings.</p>
                        ) : (
                          <div className="space-y-2">
                            {activeShifts.map(shift => (
                              <button
                                key={shift.shift_id}
                                onClick={() => handleFortnightPickShift(shift.shift_id)}
                                className="w-full text-left px-3 py-2 rounded-lg text-sm border bg-white border-gray-300 hover:bg-blue-50 hover:border-blue-400 transition"
                              >
                                {shift.name} ({shift.start_time?.slice(0, 5)}–{shift.end_time?.slice(0, 5)})
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {fortnightWizardStep === 'location' && (
                      <>
                        <p className="text-xs font-semibold text-gray-600 uppercase mb-2">2. Choose a location</p>
                        {activeLocations.length === 0 ? (
                          <p className="text-sm text-gray-500">No locations configured — add some in Settings.</p>
                        ) : (
                          <div className="space-y-2">
                            {activeLocations.map(location => (
                              <button
                                key={location.location_id}
                                onClick={() => handleFortnightPickLocation(location.location_id)}
                                className="w-full text-left px-3 py-2 rounded-lg text-sm border bg-white border-gray-300 hover:bg-blue-50 hover:border-blue-400 transition"
                              >
                                {location.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {fortnightWizardStep === 'activity' && (
                      <>
                        <p className="text-xs font-semibold text-gray-600 uppercase mb-2">3. Choose an activity</p>
                        {activitiesAllowedAtLocation(fortnightWizardLocationId).length === 0 ? (
                          <p className="text-sm text-gray-500">No activities configured — add some in Settings.</p>
                        ) : (
                          <div className="space-y-2">
                            {activitiesAllowedAtLocation(fortnightWizardLocationId).map(activity => (
                              <button
                                key={activity.activity_id}
                                onClick={() => handleFortnightPickActivity(activity.activity_id)}
                                className="w-full text-left px-3 py-2 rounded-lg text-sm border bg-white border-gray-300 hover:bg-blue-50 hover:border-blue-400 transition"
                              >
                                {activity.name}{activity.abbreviation ? ` (${activity.abbreviation})` : ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Right: who's already on this day */}
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Already on this day</p>
                    {modalDateAllocations.length === 0 ? (
                      <p className="text-sm text-gray-400 italic">Nobody yet.</p>
                    ) : (
                      <div className="space-y-1 p-3 bg-gray-50 rounded-lg border border-gray-200">
                        {Array.from(groupAllocationsByStaff(modalDateAllocations).values()).map(person => (
                          <div key={person.staffId} className="flex items-start justify-between gap-2 py-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-semibold text-gray-900">{person.name}</span>
                              {person.staffId === fortnightSelectedStaffId && (
                                <span className="text-xs text-blue-600 font-semibold">(this person)</span>
                              )}
                              {Array.from(person.activityGroups.values()).map((group, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 bg-blue-50 text-blue-800 text-xs font-medium rounded-full border border-blue-200"
                                >
                                  {group.label ? `${group.label} · ` : ''}{Array.from(group.sessions).join('/')}
                                </span>
                              ))}
                            </div>
                            <button
                              onClick={() => handleRemoveFortnightPersonDay(person.assignmentIds)}
                              title="Removes all of this person's activities for the day"
                              className="text-xs text-red-600 hover:text-red-700 font-semibold flex-shrink-0"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (activeTab === 'day' && selectedDate && !loadingDate) {
      const getDutyStaffName = (dutyType) => {
        const staffId = dutyAssignments[dutyType];
        if (!staffId) return null;
        return refData.staff.find(s => s.staff_id === staffId)?.name;
      };

      // Every active shift a location assignment can use, one button each —
      // not a guess at "the" Whole Day/AM/PM/Night shift, because a
      // department can have more than one shift sharing a session (e.g. an
      // "AM" shift actually in use alongside an unused "Half Day" left over
      // from earlier setup). On-call shifts are excluded here: those are
      // assigned through the separate duty-roster system, not this picker.
      const SESSION_SORT_ORDER = { full: 0, AM: 1, PM: 2, evening: 3, night: 4 };
      const assignableShifts = refData.shifts
        .filter(s => s.active !== false && !/on.?call/i.test(s.name || ''))
        .slice()
        .sort((a, b) => (SESSION_SORT_ORDER[a.session] ?? 5) - (SESSION_SORT_ORDER[b.session] ?? 5) || (a.start_time || '').localeCompare(b.start_time || ''));
      const formatShiftTime = (shift) => (shift?.start_time && shift?.end_time ? ` (${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)})` : '');

      return (
        <div className="p-4">
          <div className="max-w-3xl mx-auto">
            {/* Copy Last Week's Activities / + Add Activity live in the
                fixed top bar (portaled via topBarActionsNode — see
                App.js), not here, so they stay reachable while scrolled
                down looking at a lower section instead of only next to the
                date. */}
            {topBarActionsNode && createPortal(
              <>
                <button
                  onClick={handleCopyLastWeek}
                  className="px-3 py-2 bg-green-500 hover:bg-green-600 text-white font-medium rounded text-sm transition"
                >
                  Copy Last Week's Activities
                </button>
                <button
                  onClick={() => setShowAddActivity(true)}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded text-sm transition"
                >
                  + Add Activity
                </button>
              </>,
              topBarActionsNode
            )}

            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    const d = new Date(selectedDate);
                    d.setDate(d.getDate() - 1);
                    setSelectedDate(d);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition flex-shrink-0"
                >
                  <ChevronLeft size={24} />
                </button>
                <div className="text-center">
                  <h1 className="text-2xl font-bold text-gray-900">{formatDate(selectedDate)}</h1>
                  <p className="text-sm text-gray-500">Large Rural Hospital — Rostering Officer</p>
                </div>
                <button
                  onClick={() => {
                    const d = new Date(selectedDate);
                    d.setDate(d.getDate() + 1);
                    setSelectedDate(d);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition flex-shrink-0"
                >
                  <ChevronRight size={24} />
                </button>
              </div>
              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                  <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            {/* Duty Assignments — one dropdown per duty_types row configured
                for this department in Settings (e.g. a rural roster covering
                ED/Obstetrics/Anaesthetics on call gets a duty type per
                specialty; the same person can be picked in more than one to
                represent them covering a combination). */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6 border-l-4 border-orange-500">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Duty Assignments</h2>
              {refData.dutyTypes.filter(d => d.active !== false).length === 0 ? (
                <p className="text-sm text-gray-500">No duty types configured — add one in Settings → Duty Types.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {refData.dutyTypes.filter(d => d.active !== false).map(dutyType => (
                    <div key={dutyType.duty_type_id}>
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">
                        {dutyType.label}
                      </label>
                      <select
                        value={dutyAssignments[dutyType.key] || ''}
                        onChange={(e) => handleDutyChange(dutyType.key, e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="" style={{ color: '#dc2626', fontStyle: 'italic' }}>— Clear Assignment —</option>
                        {getDutyStaffOptions(dutyType.key).map(s => (
                          <option key={s.staff_id} value={s.staff_id}>{s.name}{s.unavailable ? ' (unavailable)' : ''}</option>
                        ))}
                      </select>
                      {!getDutyStaffName(dutyType.key) && (
                        <p className="text-xs text-red-500 italic mt-1">Unassigned</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Theatre Assignments — grouped into Morning/Afternoon/Night so a
                whole day's roster doesn't read as one flat, interleaved list.
                A Whole Day activity spans both Morning and Afternoon, so it's
                rendered (with a group-qualified key) in both sections. */}
            {(() => {
              const groupedActivities = { morning: [], afternoon: [], night: [] };
              theatreActivities.forEach(ta => {
                getSessionGroups({ start_time: ta.start_time, end_time: ta.end_time }).forEach(group => groupedActivities[group].push(ta));
              });

              const renderActivityCard = (ta, groupKey) => {
                const entries = getDraftEntries(ta.theatre_activity_id, ta.location_id);
                const hasDraft = !!drafts[ta.theatre_activity_id];
                // The card itself can span more than one session group (e.g.
                // a Whole Day activity covers both Morning and Afternoon),
                // but any one person's own shift might only cover part of
                // that span — an AM-only person on an otherwise Whole Day
                // activity shouldn't show under its Afternoon rendering too.
                // So each of this card's renderings (one per group it spans)
                // only lists the people whose own shift actually covers
                // *this* groupKey, not everyone on the activity.
                const entryCoversGroup = (entry) => getSessionGroups(refData.shifts.find(s => s.shift_id === entry.shiftId)).includes(groupKey);
                const consultantEntries = entries.filter(e => e.role === 'consultant' && entryCoversGroup(e));
                const registrarEntries = entries.filter(e => e.role === 'registrar' && entryCoversGroup(e));
                const consultantPending = pendingAssignment?.theatreActivityId === ta.theatre_activity_id && pendingAssignment.role === 'consultant';
                const registrarPending = pendingAssignment?.theatreActivityId === ta.theatre_activity_id && pendingAssignment.role === 'registrar';
                const consultantOverride = overridePrompt?.theatreActivityId === ta.theatre_activity_id && overridePrompt.role === 'consultant';
                const registrarOverride = overridePrompt?.theatreActivityId === ta.theatre_activity_id && overridePrompt.role === 'registrar';
                const consultantPatternAlert = patternRuleAlert?.theatreActivityId === ta.theatre_activity_id && patternRuleAlert.role === 'consultant';
                const registrarPatternAlert = patternRuleAlert?.theatreActivityId === ta.theatre_activity_id && patternRuleAlert.role === 'registrar';

                const ShiftTypePicker = ({ role }) => {
                  const dayShiftsBlocked = fatigueStatus.nightCooldownStaffIds.has(pendingAssignment.staffId);

                  const pickDayShift = (shift) => {
                    if (dayShiftsBlocked) {
                      setOverridePrompt({
                        theatreActivityId: ta.theatre_activity_id,
                        locationId: ta.location_id,
                        role,
                        staffId: pendingAssignment.staffId,
                        staffName: pendingAssignment.staffName,
                        blockType: 'night_cooldown',
                        shiftId: shift.shift_id,
                        reason: '',
                      });
                      setPendingAssignment(null);
                      return;
                    }
                    handleAssignStaff(ta.theatre_activity_id, ta.location_id, shift.shift_id, pendingAssignment.staffId, role, pendingAssignment.overrideReason);
                  };

                  return (
                    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs font-semibold text-gray-700 mb-2">
                        Choose shift for {pendingAssignment.staffName}:
                      </p>
                      {dayShiftsBlocked && (
                        <p className="text-xs text-orange-700 mb-2">
                          Just finished a run of nights — needs one more day off before a Day shift (override available). Night is unaffected.
                        </p>
                      )}
                      <div className="flex gap-2 flex-wrap">
                        {assignableShifts.map(shift => {
                          const isNight = shift.session === 'night';
                          return (
                            <button
                              key={shift.shift_id}
                              title={!isNight && dayShiftsBlocked ? 'Still in post-night cooldown — click to override' : undefined}
                              onClick={() => (isNight
                                ? handleAssignStaff(ta.theatre_activity_id, ta.location_id, shift.shift_id, pendingAssignment.staffId, role, pendingAssignment.overrideReason)
                                : pickDayShift(shift))}
                              className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition ${
                                isNight
                                  ? 'bg-indigo-700 hover:bg-indigo-800 text-white'
                                  : dayShiftsBlocked
                                    ? 'bg-orange-100 hover:bg-orange-200 text-orange-800 border border-orange-300'
                                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                              }`}
                            >
                              {shift.name}{formatShiftTime(shift)}{!isNight && dayShiftsBlocked ? ' ⚠' : ''}
                            </button>
                          );
                        })}
                      </div>
                      {assignableShifts.length === 0 && (
                        <p className="text-xs text-gray-500 mt-2">
                          No shifts configured — add one in Settings → Shift Management.
                        </p>
                      )}
                      <button onClick={() => setPendingAssignment(null)} className="mt-2 text-xs text-gray-500 hover:text-gray-700">
                        Cancel
                      </button>
                    </div>
                  );
                };

                const OverridePanel = () => (
                  <div className="mt-2 p-3 bg-orange-50 border border-orange-300 rounded-lg">
                    <p className="text-xs font-semibold text-orange-800 mb-1">
                      ⚠ {overridePrompt.blockType === 'post_night_rest'
                        ? `${overridePrompt.staffName} worked a night shift yesterday and is due a mandatory rest day.`
                        : `${overridePrompt.staffName} is still in the post-night cooldown period.`}
                    </p>
                    <p className="text-xs text-orange-700 mb-2">
                      Overriding this is a fatigue risk. Enter a reason (10+ characters) to proceed — it's recorded against the assignment.
                    </p>
                    <textarea
                      value={overridePrompt.reason}
                      onChange={(e) => setOverridePrompt({ ...overridePrompt, reason: e.target.value })}
                      placeholder="Reason for override (required)…"
                      rows={2}
                      className="w-full px-2 py-1.5 border border-orange-300 rounded text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setOverridePrompt(null)}
                        className="flex-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={overridePrompt.reason.trim().length < 10}
                        onClick={handleConfirmOverride}
                        className="flex-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition"
                      >
                        Confirm Override
                      </button>
                    </div>
                  </div>
                );

                const PatternRuleAlertPanel = () => {
                  const isBlock = patternRuleAlert.action === 'BLOCK';
                  return (
                    <div className={`mt-2 p-3 rounded-lg border ${isBlock ? 'bg-red-50 border-red-300' : 'bg-yellow-50 border-yellow-300'}`}>
                      <p className={`text-xs font-semibold mb-2 ${isBlock ? 'text-red-800' : 'text-yellow-800'}`}>
                        {isBlock ? '⛔' : '⚠'} Pattern violation: {patternRuleAlert.description}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPatternRuleAlert(null)}
                          className="flex-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition"
                        >
                          Cancel
                        </button>
                        {!isBlock && (
                          <button
                            onClick={handleConfirmPatternOverride}
                            className="flex-1 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-semibold rounded-lg transition"
                          >
                            Override
                          </button>
                        )}
                      </div>
                    </div>
                  );
                };

                return (
                <div key={`${ta.theatre_activity_id}-${groupKey}`} className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-blue-500">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Activity</label>
                      <select
                        value={ta.activity_id || ''}
                        onChange={(e) => handleActivityChange(ta.theatre_activity_id, e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-gray-900"
                      >
                        {activityOptionsFor(ta.location_id, ta.activity_id).map(act => (
                          <option key={act.activity_id} value={act.activity_id}>{act.name}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={() => handleRemoveActivity(ta)}
                      title="Remove this location for the day"
                      className="p-2 mt-5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition flex-shrink-0"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 mb-4 flex-wrap">
                    <h3 className="text-lg font-bold text-gray-900">
                      {ta.locations.name}
                      {ta.shifts?.name && <span className="ml-2 text-sm font-normal text-gray-500">({ta.shifts.name})</span>}
                    </h3>
                    <div className="flex items-center gap-1">
                      <input
                        type="time"
                        value={ta.start_time?.slice(0, 5) || ''}
                        onChange={(e) => handleActivityTimesChange(ta, e.target.value, ta.end_time?.slice(0, 5))}
                        title="When this activity actually runs — decides which Allocations section(s) it groups under"
                        className="px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <span className="text-gray-400 text-xs">–</span>
                      <input
                        type="time"
                        value={ta.end_time?.slice(0, 5) || ''}
                        onChange={(e) => handleActivityTimesChange(ta, ta.start_time?.slice(0, 5), e.target.value)}
                        title="When this activity actually runs — decides which Allocations section(s) it groups under"
                        className="px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                    </div>
                    {getTotalVolunteerCount(ta.theatre_activity_id) > 0 && (
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-900 text-xs font-semibold rounded-full">
                        🙋 {getTotalVolunteerCount(ta.theatre_activity_id)} volunteer{getTotalVolunteerCount(ta.theatre_activity_id) === 1 ? '' : 's'} waiting
                      </span>
                    )}
                  </div>

                  {/* Consultant(s) */}
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Consultant</label>
                    {consultantEntries.length === 0 && (
                      <p className="text-xs text-gray-400 italic mb-2">Nobody allocated yet.</p>
                    )}
                    <div className="space-y-2 mb-2">
                      {consultantEntries.map(entry => {
                        const shift = refData.shifts.find(s => s.shift_id === entry.shiftId);
                        return (
                          <div key={entry.localId} className="flex items-center gap-2 flex-wrap p-2 bg-gray-50 rounded-lg border border-gray-200">
                            <StaffBadge name={entry.staffName} />
                            <span className="text-xs text-gray-500">({getConsultantAllocationCount(entry.staffId)}/2)</span>
                            {shift && (
                              <span className="text-xs text-gray-500">
                                {shift.name} ({shift.start_time?.slice(0, 5)}–{shift.end_time?.slice(0, 5)})
                              </span>
                            )}
                            <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={entry.onCall}
                                onChange={() => toggleOnCallInDraft(ta.theatre_activity_id, ta.location_id, entry.localId)}
                              />
                              On call
                            </label>
                            {fatigueStatus.fatigueRiskStaffIds.has(entry.staffId) && <FatigueRiskBadge />}
                            {isActivityRestricted(entry.staffId, ta.activity_id) && <ActivityRestrictionBadge />}
                            {entry.fatigueOverrideReason && (
                              <span
                                title={`Fatigue override: ${entry.fatigueOverrideReason}`}
                                className="px-2 py-0.5 bg-orange-600 text-white text-xs font-semibold rounded"
                              >
                                ⚠ Override
                              </span>
                            )}
                            {entry.assignmentId && <LeaveCodeControl assignment={{ assignment_id: entry.assignmentId, leave_code: entry.leaveCode }} />}
                            <button onClick={() => removeEntryFromDraft(ta.theatre_activity_id, ta.location_id, entry.localId)} className="text-red-600 hover:text-red-700 text-xs font-semibold">
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {consultantPending ? (
                      <ShiftTypePicker role="consultant" />
                    ) : consultantOverride ? (
                      <OverridePanel />
                    ) : consultantPatternAlert ? (
                      <PatternRuleAlertPanel />
                    ) : (
                      <button
                        onClick={() => setOpenDropdown(openDropdown === `${ta.theatre_activity_id}-consultant` ? null : `${ta.theatre_activity_id}-consultant`)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-left bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        + Add Consultant
                      </button>
                    )}
                    {!consultantPending && !consultantOverride && !consultantPatternAlert && openDropdown === `${ta.theatre_activity_id}-consultant` && (() => {
                      const selectStaff = (s, blocked, overridable, blockType, label) => {
                        if (blocked && !overridable) return;
                        if (blocked && overridable) {
                          setOverridePrompt({ theatreActivityId: ta.theatre_activity_id, locationId: ta.location_id, role: 'consultant', staffId: s.staff_id, staffName: s.name, blockType, shiftId: null, reason: '' });
                          setOpenDropdown(null);
                          return;
                        }
                        setPendingAssignment({ theatreActivityId: ta.theatre_activity_id, locationId: ta.location_id, role: 'consultant', staffId: s.staff_id, staffName: s.name, overrideReason: null });
                      };
                      const volunteers = getVolunteersForActivity(ta.theatre_activity_id, 'consultant');
                      const volunteerIds = new Set(volunteers.map(v => v.staff_id));

                      return (
                        <div className="mt-2 bg-white border border-gray-300 rounded-lg shadow-lg p-2 max-h-48 overflow-y-auto">
                          {volunteers.map(s => {
                            const { blocked, overridable, blockType, label } = getAssignabilityInfo(s.staff_id);
                            const hardBlocked = blocked && !overridable;
                            return (
                              <button
                                key={`volunteer-${s.staff_id}`}
                                onClick={() => selectStaff(s, blocked, overridable, blockType, label)}
                                disabled={hardBlocked}
                                title={hardBlocked ? `Not confirmed available for this date${label}` : 'Volunteered for this role'}
                                className={`w-full text-left px-3 py-2 rounded text-sm mb-1 border ${
                                  hardBlocked ? 'text-gray-400 cursor-not-allowed bg-gray-50 border-gray-200' : 'bg-purple-50 border-purple-200 text-purple-900 hover:bg-purple-100'
                                }`}
                              >
                                🙋 {s.name}{label}
                              </button>
                            );
                          })}
                          {getRankedStaffOptions(ta.activity_id, s => (s.rank === 'consultant' || s.rank === 'fellow') && !volunteerIds.has(s.staff_id) && !consultantEntries.some(ce => ce.staffId === s.staff_id)).map(s => {
                            const { blocked, overridable, blockType, label, fatigueRisk } = getAssignabilityInfo(s.staff_id);
                            const hardBlocked = blocked && !overridable;
                            const restricted = isActivityRestricted(s.staff_id, ta.activity_id);
                            return (
                              <button
                                key={s.staff_id}
                                onClick={() => selectStaff(s, blocked, overridable, blockType, label)}
                                disabled={hardBlocked}
                                title={hardBlocked ? `Not confirmed available for this date${label}` : blocked ? `Requires override${label}` : restricted ? 'Marked themselves as unable to do this activity — can still be assigned' : undefined}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${
                                  hardBlocked ? 'text-gray-400 cursor-not-allowed bg-gray-50' : blocked ? 'text-orange-700 hover:bg-orange-50' : restricted ? 'text-red-700 hover:bg-red-50' : 'hover:bg-blue-50'
                                }`}
                              >
                                {s.name} ({getConsultantAllocationCount(s.staff_id)}/2){typeof s.exposure_rate === 'number' ? ` — ${s.exposure_rate}% exposure` : ''}{label}
                                {blocked && overridable && <span className="font-semibold"> (override required)</span>}
                                {fatigueRisk && <span className="text-orange-600 font-semibold"> ⚠ Fatigue risk (overnight on-call)</span>}
                                {restricted && <span className="text-red-600 font-semibold"> ⚠ Can't do this activity (by preference)</span>}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Registrar */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Registrar</label>
                    {registrarEntries.length === 0 && (
                      <p className="text-xs text-gray-400 italic mb-2">Nobody allocated yet.</p>
                    )}
                    <div className="space-y-2 mb-2">
                      {registrarEntries.map(entry => {
                        const shift = refData.shifts.find(s => s.shift_id === entry.shiftId);
                        return (
                          <div key={entry.localId} className="flex items-center gap-2 flex-wrap p-2 bg-gray-50 rounded-lg border border-gray-200">
                            <StaffBadge name={entry.staffName} />
                            {shift && (
                              <span className="text-xs text-gray-500">
                                {shift.name} ({shift.start_time?.slice(0, 5)}–{shift.end_time?.slice(0, 5)})
                              </span>
                            )}
                            {fatigueStatus.fatigueRiskStaffIds.has(entry.staffId) && <FatigueRiskBadge />}
                            {isActivityRestricted(entry.staffId, ta.activity_id) && <ActivityRestrictionBadge />}
                            {entry.fatigueOverrideReason && (
                              <span
                                title={`Fatigue override: ${entry.fatigueOverrideReason}`}
                                className="px-2 py-0.5 bg-orange-600 text-white text-xs font-semibold rounded"
                              >
                                ⚠ Override
                              </span>
                            )}
                            {entry.assignmentId && <LeaveCodeControl assignment={{ assignment_id: entry.assignmentId, leave_code: entry.leaveCode }} />}
                            <button onClick={() => removeEntryFromDraft(ta.theatre_activity_id, ta.location_id, entry.localId)} className="text-red-600 hover:text-red-700 text-xs font-semibold">
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {registrarPending ? (
                      <ShiftTypePicker role="registrar" />
                    ) : registrarOverride ? (
                      <OverridePanel />
                    ) : registrarPatternAlert ? (
                      <PatternRuleAlertPanel />
                    ) : (
                      <button
                        onClick={() => setOpenDropdown(openDropdown === `${ta.theatre_activity_id}-registrar` ? null : `${ta.theatre_activity_id}-registrar`)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-left bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        + Add Registrar
                      </button>
                    )}
                    {!registrarPending && !registrarOverride && !registrarPatternAlert && openDropdown === `${ta.theatre_activity_id}-registrar` && (() => {
                      const selectStaff = (s, blocked, overridable, blockType, label) => {
                        if (blocked && !overridable) return;
                        if (blocked && overridable) {
                          setOverridePrompt({ theatreActivityId: ta.theatre_activity_id, locationId: ta.location_id, role: 'registrar', staffId: s.staff_id, staffName: s.name, blockType, shiftId: null, reason: '' });
                          setOpenDropdown(null);
                          return;
                        }
                        setPendingAssignment({ theatreActivityId: ta.theatre_activity_id, locationId: ta.location_id, role: 'registrar', staffId: s.staff_id, staffName: s.name, overrideReason: null });
                      };
                      const volunteers = getVolunteersForActivity(ta.theatre_activity_id, 'registrar');
                      const volunteerIds = new Set(volunteers.map(v => v.staff_id));

                      return (
                        <div className="mt-2 bg-white border border-gray-300 rounded-lg shadow-lg p-2 max-h-48 overflow-y-auto">
                          {volunteers.map(s => {
                            const { blocked, overridable, blockType, label } = getAssignabilityInfo(s.staff_id);
                            const hardBlocked = blocked && !overridable;
                            return (
                              <button
                                key={`volunteer-${s.staff_id}`}
                                onClick={() => selectStaff(s, blocked, overridable, blockType, label)}
                                disabled={hardBlocked}
                                title={hardBlocked ? `Not confirmed available for this date${label}` : 'Volunteered for this role'}
                                className={`w-full text-left px-3 py-2 rounded text-sm mb-1 border ${
                                  hardBlocked ? 'text-gray-400 cursor-not-allowed bg-gray-50 border-gray-200' : 'bg-purple-50 border-purple-200 text-purple-900 hover:bg-purple-100'
                                }`}
                              >
                                🙋 {s.name}{label}
                              </button>
                            );
                          })}
                          {getRankedStaffOptions(ta.activity_id, s => (s.rank.includes('trainee') || s.rank === 'intern') && !volunteerIds.has(s.staff_id) && !registrarEntries.some(re => re.staffId === s.staff_id)).map(s => {
                            const { blocked, overridable, blockType, label, fatigueRisk } = getAssignabilityInfo(s.staff_id);
                            const hardBlocked = blocked && !overridable;
                            const restricted = isActivityRestricted(s.staff_id, ta.activity_id);
                            return (
                              <button
                                key={s.staff_id}
                                onClick={() => selectStaff(s, blocked, overridable, blockType, label)}
                                disabled={hardBlocked}
                                title={hardBlocked ? `Not confirmed available for this date${label}` : blocked ? `Requires override${label}` : restricted ? 'Marked themselves as unable to do this activity — can still be assigned' : undefined}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${
                                  hardBlocked ? 'text-gray-400 cursor-not-allowed bg-gray-50' : blocked ? 'text-orange-700 hover:bg-orange-50' : restricted ? 'text-red-700 hover:bg-red-50' : 'hover:bg-blue-50'
                                }`}
                              >
                                {s.name}{typeof s.exposure_rate === 'number' ? ` — ${s.exposure_rate}% exposure` : ''}{label}
                                {blocked && overridable && <span className="font-semibold"> (override required)</span>}
                                {fatigueRisk && <span className="text-orange-600 font-semibold"> ⚠ Fatigue risk (overnight on-call)</span>}
                                {restricted && <span className="text-red-600 font-semibold"> ⚠ Can't do this activity (by preference)</span>}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Complete Allocation — commits this card's staged
                      add/remove/on-call edits (see getDraftEntries /
                      handleCompleteAllocation). Nothing above this point has
                      touched the DB yet. */}
                  <div className="mt-4 pt-4 border-t border-gray-200 flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => handleCompleteAllocation(ta)}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition"
                    >
                      Complete Allocation
                    </button>
                    {hasDraft ? (
                      <button
                        onClick={() => handleDiscardDraft(ta.theatre_activity_id)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Discard unsaved changes
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">No unsaved changes</span>
                    )}
                  </div>

                  {noConsultantConfirm?.theatreActivityId === ta.theatre_activity_id && (
                    <div className="mt-2 p-3 bg-orange-50 border border-orange-300 rounded-lg">
                      <p className="text-xs font-semibold text-orange-800 mb-2">
                        ⚠ No supervising consultant allocated (present or on call). Save anyway?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setNoConsultantConfirm(null)}
                          className="flex-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition"
                        >
                          Go Back
                        </button>
                        <button
                          onClick={() => handleCompleteAllocation(ta, true)}
                          className="flex-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-lg transition"
                        >
                          Save Anyway
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                );
              };

              return (
                <div className="space-y-6">
                  {SESSION_GROUP_ORDER.map(groupKey => (
                    <CollapsibleSection key={groupKey} title={SESSION_GROUP_LABELS[groupKey]} defaultOpen={true}>
                      {groupedActivities[groupKey].length === 0 ? (
                        <p className="text-sm text-gray-500">No activities scheduled.</p>
                      ) : (
                        <div className="space-y-4">
                          {groupedActivities[groupKey].map(ta => renderActivityCard(ta, groupKey))}
                        </div>
                      )}
                    </CollapsibleSection>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      );
    }

    if (activeTab === 'settings') {
      return (
        <div className="p-4">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

            {error && (
              <div className="mb-6 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Department Settings Section */}
            <CollapsibleSection title="Department Settings">
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Pay Centre Number</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g., PC-1234"
                  value={payCentreNumberInput}
                  onChange={(e) => setPayCentreNumberInput(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <button
                  onClick={handleSavePayCentreNumber}
                  disabled={savingPayCentreNumber}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
                >
                  {savingPayCentreNumber ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">Printed in the header row of the payroll Excel export.</p>
            </CollapsibleSection>

            {/* Shifts Section */}
            <CollapsibleSection title="Shifts">
              <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <input
                    type="text"
                    placeholder="Shift name (e.g., 'Full Day')"
                    value={newShiftName}
                    onChange={(e) => setNewShiftName(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <select
                    value={newShiftDayType}
                    onChange={(e) => setNewShiftDayType(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="weekday">Weekday</option>
                    <option value="weekend">Weekend</option>
                  </select>
                  <input
                    type="time"
                    value={newShiftStartTime}
                    onChange={(e) => setNewShiftStartTime(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="time"
                    value={newShiftEndTime}
                    onChange={(e) => setNewShiftEndTime(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <select
                    value={newShiftSession}
                    onChange={(e) => setNewShiftSession(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm col-span-2"
                  >
                    <option value="full">Full Day</option>
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                    <option value="evening">Evening</option>
                    <option value="night">Night</option>
                  </select>
                </div>
                <button
                  onClick={handleCreateShift}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition text-sm"
                >
                  Add Shift
                </button>
              </div>

              <div className="space-y-2">
                {refData.shifts.map(shift => (
                  <div key={shift.shift_id} className={`p-3 border rounded-lg flex items-center justify-between ${shift.active === false ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-gray-200'}`}>
                    {editingShiftId === shift.shift_id ? (
                      <div className="flex-1">
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <input
                            type="text"
                            value={editShiftName}
                            onChange={(e) => setEditShiftName(e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                          <select
                            value={editShiftDayType}
                            onChange={(e) => setEditShiftDayType(e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm"
                          >
                            <option value="weekday">Weekday</option>
                            <option value="weekend">Weekend</option>
                          </select>
                          <input
                            type="time"
                            value={editShiftStartTime}
                            onChange={(e) => setEditShiftStartTime(e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                          <input
                            type="time"
                            value={editShiftEndTime}
                            onChange={(e) => setEditShiftEndTime(e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                          <select
                            value={editShiftSession}
                            onChange={(e) => setEditShiftSession(e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm col-span-2"
                          >
                            <option value="full">Full Day</option>
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                            <option value="evening">Evening</option>
                            <option value="night">Night</option>
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleUpdateShift}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingShiftId(null)}
                            className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded text-xs transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-gray-900">
                            {shift.name}{shift.active === false && <span className="ml-2 text-xs font-normal text-gray-500">(inactive)</span>}
                          </p>
                          <p className="text-xs text-gray-600">
                            {shift.day_type} • {shift.start_time} - {shift.end_time} • {shift.session}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleStartEditShift(shift)}
                            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition"
                          >
                            Edit
                          </button>
                          {shift.active === false ? (
                            <button
                              onClick={() => handleReactivateShift(shift.shift_id)}
                              className="px-3 py-1 bg-green-100 hover:bg-green-200 text-green-900 font-medium rounded text-xs transition"
                            >
                              Reactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => handleDeactivateShift(shift.shift_id)}
                              className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded text-xs transition"
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            {/* Shift Pattern Rules Section */}
            <CollapsibleSection title="Shift Pattern Rules">
              <ShiftPatternRulesUI departmentId={departmentId} shifts={refData.shifts} />
            </CollapsibleSection>

            {/* Duty Types Section — configures the dropdowns shown in the Day
                view's Duty Assignments panel. A single-specialty department
                just needs one "On Call"; a rural roster wants one per
                specialty it covers overnight (ED / Obstetrics /
                Anaesthetics — the same person can be picked for more than
                one to represent covering a combination); a full ED wants
                First/Second On Call plus separate Tox and Paeds slots. */}
            <CollapsibleSection title="Duty Types">
              <div className="mb-6 p-4 bg-orange-50 rounded-lg">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <input
                    type="text"
                    placeholder="Duty type name (e.g., 'Tox On Call')"
                    value={newDutyTypeLabel}
                    onChange={(e) => setNewDutyTypeLabel(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={newDutyTypeCountsAsOnCall}
                      onChange={(e) => setNewDutyTypeCountsAsOnCall(e.target.checked)}
                    />
                    Counts as on call (Fairness Report + next-day fatigue risk)
                  </label>
                  <div className="flex gap-2 items-center col-span-2">
                    <label className="text-xs text-gray-600">On-call card hours (optional — blank means top panel only, no section card):</label>
                    <input
                      type="time"
                      value={newDutyTypeStartTime}
                      onChange={(e) => setNewDutyTypeStartTime(e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                    <span className="text-gray-400">–</span>
                    <input
                      type="time"
                      value={newDutyTypeEndTime}
                      onChange={(e) => setNewDutyTypeEndTime(e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                </div>
                <button
                  onClick={handleCreateDutyType}
                  className="w-full px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg transition text-sm"
                >
                  Add Duty Type
                </button>
              </div>

              <div className="space-y-2">
                {refData.dutyTypes.length === 0 && (
                  <p className="text-sm text-gray-500">No duty types yet — add one above.</p>
                )}
                {refData.dutyTypes.map(dutyType => (
                  <div key={dutyType.duty_type_id} className={`p-3 border rounded-lg flex items-center justify-between ${dutyType.active === false ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-gray-200'}`}>
                    {editingDutyTypeId === dutyType.duty_type_id ? (
                      <div className="flex-1">
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <input
                            type="text"
                            value={editDutyTypeLabel}
                            onChange={(e) => setEditDutyTypeLabel(e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                          <input
                            type="number"
                            value={editDutyTypeSortOrder}
                            onChange={(e) => setEditDutyTypeSortOrder(parseInt(e.target.value, 10) || 0)}
                            title="Display order in the Duty Assignments panel — lower first"
                            className="px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                          <label className="flex items-center gap-2 text-sm text-gray-700 col-span-2">
                            <input
                              type="checkbox"
                              checked={editDutyTypeCountsAsOnCall}
                              onChange={(e) => setEditDutyTypeCountsAsOnCall(e.target.checked)}
                            />
                            Counts as on call (Fairness Report + next-day fatigue risk)
                          </label>
                          <div className="flex gap-2 items-center col-span-2">
                            <label className="text-xs text-gray-600">On-call card hours (optional — blank means top panel only, no section card):</label>
                            <input
                              type="time"
                              value={editDutyTypeStartTime}
                              onChange={(e) => setEditDutyTypeStartTime(e.target.value)}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                            <span className="text-gray-400">–</span>
                            <input
                              type="time"
                              value={editDutyTypeEndTime}
                              onChange={(e) => setEditDutyTypeEndTime(e.target.value)}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleUpdateDutyType}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingDutyTypeId(null)}
                            className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded text-xs transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-gray-900">
                            {dutyType.label}{dutyType.active === false && <span className="ml-2 text-xs font-normal text-gray-500">(inactive)</span>}
                          </p>
                          <p className="text-xs text-gray-600">
                            {dutyType.counts_as_on_call ? 'Counts as on call' : 'Not counted as on call'} • order {dutyType.sort_order}
                            {dutyType.start_time && dutyType.end_time
                              ? ` • ${dutyType.start_time.slice(0, 5)}–${dutyType.end_time.slice(0, 5)} card at On Call`
                              : ' • no card (top panel only)'}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleStartEditDutyType(dutyType)}
                            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition"
                          >
                            Edit
                          </button>
                          {dutyType.active === false ? (
                            <button
                              onClick={() => handleReactivateDutyType(dutyType.duty_type_id)}
                              className="px-3 py-1 bg-green-100 hover:bg-green-200 text-green-900 font-medium rounded text-xs transition"
                            >
                              Reactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => handleDeactivateDutyType(dutyType.duty_type_id)}
                              className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded text-xs transition"
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            {/* Locations Section */}
            <CollapsibleSection title="Locations">
              <div className="mb-4 p-3 border border-gray-200 rounded-lg space-y-2">
                <input
                  type="text"
                  placeholder="Location name (e.g., 'Theatre 1')"
                  value={newLocationInput}
                  onChange={(e) => setNewLocationInput(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <div className="flex gap-2 items-center">
                  <label className="text-xs text-gray-600">Default hours (optional — blank means always open):</label>
                  <input
                    type="time"
                    value={newLocationDefaultStart}
                    onChange={(e) => setNewLocationDefaultStart(e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                  <span className="text-gray-400">–</span>
                  <input
                    type="time"
                    value={newLocationDefaultEnd}
                    onChange={(e) => setNewLocationDefaultEnd(e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                  <button
                    onClick={handleCreateLocation}
                    className="ml-auto px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition text-sm"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {refData.locations.map(loc => (
                  <div key={loc.location_id} className={`p-3 border rounded-lg flex items-center justify-between gap-2 ${loc.active === false ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-gray-200'}`}>
                    {editingLocationId === loc.location_id ? (
                      <div className="flex flex-wrap gap-2 items-center flex-1">
                        <input
                          type="text"
                          value={editLocationName}
                          onChange={(e) => setEditLocationName(e.target.value)}
                          className="flex-1 min-w-[8rem] px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <input
                          type="time"
                          value={editLocationDefaultStart}
                          onChange={(e) => setEditLocationDefaultStart(e.target.value)}
                          className="px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <span className="text-gray-400">–</span>
                        <input
                          type="time"
                          value={editLocationDefaultEnd}
                          onChange={(e) => setEditLocationDefaultEnd(e.target.value)}
                          className="px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <button
                          onClick={handleUpdateLocation}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingLocationId(null)}
                          className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded text-xs transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="font-semibold text-sm text-gray-900">
                          {loc.name}{loc.active === false && <span className="ml-2 text-xs font-normal text-gray-500">(inactive)</span>}
                          <span className="ml-2 text-xs font-normal text-gray-500">
                            {loc.default_start_time && loc.default_end_time
                              ? `(default ${loc.default_start_time.slice(0, 5)}–${loc.default_end_time.slice(0, 5)})`
                              : '(always open)'}
                          </span>
                          {loc.allowed_activity_ids?.length > 0 && (
                            <span className="ml-2 text-xs font-normal text-purple-700">
                              · {loc.allowed_activity_ids.length} activit{loc.allowed_activity_ids.length === 1 ? 'y' : 'ies'} allowed
                            </span>
                          )}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingLocationActivitiesId(loc.location_id)}
                            className="px-3 py-1 bg-purple-100 hover:bg-purple-200 text-purple-900 font-medium rounded text-xs transition"
                          >
                            Activities
                          </button>
                          <button
                            onClick={() => handleStartEditLocation(loc)}
                            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition"
                          >
                            Edit
                          </button>
                          {loc.active === false ? (
                            <button
                              onClick={() => handleReactivateLocation(loc.location_id)}
                              className="px-3 py-1 bg-green-100 hover:bg-green-200 text-green-900 font-medium rounded text-xs transition"
                            >
                              Reactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => handleDeactivateLocation(loc.location_id)}
                              className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded text-xs transition"
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            {/* Activities Section */}
            <CollapsibleSection title="Activities">
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  placeholder="Activity name (e.g., 'STOP')"
                  value={newActivityInput}
                  onChange={(e) => setNewActivityInput(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Abbrev. (e.g., 'ED')"
                  value={newActivityAbbreviation}
                  onChange={(e) => setNewActivityAbbreviation(e.target.value)}
                  title="Short code shown in the Fortnight view's abridged day cells"
                  className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <button
                  onClick={handleCreateActivity}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition text-sm"
                >
                  Add
                </button>
              </div>

              <div className="space-y-2">
                {refData.activities.map(act => (
                  <div key={act.activity_id} className="p-3 border border-gray-200 rounded-lg flex items-center justify-between gap-2">
                    {editingActivityId === act.activity_id ? (
                      <div className="flex gap-2 items-center flex-1">
                        <input
                          type="text"
                          value={editActivityName}
                          onChange={(e) => setEditActivityName(e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <input
                          type="text"
                          value={editActivityAbbreviation}
                          onChange={(e) => setEditActivityAbbreviation(e.target.value)}
                          title="Short code shown in the Fortnight view's abridged day cells"
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <button
                          onClick={handleUpdateActivity}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingActivityId(null)}
                          className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded text-xs transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="font-semibold text-sm text-gray-900">
                          {act.name}{act.abbreviation && <span className="ml-2 text-xs font-normal text-gray-500">({act.abbreviation})</span>}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleStartEditActivity(act)}
                            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteActivity(act.activity_id)}
                            className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded text-xs transition"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            {/* Leave Types Section */}
            <CollapsibleSection title="Leave Types">
              <div className="grid grid-cols-2 gap-2 mb-4">
                <input
                  type="text"
                  placeholder="Name (e.g., 'Cairns Leave')"
                  value={newLeaveTypeName}
                  onChange={(e) => setNewLeaveTypeName(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Code (e.g., 'Cairns Leave')"
                  value={newLeaveTypeCode}
                  onChange={(e) => setNewLeaveTypeCode(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <button
                  onClick={handleCreateLeaveType}
                  className="col-span-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition text-sm"
                >
                  Add Leave Type
                </button>
              </div>

              <div className="space-y-2">
                {refData.leaveTypes.map(lt => (
                  <div key={lt.leave_type_id} className="p-3 border border-gray-200 rounded-lg flex items-center justify-between gap-2">
                    {editingLeaveTypeId === lt.leave_type_id ? (
                      <div className="flex gap-2 items-center flex-1">
                        <input
                          type="text"
                          value={editLeaveTypeName}
                          onChange={(e) => setEditLeaveTypeName(e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <input
                          type="text"
                          value={editLeaveTypeCode}
                          onChange={(e) => setEditLeaveTypeCode(e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <button
                          onClick={handleUpdateLeaveType}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingLeaveTypeId(null)}
                          className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded text-xs transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-gray-900">{lt.name}</p>
                          <p className="text-xs text-gray-600">Code: {lt.code}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleStartEditLeaveType(lt)}
                            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteLeaveType(lt.leave_type_id)}
                            className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded text-xs transition"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {refData.leaveTypes.length === 0 && (
                  <p className="text-sm text-gray-500">No leave types yet — add one above.</p>
                )}
              </div>
            </CollapsibleSection>

            {/* Case Mix Report Section */}
            <CollapsibleSection title="Case Mix Report">
              <CaseMixReport departmentId={departmentId} refreshKey={staffVersion} />
            </CollapsibleSection>

            {/* On-Call / Weekend Fairness Section */}
            <CollapsibleSection title="On-Call & Weekend Fairness">
              <FairnessReport departmentId={departmentId} refreshKey={staffVersion} />
            </CollapsibleSection>

            {/* Staff and Availability Section */}
            <CollapsibleSection title="Staff and Availability">
              <StaffAvailabilityTab departmentId={departmentId} staffList={refData.staff} leaveTypes={refData.leaveTypes} onStaffChanged={refreshStaffList} />
            </CollapsibleSection>

            {/* Staff Profiles Section */}
            <CollapsibleSection title="Staff Activity Profiles">
              <StaffProfilesTab departmentId={departmentId} refreshKey={staffVersion} />
            </CollapsibleSection>

            {/* Staff Accounts Section */}
            <CollapsibleSection title="Staff Accounts">
              <StaffAccountsTab departmentId={departmentId} refreshKey={staffVersion} />
            </CollapsibleSection>
          </div>
        </div>
      );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader size={32} className="text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading department...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 pb-24">
      {renderContent()}

      {/* Staff Popup */}
      {selectedStaff && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-2xl font-bold text-gray-900">{selectedStaff}</h2>
              <button onClick={() => setSelectedStaff(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            {refData.staff.find(s => s.name === selectedStaff) && (
              <div className="bg-green-50 rounded-lg p-4 mb-6">
                <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">Phone</p>
                <p className="text-lg font-mono font-semibold text-gray-900">{refData.staff.find(s => s.name === selectedStaff)?.phone}</p>
              </div>
            )}
            <button onClick={() => setSelectedStaff(null)} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium py-2 rounded-lg">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Add Activity Modal */}
      {showAddActivity && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-gray-900">Add Activity</h2>
              <button onClick={() => setShowAddActivity(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Location</label>
                <select
                  value={newActivityLocation}
                  onChange={(e) => { setNewActivityLocation(e.target.value); prefillActivityTimes(e.target.value, newActivitySession); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select location…</option>
                  {refData.locations.filter(loc => loc.active !== false).map(loc => (
                    <option key={loc.location_id} value={loc.location_id}>{loc.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Session</label>
                <select
                  value={newActivitySession}
                  onChange={(e) => { setNewActivitySession(e.target.value); prefillActivityTimes(newActivityLocation, e.target.value); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="full">Whole Day</option>
                  <option value="AM">Morning</option>
                  <option value="PM">Afternoon</option>
                  <option value="night">Night</option>
                </select>
                <p className="text-xs text-gray-500 mt-2">A starting point for the times below — pick whichever's closest, then adjust.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Start / End time</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="time"
                    value={newActivityStartTime}
                    onChange={(e) => setNewActivityStartTime(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-gray-400">–</span>
                  <input
                    type="time"
                    value={newActivityEndTime}
                    onChange={(e) => setNewActivityEndTime(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">When this activity actually runs — this is what decides whether it groups under Morning, Afternoon or Night Allocations.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Activity</label>
                <select
                  value={newActivityType}
                  onChange={(e) => handleAddActivity(e.target.value)}
                  disabled={!newActivityLocation || !newActivityStartTime || !newActivityEndTime}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">{!newActivityLocation ? 'Select a location first' : (!newActivityStartTime || !newActivityEndTime) ? 'Set a start and end time first' : 'Select activity…'}</option>
                  {activitiesAllowedAtLocation(newActivityLocation).map(act => (
                    <option key={act.activity_id} value={act.activity_id}>{act.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-2">Choosing an activity adds it and closes this dialog.</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddActivity(false); setNewActivityLocation(''); setNewActivityType(''); setNewActivitySession('full'); setNewActivityStartTime(''); setNewActivityEndTime(''); }}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium py-2 rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Allowed Activities Modal — narrows the Activity picker (Fortnight
          wizard, Add Activity dialog, an existing card's own Activity
          dropdown) to just these for this location. Empty = no
          restriction. */}
      {editingLocationActivitiesId && (() => {
        const location = refData.locations.find(l => l.location_id === editingLocationActivitiesId);
        const allowedIds = location?.allowed_activity_ids || [];
        const allowed = refData.activities.filter(a => allowedIds.includes(a.activity_id));
        const notAllowed = refData.activities.filter(a => !allowedIds.includes(a.activity_id));
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{location?.name} — Allowed Activities</h2>
                  <p className="text-sm text-gray-600">Leave empty to allow every activity at this location.</p>
                </div>
                <button onClick={() => setEditingLocationActivitiesId(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                  <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-600 uppercase mb-2">All Activities</p>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
                    {notAllowed.length === 0 && (
                      <p className="p-3 text-sm text-gray-400 italic">Every activity is already allowed</p>
                    )}
                    {notAllowed.map(act => (
                      <button
                        key={act.activity_id}
                        onClick={() => handleUpdateLocationAllowedActivities(location.location_id, [...allowedIds, act.activity_id])}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition flex items-center justify-between gap-2"
                      >
                        {act.name}
                        <span className="text-blue-600 text-xs font-semibold flex-shrink-0">Add →</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Allowed Here</p>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
                    {allowed.length === 0 && (
                      <p className="p-3 text-sm text-gray-400 italic">None selected — every activity is offered</p>
                    )}
                    {allowed.map(act => (
                      <button
                        key={act.activity_id}
                        onClick={() => handleUpdateLocationAllowedActivities(location.location_id, allowedIds.filter(id => id !== act.activity_id))}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 transition flex items-center justify-between gap-2"
                      >
                        <span className="text-red-600 text-xs font-semibold flex-shrink-0">← Remove</span>
                        {act.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* BOTTOM TAB NAVIGATION */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="max-w-3xl mx-auto flex justify-around">
          <button
            onClick={() => setActiveTab('calendar')}
            className={`flex-1 py-4 text-center transition ${
              activeTab === 'calendar' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="text-sm font-semibold">Calendar</div>
          </button>
          <button
            onClick={() => setActiveTab('fortnight')}
            className={`flex-1 py-4 text-center transition ${
              activeTab === 'fortnight' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="text-sm font-semibold">Fortnight</div>
          </button>
          <button
            onClick={() => {
              if (!selectedDate) setSelectedDate(new Date());
              setActiveTab('day');
            }}
            className={`flex-1 py-4 text-center transition ${
              activeTab === 'day' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="text-sm font-semibold">Day</div>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-4 text-center transition ${
              activeTab === 'settings' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="text-sm font-semibold">Settings</div>
          </button>
        </div>
      </div>
    </div>
  );
}
