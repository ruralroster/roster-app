import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import StaffProfilesTab from './StaffProfilesTab';
import StaffAccountsTab from './StaffAccountsTab';
import StaffAvailabilityTab from './StaffAvailabilityTab';
import ShiftPatternRulesUI from './ShiftPatternRulesUI';
import CaseMixReport from './CaseMixReport';
import FairnessReport from './FairnessReport';
import RuleViolationsReport, { createDefaultRuleCheckState } from './RuleViolationsReport';
import RosterExcelImportTab from './RosterExcelImportTab';
import RosterExcelExportTab from './RosterExcelExportTab';
import CollapsibleSection from './CollapsibleSection';
import { toLocalDateStr } from './dateUtils';
import { ChevronLeft, ChevronRight, X, AlertCircle, Loader, Hand, Settings } from 'lucide-react';
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
  copyWeekActivities,
  createShift,
  updateShift,
  deactivateShift,
  reactivateShift,
  createDutyType,
  updateDutyType,
  deactivateDutyType,
  reactivateDutyType,
  createPhoneBookEntry,
  updatePhoneBookEntry,
  deletePhoneBookEntry,
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
  createAdvancedSkill,
  updateAdvancedSkill,
  deleteAdvancedSkill,
  updateActivityTypeRequiredSkills,
  updateDutyTypeRequiredSkills,
  updateStaffAssignmentLeaveCode,
  updateDepartmentPayCentreNumber,
  updateDepartmentCoffeePlace,
  updateDepartmentSessionTimes,
  getAllStaffAssignmentsForRange,
  getDutyAssignmentsForRange,
  assignStaffFortnight,
  validateShiftAssignment,
  createWeekTemplate,
  deleteWeekTemplate,
  getWeekTemplateEntries,
  createWeekTemplateEntry,
  deleteWeekTemplateEntry,
  getWeekTemplateApplicationsForRange,
  applyWeekTemplate,
  getPendingSickReports,
  resolveSickReport,
  getStaffRanks,
  createStaffRank,
  renameStaffRank,
  setStaffRankSupervision,
  reorderStaffRanks,
  deleteStaffRank,
} from './supabaseClient';
import { downloadPayrollExcel, getMondayOfWeek } from './payrollExport';
import { getSessionGroups, SESSION_GROUP_ORDER, SESSION_GROUP_LABELS, SESSION_DEFAULT_TIMES, DEFAULT_SESSION_BOUNDARIES, getDepartmentSessionBoundaries } from './shiftSessionUtils';
import { formatFte, DEFAULT_FTE } from './availabilityUtils';

const CALENDAR_WEEKS_SHOWN = 4;
const CALENDAR_DAYS_SHOWN = CALENDAR_WEEKS_SHOWN * 7;

const EMPTY_FATIGUE_STATUS = { postNightRestStaffIds: new Set(), nightCooldownStaffIds: new Set(), fatigueRiskStaffIds: new Set() };

const ALLOCATION_STATUS_STYLES = {
  none: { classes: 'bg-white border-gray-200 text-gray-900 hover:border-blue-500 hover:bg-blue-50', swatch: 'bg-white border-gray-300', label: 'Nothing required' },
  green: { classes: 'bg-green-500 border-green-600 text-white hover:bg-green-600', swatch: 'bg-green-500 border-green-600', label: 'Fully covered' },
  orange: { classes: 'bg-orange-400 border-orange-500 text-white hover:bg-orange-500', swatch: 'bg-orange-400 border-orange-500', label: 'On-call short' },
  red: { classes: 'bg-red-500 border-red-600 text-white hover:bg-red-600', swatch: 'bg-red-500 border-red-600', label: 'Coverage gap' },
};

// eslint-disable-next-line no-unused-vars -- staffId (the signed-in officer's own staff_id, now known via App.js) is threaded through for upcoming self-service/audit features; not consumed internally yet.
export default function OfficerRosterView({ departmentId: departmentIdProp, staffId, topBarActionsRef, isSuperAdmin = false } = {}) {
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
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [calendarAllocationStatus, setCalendarAllocationStatus] = useState({}); // dateStr -> { status: 'none'|'green'|'orange'|'red', missingOnCallAbbrevs: string[] }
  const [weekTemplateApplications, setWeekTemplateApplications] = useState({}); // week_start_date -> { week_template_id, week_templates: { name } }
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [applyTemplateId, setApplyTemplateId] = useState('');
  const [applyingTemplateWeek, setApplyingTemplateWeek] = useState(null); // week_start_date currently being applied, for a disabled/loading button state
  // Copy an arbitrary week's real cards (not a saved template) onto
  // another week — the source Monday is picked once, then "Copy" can be
  // hit on any week row, same shape as the template-apply picker above.
  const [copyFromWeekInput, setCopyFromWeekInput] = useState('');
  const [copyingWeek, setCopyingWeek] = useState(null);
  // Rule Violations report state lives here, not inside
  // RuleViolationsReport itself — that component unmounts whenever the
  // officer switches away from the Settings tab (e.g. via Investigate, to
  // Fortnight/Day view), and this needs to survive that round trip so the
  // same dates/results are still there when they come back.
  const [ruleCheckState, setRuleCheckState] = useState(createDefaultRuleCheckState);
  // Week Template Management State (Settings) — list itself lives in
  // refData.weekTemplates; entries are fetched on demand per selected
  // template, since a department could have several and there's no reason
  // to load every template's entries up front.
  const [newWeekTemplateName, setNewWeekTemplateName] = useState('');
  const [editingWeekTemplateId, setEditingWeekTemplateId] = useState(null);
  const [weekTemplateEntries, setWeekTemplateEntries] = useState([]);
  const [loadingWeekTemplateEntries, setLoadingWeekTemplateEntries] = useState(false);
  const [newEntryDayOfWeek, setNewEntryDayOfWeek] = useState(0);
  const [newEntryLocationId, setNewEntryLocationId] = useState('');
  const [newEntryActivityId, setNewEntryActivityId] = useState('');
  const [newEntryStartTime, setNewEntryStartTime] = useState('');
  const [newEntryEndTime, setNewEntryEndTime] = useState('');
  const [newEntrySession, setNewEntrySession] = useState('full');
  // Pending "Notify Sick" reports awaiting officer approval — see the Day
  // view's approval banner.
  const [pendingSickReports, setPendingSickReports] = useState([]);
  const [fortnightStart, setFortnightStart] = useState(() => getMondayOfWeek(new Date()));
  const [fortnightRankFilter, setFortnightRankFilter] = useState('');
  const [fortnightSelectedStaffId, setFortnightSelectedStaffId] = useState('');
  const [fortnightAllocations, setFortnightAllocations] = useState([]);
  const [fortnightDutyAssignments, setFortnightDutyAssignments] = useState([]);
  const [loadingFortnight, setLoadingFortnight] = useState(false);
  const [fortnightModalDate, setFortnightModalDate] = useState(null); // Date | null — which day cell's picker is open
  // Fortnight assignment wizard step within that modal — see
  // handleOpenFortnightModal/handleFortnightPickShift/PickLocation/PickActivity.
  const [fortnightWizardStep, setFortnightWizardStep] = useState('shift'); // 'shift' | 'oncall' | 'location' | 'activity'
  const [fortnightWizardShiftId, setFortnightWizardShiftId] = useState(null);
  const [fortnightWizardLocationId, setFortnightWizardLocationId] = useState(null);
  // Set when a junior's shift has no existing card to join (see
  // computeCardsInSessionForJunior) but someone is on call that day —
  // holds who, so the fresh card the wizard goes on to build also gets
  // that consultant added with on-call ticked. See handleFortnightPickShift
  // / handleFortnightConfirmOnCall / handleFortnightPickActivity.
  const [fortnightWizardOnCallStaffId, setFortnightWizardOnCallStaffId] = useState(null);
  const [fortnightWizardOnCallStaffName, setFortnightWizardOnCallStaffName] = useState(null);
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
    phoneBookEntries: [],
    weekTemplates: [],
    advancedSkills: [],
    staffRanks: [],
  });
  // Bumped whenever staff are added/removed, so components that fetch their
  // own staff-derived data independently (Case Mix, Fairness, Staff Profiles,
  // the ranked assignment dropdowns) know to refetch instead of going stale.
  const [staffVersion, setStaffVersion] = useState(0);

  // This department's Morning/Afternoon/Night windows (see
  // migrations/2026-08-31_department_session_times.sql) — passed into every
  // getSessionGroups call below so Allocations-section grouping respects
  // this department's own boundaries instead of the hardcoded default.
  const sessionBoundaries = getDepartmentSessionBoundaries(refData.department);

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
  const [newDutyTypeAbbreviation, setNewDutyTypeAbbreviation] = useState('');
  const [editingDutyTypeId, setEditingDutyTypeId] = useState(null);
  const [editDutyTypeLabel, setEditDutyTypeLabel] = useState('');
  const [editDutyTypeCountsAsOnCall, setEditDutyTypeCountsAsOnCall] = useState(true);
  const [editDutyTypeSortOrder, setEditDutyTypeSortOrder] = useState(0);
  const [editDutyTypeStartTime, setEditDutyTypeStartTime] = useState('');
  const [editDutyTypeEndTime, setEditDutyTypeEndTime] = useState('');
  const [editDutyTypeAbbreviation, setEditDutyTypeAbbreviation] = useState('');

  // Phone Book Management State (list lives in refData.phoneBookEntries —
  // non-staff numbers like the nearest tertiary ED or the NUM line, shown
  // to everyone under the staff view's Phone Book tab).
  const [newPhoneBookLabel, setNewPhoneBookLabel] = useState('');
  const [newPhoneBookPhone, setNewPhoneBookPhone] = useState('');
  const [editingPhoneBookEntryId, setEditingPhoneBookEntryId] = useState(null);
  const [editPhoneBookLabel, setEditPhoneBookLabel] = useState('');
  const [editPhoneBookPhone, setEditPhoneBookPhone] = useState('');

  // Staff Rank Management State (see migrations/2026-08-31_staff_ranks.sql)
  const [newRankName, setNewRankName] = useState('');
  const [newRankRequiresSupervision, setNewRankRequiresSupervision] = useState(true);
  const [savingRank, setSavingRank] = useState(false);
  const [rankError, setRankError] = useState(null);
  const [editingRankId, setEditingRankId] = useState(null);
  const [editRankName, setEditRankName] = useState('');

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
  // Which location's per-activity Advanced Skill matrix is open, if any —
  // a location-scoped view onto the same activity_types.required_advanced_skills
  // set from the Activities section's own "Skills" button.
  const [editingLocationSkillsId, setEditingLocationSkillsId] = useState(null);

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

  // Advanced Skill Management State (Settings -> Staff Filters). List
  // itself lives in refData.advancedSkills — the single source of truth
  // also used by the Staff and Availability tab and the Activity/Duty Type
  // "Skills" pickers below.
  const [newAdvancedSkillName, setNewAdvancedSkillName] = useState('');
  const [editingAdvancedSkillId, setEditingAdvancedSkillId] = useState(null);
  const [editAdvancedSkillName, setEditAdvancedSkillName] = useState('');
  // Which activity's / duty type's required-skills modal is open, if any.
  const [editingActivitySkillsId, setEditingActivitySkillsId] = useState(null);
  const [editingDutyTypeSkillsId, setEditingDutyTypeSkillsId] = useState(null);

  // Department Settings State (Pay Centre Number local edit buffer, kept
  // separate from refData.department so typing doesn't need a round-trip)
  const [payCentreNumberInput, setPayCentreNumberInput] = useState('');
  const [savingPayCentreNumber, setSavingPayCentreNumber] = useState(false);
  const [coffeePlaceNameInput, setCoffeePlaceNameInput] = useState('');
  const [coffeePlacePhoneInput, setCoffeePlacePhoneInput] = useState('');
  const [savingCoffeePlace, setSavingCoffeePlace] = useState(false);
  // Morning/Afternoon/Night boundary times (see
  // migrations/2026-08-31_department_session_times.sql) — local edit
  // buffer matching the shape getDepartmentSessionBoundaries returns.
  const [sessionBoundariesInput, setSessionBoundariesInput] = useState(DEFAULT_SESSION_BOUNDARIES);
  const [savingSessionTimes, setSavingSessionTimes] = useState(false);

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
        setCoffeePlaceNameInput(result.department?.coffee_place_name || '');
        setCoffeePlacePhoneInput(result.department?.coffee_place_phone || '');
        setSessionBoundariesInput(getDepartmentSessionBoundaries(result.department));
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

  const refreshStaffRanks = async () => {
    if (!departmentId) return;
    try {
      const { data, error: fetchError } = await getStaffRanks(departmentId);
      if (fetchError) throw fetchError;
      setRefData(prev => ({ ...prev, staffRanks: data }));
      setError(null);
    } catch (err) {
      setError(`Failed to refresh ranks: ${err.message}`);
    }
  };

  // Missing entirely (not found in this department's list) defaults to
  // "requires supervision" — the safer assumption for an unranked/unknown
  // staff member, matching the same default used server-side (see
  // assignStaffFortnight in supabaseClient.js).
  const rankRequiresSupervision = (rankName) => {
    const row = refData.staffRanks.find(r => r.rank === rankName);
    return row ? row.requires_supervision : true;
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

  // Pending "Notify Sick" reports — the Day view's approval banner.
  // Department-wide, not scoped to selectedDate, so an officer catches up
  // on any still-undecided report whenever they're on the Day tab.
  useEffect(() => {
    const loadPendingSickReports = async () => {
      if (!departmentId || activeTab !== 'day') return;
      try {
        const { data, error } = await getPendingSickReports(departmentId);
        if (error) throw error;
        setPendingSickReports(data);
      } catch (err) {
        console.error('Failed to load pending sick reports:', err);
      }
    };

    loadPendingSickReports();
  }, [departmentId, activeTab, selectedDate]);

  // Calendar tab allocation-status colouring — refetches whenever the visible
  // 4-week window changes, and also when returning to the calendar tab (so
  // assignments made in the Day view are reflected without needing the week
  // itself to change), or after applying a week template (calendarRefreshKey).
  useEffect(() => {
    const loadAllocationStatus = async () => {
      if (!departmentId || activeTab !== 'calendar') return;

      const rangeEnd = new Date(calendarWeekStart);
      rangeEnd.setDate(rangeEnd.getDate() + CALENDAR_DAYS_SHOWN - 1);

      try {
        const [{ data, error }, { data: applications, error: applicationsError }] = await Promise.all([
          getAllocationStatusForRange(departmentId, calendarWeekStart, rangeEnd),
          getWeekTemplateApplicationsForRange(departmentId, toLocalDateStr(getMondayOfWeek(calendarWeekStart)), toLocalDateStr(getMondayOfWeek(rangeEnd))),
        ]);
        if (error) throw error;
        if (applicationsError) throw applicationsError;
        setCalendarAllocationStatus(data);
        setWeekTemplateApplications(Object.fromEntries(applications.map(a => [a.week_start_date, a])));
      } catch (err) {
        console.error('Failed to load calendar allocation status:', err);
      }
    };

    loadAllocationStatus();
  }, [departmentId, calendarWeekStart, activeTab, calendarRefreshKey]);

  // Fortnight tab — whole department's real staff_assignments AND
  // duty_assignments for the visible 14-day window (same data the Day view
  // reads/writes — see assignStaffFortnight, which writes to one or the
  // other depending on whether the activity picked belongs to a duty
  // type), refetched whenever that window changes or an assignment is
  // added/removed (via fortnightRefreshKey).
  const [fortnightRefreshKey, setFortnightRefreshKey] = useState(0);
  useEffect(() => {
    const loadFortnightAllocations = async () => {
      if (!departmentId || activeTab !== 'fortnight') return;

      setLoadingFortnight(true);

      try {
        const [assignRes, dutyRes] = await Promise.all([
          getAllStaffAssignmentsForRange(departmentId, fortnightStart, 14),
          getDutyAssignmentsForRange(departmentId, fortnightStart, 14),
        ]);
        if (assignRes.error) throw assignRes.error;
        if (dutyRes.error) throw dutyRes.error;
        setFortnightAllocations(assignRes.data);
        setFortnightDutyAssignments(dutyRes.data);
        setError(null);
      } catch (err) {
        setError(`Failed to load fortnight allocations: ${err.message}`);
      } finally {
        setLoadingFortnight(false);
      }
    };

    loadFortnightAllocations();
  }, [departmentId, fortnightStart, activeTab, fortnightRefreshKey]);

  // Advanced Skills are a hard filter, unlike activity_restrictions below
  // (a staff preference that only warns) — a slot with a non-empty
  // required list only offers staff holding AT LEAST ONE of those skills.
  // Empty/unset required list = no restriction, so nothing changes for an
  // Activity/Duty Type an officer hasn't configured this for.
  const hasRequiredAdvancedSkill = (staffId, requiredSkillIds) => {
    if (!requiredSkillIds || requiredSkillIds.length === 0) return true;
    const staff = refData.staff.find(s => s.staff_id === staffId);
    const staffSkills = staff?.advanced_skills || [];
    return requiredSkillIds.some(id => staffSkills.includes(id));
  };

  // Returns staff matching filterFn, ordered by exposure rate for the given
  // activity (lowest first) when case-mix data is available; falls back to
  // reference-data order otherwise. Also hard-filters out anyone missing a
  // required Advanced Skill for this activity (see hasRequiredAdvancedSkill).
  const getRankedStaffOptions = (activityId, filterFn) => {
    const activity = refData.activities.find(a => a.activity_id === activityId);
    const requiredSkillIds = activity?.required_advanced_skills;
    const combinedFilter = s => filterFn(s) && hasRequiredAdvancedSkill(s.staff_id, requiredSkillIds);
    const ranked = sortedStaffByActivity[activityId];
    if (ranked) return ranked.filter(combinedFilter); // already active-only (getSortedStaffForActivity filters at the query)
    return refData.staff.filter(s => s.active !== false).filter(combinedFilter);
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
    const dutyTypeRow = refData.dutyTypes.find(d => d.key === dutyType);
    const requiredSkillIds = dutyTypeRow?.required_advanced_skills;
    return refData.staff
      .filter(s => s.staff_id === currentStaffId || (
        s.active !== false && isAvailableForDuty(s.staff_id) && hasRequiredAdvancedSkill(s.staff_id, requiredSkillIds)
      ))
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
    setFortnightWizardOnCallStaffId(null);
    setFortnightWizardOnCallStaffName(null);
  };

  const handleCloseFortnightModal = () => {
    setFortnightModalDate(null);
    setFortnightWizardStep('shift');
    setFortnightWizardShiftId(null);
    setFortnightWizardLocationId(null);
    setFortnightWizardOnCallStaffId(null);
    setFortnightWizardOnCallStaffName(null);
  };

  // Existing cards for fortnightModalDate whose own session (from whoever's
  // already on them) overlaps the given shift's session — the junior
  // wizard's "choose what they're covering" list. A plain function (not a
  // render-scoped const) so handleFortnightPickShift can consult it
  // synchronously to decide whether to route to the on-call fallback,
  // before the render that would otherwise compute this.
  const computeCardsInSessionForJunior = (shiftId) => {
    const shift = refData.shifts.find(s => s.shift_id === shiftId);
    const shiftSessionGroups = shift ? getSessionGroups(shift, sessionBoundaries) : [];
    if (shiftSessionGroups.length === 0 || !fortnightModalDate) return [];

    const dateStr = toLocalDateStr(fortnightModalDate);
    const byCard = new Map();
    fortnightAllocations
      .filter(a => a.date === dateStr && a.theatre_activity_id && getSessionGroups(a.shifts, sessionBoundaries).some(g => shiftSessionGroups.includes(g)))
      .forEach(a => {
        if (!byCard.has(a.theatre_activity_id)) {
          const activityId = a.theatre_activities?.activity_id;
          const activity = refData.activities.find(act => act.activity_id === activityId);
          const location = refData.locations.find(l => l.location_id === a.location_id);
          byCard.set(a.theatre_activity_id, {
            theatreActivityId: a.theatre_activity_id,
            locationId: a.location_id,
            locationName: location?.name || 'Unknown location',
            activityId,
            activityName: activity ? (activity.abbreviation ? `${activity.name} (${activity.abbreviation})` : activity.name) : 'Unknown activity',
            startTime: a.theatre_activities?.start_time,
            endTime: a.theatre_activities?.end_time,
            people: [],
          });
        }
        byCard.get(a.theatre_activity_id).people.push({
          name: a.staff?.name,
          role: a.role,
          onCall: !!a.on_call,
        });
      });
    return Array.from(byCard.values());
  };

  // For a junior (non-consultant/fellow) staff member, if no existing card
  // overlaps the picked shift's session, there's no location with a
  // consultant on site for this shift time — route to the on-call fallback
  // instead of a dead end: pick who's on call, then build a fresh card
  // (location + activity) with that consultant added onto it, on-call
  // ticked, alongside the junior. See handleFortnightConfirmOnCall /
  // handleFortnightPickActivity.
  const handleFortnightPickShift = (shiftId) => {
    setFortnightWizardShiftId(shiftId);
    setFortnightWizardOnCallStaffId(null);
    setFortnightWizardOnCallStaffName(null);

    const staff = refData.staff.find(s => s.staff_id === fortnightSelectedStaffId);
    const isJunior = !!staff && rankRequiresSupervision(staff.rank);
    if (isJunior && computeCardsInSessionForJunior(shiftId).length === 0) {
      setFortnightWizardStep('oncall');
      return;
    }
    setFortnightWizardStep('location');
  };

  // The officer picks which on-call person is covering this junior's
  // shift. Nothing is written yet — handleFortnightPickActivity adds them
  // to the same fresh card as a consultant with on-call ticked once the
  // junior's own location/activity pick creates it.
  const handleFortnightConfirmOnCall = (staffId, staffName) => {
    setFortnightWizardOnCallStaffId(staffId || null);
    setFortnightWizardOnCallStaffName(staffName || null);
    setFortnightWizardStep('location');
  };

  const handleFortnightPickLocation = (locationId) => {
    setFortnightWizardLocationId(locationId);

    // A location restricted to exactly one activity has nothing left to
    // choose — skip straight to assigning instead of making the officer
    // click a single-option screen (e.g. every Emergency Department
    // location only ever allows the "Emergency" activity).
    const onlyActivity = activitiesAllowedAtLocation(locationId);
    if (onlyActivity.length === 1) {
      handleFortnightPickActivity(onlyActivity[0].activity_id, locationId);
      return;
    }

    setFortnightWizardStep('activity');
  };

  // locationIdOverride + theatreActivityIdOverride let a junior-staff pick
  // land straight on a specific existing card without going through the
  // normal location/activity steps — see the "join an existing card"
  // branch of the wizard's location step, cardsInSessionForJunior.
  const handleFortnightPickActivity = async (activityId, locationIdOverride, theatreActivityIdOverride) => {
    const locationId = locationIdOverride ?? fortnightWizardLocationId;
    if (!departmentId || !fortnightModalDate || !fortnightSelectedStaffId || !fortnightWizardShiftId || !locationId) return;

    try {
      const { error, theatreActivityId } = await assignStaffFortnight(
        departmentId, fortnightModalDate, fortnightSelectedStaffId, fortnightWizardShiftId, locationId, activityId, false, theatreActivityIdOverride
      );
      if (error) throw error;

      // The on-call consultant confirmed as this junior's cover isn't
      // physically present — add them to the same card as a consultant
      // with on_call ticked, same as ticking "on call" for a consultant in
      // Day view.
      if (fortnightWizardOnCallStaffId) {
        const { error: onCallError } = await assignStaffFortnight(
          departmentId, fortnightModalDate, fortnightWizardOnCallStaffId, fortnightWizardShiftId, locationId, activityId, true, theatreActivityId
        );
        if (onCallError) throw onCallError;
      }

      handleCloseFortnightModal();
      setFortnightRefreshKey(k => k + 1);
      setError(null);
    } catch (err) {
      setError(`Failed to assign: ${err.message}`);
    }
  };

  // "Already on this day" is grouped one line per person (see the Fortnight
  // grid cells' own grouping) — someone with two activities and/or duties
  // that day has multiple rows behind one line, so removing them clears
  // all of that person's rows for the day rather than just one. person is
  // a groupAllocationsByStaff entry, carrying both regular assignmentIds
  // and on-call dutyKeys (duty_type keys, cleared via updateDutyAssignment
  // since duty-type assignments no longer have a staff_assignments row at
  // all — see assignStaffFortnight).
  const handleRemoveFortnightPersonDay = async (person, date) => {
    try {
      const results = await Promise.all([
        ...person.assignmentIds.map(id => deleteStaffAssignment(id)),
        ...person.dutyKeys.map(key => updateDutyAssignment(departmentId, date, key, null)),
      ]);
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

    // Same location + same activity + an overlapping time window already
    // has a card — join it instead of creating a second, duplicate one.
    // Two theatre_activities rows for what's really the same slot just
    // splits who's assigned across both, showing the same location and
    // activity twice in the same session instead of one card with
    // everyone on it.
    const newGroups = getSessionGroups({ start_time: newActivityStartTime, end_time: newActivityEndTime }, sessionBoundaries);
    const existingCard = theatreActivities.find(ta =>
      ta.location_id === newActivityLocation
      && ta.activity_id === activityId
      && getSessionGroups({ start_time: ta.start_time, end_time: ta.end_time }, sessionBoundaries).some(g => newGroups.includes(g))
    );
    if (existingCard) {
      setError('This activity is already on this location for this session — assign staff on the existing card instead of adding it again.');
      setShowAddActivity(false);
      setNewActivityLocation('');
      setNewActivityType('');
      setNewActivitySession('full');
      setNewActivityStartTime('');
      setNewActivityEndTime('');
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
        newDutyTypeStartTime || null, newDutyTypeEndTime || null, newDutyTypeAbbreviation || null
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
      setNewDutyTypeAbbreviation('');
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
        editDutyTypeStartTime || null, editDutyTypeEndTime || null, editingDutyType?.activity_type_id, editingDutyType?.shift_id,
        editDutyTypeAbbreviation || null
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
      setEditDutyTypeAbbreviation('');
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
    setEditDutyTypeAbbreviation(dutyType.abbreviation || '');
  };

  const handleCreatePhoneBookEntry = async () => {
    if (!newPhoneBookLabel.trim() || !newPhoneBookPhone.trim() || !departmentId) return;

    try {
      const nextSortOrder = refData.phoneBookEntries.reduce((max, p) => Math.max(max, p.sort_order), -1) + 1;
      const { data, error } = await createPhoneBookEntry(departmentId, newPhoneBookLabel, newPhoneBookPhone, nextSortOrder);
      if (error) throw error;

      setRefData(prev => ({ ...prev, phoneBookEntries: [...prev.phoneBookEntries, data] }));
      setNewPhoneBookLabel('');
      setNewPhoneBookPhone('');
      setError(null);
    } catch (err) {
      setError(`Failed to add phone book entry: ${err.message}`);
    }
  };

  const handleStartEditPhoneBookEntry = (entry) => {
    setEditingPhoneBookEntryId(entry.phone_book_entry_id);
    setEditPhoneBookLabel(entry.label);
    setEditPhoneBookPhone(entry.phone);
  };

  const handleUpdatePhoneBookEntry = async () => {
    if (!editingPhoneBookEntryId || !editPhoneBookLabel.trim() || !editPhoneBookPhone.trim()) return;

    try {
      const editingEntry = refData.phoneBookEntries.find(p => p.phone_book_entry_id === editingPhoneBookEntryId);
      const { data, error } = await updatePhoneBookEntry(editingPhoneBookEntryId, editPhoneBookLabel, editPhoneBookPhone, editingEntry?.sort_order ?? 0);
      if (error) throw error;

      setRefData(prev => ({ ...prev, phoneBookEntries: prev.phoneBookEntries.map(p => p.phone_book_entry_id === editingPhoneBookEntryId ? data : p) }));
      setEditingPhoneBookEntryId(null);
      setEditPhoneBookLabel('');
      setEditPhoneBookPhone('');
      setError(null);
    } catch (err) {
      setError(`Failed to update phone book entry: ${err.message}`);
    }
  };

  const handleDeletePhoneBookEntry = async (entryId) => {
    if (!window.confirm('Remove this phone book entry?')) return;

    try {
      const { error } = await deletePhoneBookEntry(entryId);
      if (error) throw error;

      setRefData(prev => ({ ...prev, phoneBookEntries: prev.phoneBookEntries.filter(p => p.phone_book_entry_id !== entryId) }));
      setError(null);
    } catch (err) {
      setError(`Failed to remove phone book entry: ${err.message}`);
    }
  };

  // Staff Rank Management Handlers
  const handleCreateStaffRank = async () => {
    if (!newRankName.trim() || !departmentId) return;

    setSavingRank(true);
    try {
      const { error } = await createStaffRank(departmentId, newRankName.trim(), newRankRequiresSupervision);
      if (error) throw error;

      await refreshStaffRanks();
      setNewRankName('');
      setNewRankRequiresSupervision(true);
      setRankError(null);
    } catch (err) {
      setRankError(`Failed to add rank: ${err.message}`);
    } finally {
      setSavingRank(false);
    }
  };

  const handleStartEditRank = (rank) => {
    setEditingRankId(rank.rule_id);
    setEditRankName(rank.rank);
  };

  const handleSaveRankName = async () => {
    if (!editRankName.trim() || !editingRankId) return;

    setSavingRank(true);
    try {
      const { error } = await renameStaffRank(editingRankId, editRankName.trim());
      if (error) throw error;

      await refreshStaffRanks();
      setEditingRankId(null);
      setRankError(null);
    } catch (err) {
      setRankError(`Failed to rename rank: ${err.message}`);
    } finally {
      setSavingRank(false);
    }
  };

  const handleToggleRankSupervision = async (rank) => {
    setSavingRank(true);
    try {
      const { error } = await setStaffRankSupervision(rank.rule_id, !rank.requires_supervision);
      if (error) throw error;

      await refreshStaffRanks();
      setRankError(null);
    } catch (err) {
      setRankError(`Failed to update rank: ${err.message}`);
    } finally {
      setSavingRank(false);
    }
  };

  const handleMoveRank = async (rank, direction) => {
    const ordered = [...refData.staffRanks].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex(r => r.rule_id === rank.rule_id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= ordered.length) return;

    [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];

    setSavingRank(true);
    try {
      const { error } = await reorderStaffRanks(ordered.map(r => r.rule_id));
      if (error) throw error;

      await refreshStaffRanks();
      setRankError(null);
    } catch (err) {
      setRankError(`Failed to reorder ranks: ${err.message}`);
    } finally {
      setSavingRank(false);
    }
  };

  const handleDeleteStaffRank = async (rank) => {
    if (!window.confirm(`Delete the "${rank.rank}" rank? This only works if no staff member currently holds it.`)) return;

    setSavingRank(true);
    try {
      const { error } = await deleteStaffRank(rank.rule_id);
      if (error) throw error;

      await refreshStaffRanks();
      setRankError(null);
    } catch (err) {
      setRankError(`Failed to delete rank: ${err.message}`);
    } finally {
      setSavingRank(false);
    }
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

  // Advanced Skill Management Handlers
  const handleCreateAdvancedSkill = async () => {
    if (!newAdvancedSkillName.trim() || !departmentId) return;

    try {
      const { data, error } = await createAdvancedSkill(departmentId, newAdvancedSkillName.trim());
      if (error) throw error;

      setRefData(prev => ({ ...prev, advancedSkills: [...prev.advancedSkills, data] }));
      setNewAdvancedSkillName('');
      setError(null);
    } catch (err) {
      setError(`Failed to create advanced skill: ${err.message}`);
    }
  };

  const handleStartEditAdvancedSkill = (skill) => {
    setEditingAdvancedSkillId(skill.advanced_skill_id);
    setEditAdvancedSkillName(skill.name);
  };

  const handleUpdateAdvancedSkill = async () => {
    if (!editingAdvancedSkillId || !editAdvancedSkillName.trim()) return;

    try {
      const { data, error } = await updateAdvancedSkill(editingAdvancedSkillId, editAdvancedSkillName.trim());
      if (error) throw error;

      setRefData(prev => ({ ...prev, advancedSkills: prev.advancedSkills.map(s => s.advanced_skill_id === editingAdvancedSkillId ? data : s) }));
      setEditingAdvancedSkillId(null);
      setEditAdvancedSkillName('');
      setError(null);
    } catch (err) {
      setError(`Failed to rename advanced skill: ${err.message}`);
    }
  };

  const handleDeleteAdvancedSkill = async (advancedSkillId) => {
    if (!window.confirm("Delete this advanced skill? It's removed from every staff member, Activity, and Duty Type that has it checked.")) {
      return;
    }

    try {
      const { error } = await deleteAdvancedSkill(advancedSkillId, departmentId);
      if (error) throw error;

      setRefData(prev => ({
        ...prev,
        advancedSkills: prev.advancedSkills.filter(s => s.advanced_skill_id !== advancedSkillId),
        staff: prev.staff.map(s => ({ ...s, advanced_skills: (s.advanced_skills || []).filter(id => id !== advancedSkillId) })),
        activities: prev.activities.map(a => ({ ...a, required_advanced_skills: (a.required_advanced_skills || []).filter(id => id !== advancedSkillId) })),
        dutyTypes: prev.dutyTypes.map(d => ({ ...d, required_advanced_skills: (d.required_advanced_skills || []).filter(id => id !== advancedSkillId) })),
      }));
      setError(null);
    } catch (err) {
      setError(`Failed to delete advanced skill: ${err.message}`);
    }
  };

  const handleUpdateActivityRequiredSkills = async (activityId, skillIds) => {
    try {
      const { data, error } = await updateActivityTypeRequiredSkills(activityId, skillIds);
      if (error) throw error;

      setRefData(prev => ({ ...prev, activities: prev.activities.map(a => a.activity_id === activityId ? data : a) }));
      setError(null);
    } catch (err) {
      setError(`Failed to update required skills: ${err.message}`);
    }
  };

  const handleUpdateDutyTypeRequiredSkills = async (dutyTypeId, skillIds) => {
    try {
      const { data, error } = await updateDutyTypeRequiredSkills(dutyTypeId, skillIds);
      if (error) throw error;

      setRefData(prev => ({ ...prev, dutyTypes: prev.dutyTypes.map(d => d.duty_type_id === dutyTypeId ? data : d) }));
      setError(null);
    } catch (err) {
      setError(`Failed to update required skills: ${err.message}`);
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

  const handleSaveCoffeePlace = async () => {
    if (!departmentId) return;

    setSavingCoffeePlace(true);
    try {
      const { error } = await updateDepartmentCoffeePlace(departmentId, coffeePlaceNameInput.trim(), coffeePlacePhoneInput.trim());
      if (error) throw error;

      setRefData(prev => ({
        ...prev,
        department: { ...prev.department, coffee_place_name: coffeePlaceNameInput.trim() || null, coffee_place_phone: coffeePlacePhoneInput.trim() || null },
      }));
      setError(null);
    } catch (err) {
      setError(`Failed to save coffee place: ${err.message}`);
    } finally {
      setSavingCoffeePlace(false);
    }
  };

  const handleSaveSessionTimes = async () => {
    if (!departmentId) return;

    setSavingSessionTimes(true);
    try {
      const { error } = await updateDepartmentSessionTimes(departmentId, sessionBoundariesInput);
      if (error) throw error;

      setRefData(prev => ({
        ...prev,
        department: {
          ...prev.department,
          morning_start: sessionBoundariesInput.morningStart,
          morning_end: sessionBoundariesInput.morningEnd,
          afternoon_start: sessionBoundariesInput.afternoonStart,
          afternoon_end: sessionBoundariesInput.afternoonEnd,
          night_start: sessionBoundariesInput.nightStart,
          night_end: sessionBoundariesInput.nightEnd,
        },
      }));
      setError(null);
    } catch (err) {
      setError(`Failed to save session times: ${err.message}`);
    } finally {
      setSavingSessionTimes(false);
    }
  };

  // Week Template Handlers (Settings) — create/delete a template, and
  // manage its entries once selected for editing (editingWeekTemplateId).
  const handleCreateWeekTemplate = async () => {
    if (!newWeekTemplateName.trim() || !departmentId) return;

    try {
      const { data, error } = await createWeekTemplate(departmentId, newWeekTemplateName);
      if (error) throw error;

      setRefData(prev => ({ ...prev, weekTemplates: [...prev.weekTemplates, data] }));
      setNewWeekTemplateName('');
      setError(null);
    } catch (err) {
      setError(`Failed to create week template: ${err.message}`);
    }
  };

  const handleDeleteWeekTemplate = async (weekTemplateId) => {
    if (!window.confirm('Delete this week template? Any weeks it was already applied to keep their cards — this only removes the template itself.')) return;

    try {
      const { error } = await deleteWeekTemplate(weekTemplateId);
      if (error) throw error;

      setRefData(prev => ({ ...prev, weekTemplates: prev.weekTemplates.filter(t => t.week_template_id !== weekTemplateId) }));
      if (editingWeekTemplateId === weekTemplateId) {
        setEditingWeekTemplateId(null);
        setWeekTemplateEntries([]);
      }
      setError(null);
    } catch (err) {
      setError(`Failed to delete week template: ${err.message}`);
    }
  };

  const handleSelectWeekTemplateToEdit = async (weekTemplateId) => {
    setEditingWeekTemplateId(weekTemplateId);
    setLoadingWeekTemplateEntries(true);
    try {
      const { data, error } = await getWeekTemplateEntries(weekTemplateId);
      if (error) throw error;
      setWeekTemplateEntries(data);
      setError(null);
    } catch (err) {
      setError(`Failed to load week template entries: ${err.message}`);
    } finally {
      setLoadingWeekTemplateEntries(false);
    }
  };

  const handleAddWeekTemplateEntry = async () => {
    if (!editingWeekTemplateId || !newEntryLocationId || !newEntryActivityId || !newEntryStartTime || !newEntryEndTime) return;

    try {
      const { data, error } = await createWeekTemplateEntry(
        editingWeekTemplateId, newEntryDayOfWeek, newEntryLocationId, newEntryActivityId, newEntryStartTime, newEntryEndTime, newEntrySession
      );
      if (error) throw error;

      setWeekTemplateEntries(prev => [...prev, data]);
      setNewEntryLocationId('');
      setNewEntryActivityId('');
      setNewEntryStartTime('');
      setNewEntryEndTime('');
      setError(null);
    } catch (err) {
      setError(`Failed to add entry: ${err.message}`);
    }
  };

  const handleDeleteWeekTemplateEntry = async (weekTemplateEntryId) => {
    try {
      const { error } = await deleteWeekTemplateEntry(weekTemplateEntryId);
      if (error) throw error;

      setWeekTemplateEntries(prev => prev.filter(e => e.week_template_entry_id !== weekTemplateEntryId));
      setError(null);
    } catch (err) {
      setError(`Failed to remove entry: ${err.message}`);
    }
  };

  // Calendar tab — applies the picked template to a specific Monday-start
  // week, creating the real (empty) cards for it (see applyWeekTemplate),
  // then refreshes the calendar's allocation-status colouring so the
  // change shows immediately.
  const handleApplyTemplate = async (weekStartDate) => {
    if (!applyTemplateId || !departmentId) return;
    const weekStartStr = toLocalDateStr(weekStartDate);
    const template = refData.weekTemplates.find(t => t.week_template_id === applyTemplateId);
    if (!window.confirm(`Apply "${template?.name || 'this template'}" to the week of ${weekStartStr}? This creates the template's cards for that week — it won't touch or remove anything already there.`)) return;

    setApplyingTemplateWeek(weekStartStr);
    try {
      const { error } = await applyWeekTemplate(departmentId, weekStartDate, applyTemplateId);
      if (error) throw error;

      setCalendarRefreshKey(k => k + 1);
      setError(null);
    } catch (err) {
      setError(`Failed to apply template: ${err.message}`);
    } finally {
      setApplyingTemplateWeek(null);
    }
  };

  const handleCopyWeek = async (weekStartDate) => {
    if (!copyFromWeekInput || !departmentId) return;
    const weekStartStr = toLocalDateStr(weekStartDate);
    const fromWeekStart = new Date(`${copyFromWeekInput}T00:00:00`);
    if (weekStartStr === copyFromWeekInput) return; // copying a week onto itself would be a no-op anyway

    if (!window.confirm(`Copy the week of ${copyFromWeekInput}'s cards onto the week of ${weekStartStr}? Only empty location/activity cards come across — no staff — and anything the destination week already has stays untouched.`)) return;

    setCopyingWeek(weekStartStr);
    try {
      const { data, error } = await copyWeekActivities(departmentId, fromWeekStart, weekStartDate);
      if (error) throw error;

      setCalendarRefreshKey(k => k + 1);
      setError(null);
      window.alert(`Copied ${data.copied} card${data.copied === 1 ? '' : 's'}${data.skipped > 0 ? ` (${data.skipped} already existed and were left alone)` : ''}.`);
    } catch (err) {
      setError(`Failed to copy week: ${err.message}`);
    } finally {
      setCopyingWeek(null);
    }
  };

  // Sick Report Handlers (Day view approval banner)
  const handleResolveSickReport = async (sickReportId, status) => {
    try {
      const { error } = await resolveSickReport(sickReportId, status, staffId || null);
      if (error) throw error;

      setPendingSickReports(prev => prev.filter(r => r.sick_report_id !== sickReportId));
      setError(null);
    } catch (err) {
      setError(`Failed to ${status === 'approved' ? 'approve' : 'deny'} sick report: ${err.message}`);
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
  // location: a location hosting several genuinely distinct, simultaneous
  // activities at once would otherwise wrongly copy someone assigned to
  // one onto every other activity's card there too.
  //
  // Each card's own Complete Allocation still has to be run to commit and
  // to re-check consultant cover, same as any other draft change.
  const cascadeAssignmentAcrossSections = (theatreActivityId, locationId, shiftId, staffId, staffName, role) => {
    const shift = refData.shifts.find(s => s.shift_id === shiftId);
    const shiftGroups = getSessionGroups(shift, sessionBoundaries);
    if (shiftGroups.length <= 1) return;

    const originActivityId = theatreActivities.find(t => t.theatre_activity_id === theatreActivityId)?.activity_id;
    if (!originActivityId) return;

    theatreActivities
      .filter(sibling => sibling.location_id === locationId && sibling.activity_id === originActivityId && sibling.theatre_activity_id !== theatreActivityId)
      .forEach(sibling => {
        const siblingGroups = getSessionGroups({ start_time: sibling.start_time, end_time: sibling.end_time }, sessionBoundaries);
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
      const weeks = [];
      for (let w = 0; w < CALENDAR_WEEKS_SHOWN; w++) {
        const weekStart = new Date(calendarWeekStart);
        weekStart.setDate(weekStart.getDate() + w * 7);
        const days = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(weekStart);
          d.setDate(d.getDate() + i);
          days.push(d);
        }
        weeks.push({ weekStart, weekStartStr: toLocalDateStr(weekStart), days });
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
                  {weeks[0].days[0].toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  {' – '}
                  {weeks[weeks.length - 1].days[6].toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
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

              <div className="grid grid-cols-7 gap-2 mb-1">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                  <div key={day} className="text-center text-xs font-bold text-gray-600 py-2">
                    {day}
                  </div>
                ))}
              </div>

              {weeks.map(week => {
                const application = weekTemplateApplications[week.weekStartStr];
                return (
                  <div key={week.weekStartStr} className="mb-3">
                    <div className="flex items-center justify-between mb-1 px-0.5">
                      <p className="text-xs text-gray-500">
                        {application && (
                          <span className="text-purple-700 font-medium">{application.week_templates?.name} applied</span>
                        )}
                      </p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleCopyWeek(week.weekStart)}
                          disabled={!copyFromWeekInput || copyFromWeekInput === week.weekStartStr || copyingWeek === week.weekStartStr}
                          title={!copyFromWeekInput ? 'Pick a source week above first' : undefined}
                          className="text-xs px-2 py-0.5 bg-blue-100 hover:bg-blue-200 disabled:opacity-40 text-blue-900 font-medium rounded transition"
                        >
                          {copyingWeek === week.weekStartStr ? 'Copying…' : 'Copy'}
                        </button>
                        {refData.weekTemplates.length > 0 && (
                          <button
                            onClick={() => handleApplyTemplate(week.weekStart)}
                            disabled={!applyTemplateId || applyingTemplateWeek === week.weekStartStr}
                            className="text-xs px-2 py-0.5 bg-purple-100 hover:bg-purple-200 disabled:opacity-40 text-purple-900 font-medium rounded transition"
                          >
                            {applyingTemplateWeek === week.weekStartStr ? 'Applying…' : 'Apply'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {week.days.map((date, idx) => {
                        const isToday = isSameDate(date, today);
                        const isFirstOfMonth = date.getDate() === 1;
                        const dateStr = toLocalDateStr(date);
                        const dayStatus = calendarAllocationStatus[dateStr] || { status: 'none', missingOnCallAbbrevs: [] };
                        const statusStyle = ALLOCATION_STATUS_STYLES[dayStatus.status];
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              setSelectedDate(date);
                              setActiveTab('day');
                            }}
                            title={[statusStyle.label, dayStatus.missingOnCallAbbrevs.length > 0 ? `On call short: ${dayStatus.missingOnCallAbbrevs.join(', ')}` : null].filter(Boolean).join(' — ')}
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
                            {dayStatus.missingOnCallAbbrevs.length > 0 && (
                              <span className="text-[9px] font-bold leading-none opacity-90">
                                {dayStatus.missingOnCallAbbrevs.join('/')}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-3 mt-4">
                {Object.entries(ALLOCATION_STATUS_STYLES).map(([key, style]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <span className={`w-3 h-3 rounded border ${style.swatch}`} />
                    <span className="text-xs text-gray-600">{style.label}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-6 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setShowPayrollModal(true)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white font-medium rounded-lg transition text-sm"
                >
                  Export to Payroll
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <label className="text-xs text-gray-600 whitespace-nowrap">Copy from week starting</label>
                  <input
                    type="date"
                    value={copyFromWeekInput}
                    onChange={(e) => setCopyFromWeekInput(e.target.value)}
                    className="px-2 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                {refData.weekTemplates.length > 0 && (
                  <select
                    value={applyTemplateId}
                    onChange={(e) => setApplyTemplateId(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">— Pick a template to apply —</option>
                    {refData.weekTemplates.map(t => (
                      <option key={t.week_template_id} value={t.week_template_id}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Copying a week brings across that week's actual location/activity cards (no staff, no template needed) — pick any Monday above, then hit <strong>Copy</strong> on whichever week row above should receive it.
              </p>
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

      const dutyAllocationsByDate = {};
      fortnightDutyAssignments.forEach(d => {
        (dutyAllocationsByDate[d.date] = dutyAllocationsByDate[d.date] || []).push(d);
      });

      const dutyTypeByKey = new Map(refData.dutyTypes.map(dt => [dt.key, dt]));

      // Per-activity abbreviation for the grid's abridged cells — set in
      // Settings → Activities, falling back to the full name so an unset
      // abbreviation doesn't just disappear.
      const activityLabelFor = (a) => {
        const activityId = a.theatre_activities?.activity_id;
        if (!activityId) return null;
        const activity = refData.activities.find(act => act.activity_id === activityId);
        return activity?.abbreviation || activity?.name || null;
      };

      // Session code(s) a {start_time, end_time}-shaped object bridges —
      // reuses the same getSessionGroups logic the Day view groups cards
      // by, rather than picking just the earliest, so a long shift
      // spanning e.g. AM into Night shows as "AM/Night" and not a
      // misleadingly narrow "AM". Takes the shift/duty-type object
      // directly (not the assignment row) so it works for both a regular
      // assignment's shift and a duty type's own configured times.
      const SESSION_LABEL = { morning: 'AM', afternoon: 'PM', night: 'Night' };
      const sessionLabelsForTimes = (shiftLike) => getSessionGroups(shiftLike, sessionBoundaries).map(g => SESSION_LABEL[g]);

      // One entry per person, further grouped by activity — used by both
      // the grid's abridged day cells and the modal's "Already on this
      // day" list, so the two always read the same way. dutyEntries are
      // duty_assignments rows for the same day — these no longer have a
      // staff_assignments row at all (see assignStaffFortnight), so they're
      // merged in here from a separate source, tagged onto the same person
      // and given their own activity group keyed by duty_type. Session
      // labels for a duty group come from that duty type's own start/end
      // time in Settings, if it has one — a duty type with no times set
      // just shows its label with no session.
      const groupAllocationsByStaff = (allocations, dutyEntries = []) => {
        const byStaff = new Map();
        const getOrCreate = (staffId, name) => {
          if (!byStaff.has(staffId)) {
            byStaff.set(staffId, { staffId, name, activityGroups: new Map(), assignmentIds: [], dutyKeys: [], earliestStartTime: null });
          }
          return byStaff.get(staffId);
        };
        const noteStartTime = (person, startTime) => {
          if (!startTime) return;
          if (!person.earliestStartTime || startTime < person.earliestStartTime) person.earliestStartTime = startTime;
        };

        allocations.forEach(a => {
          const person = getOrCreate(a.staff_id, a.staff?.name);
          person.assignmentIds.push(a.assignment_id);
          noteStartTime(person, a.shifts?.start_time);
          const activityKey = a.theatre_activities?.activity_id || 'none';
          if (!person.activityGroups.has(activityKey)) {
            person.activityGroups.set(activityKey, { label: activityLabelFor(a), sessions: new Set() });
          }
          const group = person.activityGroups.get(activityKey);
          sessionLabelsForTimes(a.shifts).forEach(s => group.sessions.add(s));
        });

        dutyEntries.forEach(d => {
          if (!d.staff_id) return;
          const person = getOrCreate(d.staff_id, d.staff?.name);
          person.dutyKeys.push(d.duty_type);
          const groupKey = `duty:${d.duty_type}`;
          const dutyType = dutyTypeByKey.get(d.duty_type);
          noteStartTime(person, dutyType?.start_time);
          if (!person.activityGroups.has(groupKey)) {
            person.activityGroups.set(groupKey, { label: dutyType?.label || d.duty_type, sessions: new Set() });
          }
          if (dutyType?.start_time && dutyType?.end_time) {
            const group = person.activityGroups.get(groupKey);
            sessionLabelsForTimes(dutyType).forEach(s => group.sessions.add(s));
          }
        });

        // Earliest shift/duty start time first, same convenience ordering
        // as the staff view's per-location lists.
        return new Map(
          Array.from(byStaff.entries()).sort((a, b) => (a[1].earliestStartTime || '').localeCompare(b[1].earliestStartTime || ''))
        );
      };

      const selectedStaff = refData.staff.find(s => s.staff_id === fortnightSelectedStaffId);
      const selectedStaffAllocations = fortnightAllocations.filter(a => a.staff_id === fortnightSelectedStaffId);
      const selectedStaffDutyAssignments = fortnightDutyAssignments.filter(d => d.staff_id === fortnightSelectedStaffId);
      // Shifts, not assignment rows: a day where someone covers two
      // activities (e.g. AM Endoscopy then PM Anaesthetics) is one day off
      // their FTE count, not two, so this counts distinct dates — on-call
      // duty days count too, alongside regular activity days.
      const selectedStaffDatesCovered = new Set([
        ...selectedStaffAllocations.map(a => a.date),
        ...selectedStaffDutyAssignments.map(d => d.date),
      ]).size;
      const expectedShifts = selectedStaff ? (selectedStaff.fte ?? DEFAULT_FTE) * 10 : 0;
      const remainingShifts = expectedShifts - selectedStaffDatesCovered;

      const modalDateStr = fortnightModalDate ? toLocalDateStr(fortnightModalDate) : null;
      const modalDateAllocations = modalDateStr ? (allocationsByDate[modalDateStr] || []) : [];
      const modalDateDutyAssignments = modalDateStr ? (dutyAllocationsByDate[modalDateStr] || []) : [];
      const activeShifts = refData.shifts.filter(s => s.active !== false && !/on.?call/i.test(s.name || ''));
      const activeLocations = refData.locations.filter(l => l.active !== false);
      const wizardShift = refData.shifts.find(s => s.shift_id === fortnightWizardShiftId);
      const wizardLocation = refData.locations.find(l => l.location_id === fortnightWizardLocationId);

      // A junior doctor (not consultant/fellow) can't create a fresh,
      // unsupervised card on their own — normally they need to join
      // something that's already happening (see
      // computeCardsInSessionForJunior). Deliberately not restricted to
      // cards that already have a consultant physically on them — an
      // on-call (phone-only) consultant may already be ticked on the card,
      // or the officer may be covering it another way; that judgement call
      // is left to them, same as Day view leaves it. If no such card
      // exists at all, handleFortnightPickShift routes to the 'oncall'
      // step instead, letting the officer build a fresh card with an
      // on-call consultant attached.
      const isJuniorSelectedStaff = !!selectedStaff && rankRequiresSupervision(selectedStaff.rank);
      const cardsInSessionForJunior = computeCardsInSessionForJunior(fortnightWizardShiftId);
      const onCallPeopleForModalDate = modalDateDutyAssignments.filter(d => d.staff_id);

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
                {refData.staffRanks.map(r => (
                  <option key={r.rule_id} value={r.rank}>{r.rank}</option>
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
                <div className="text-center">
                  <h1 className="text-lg font-bold text-gray-900">
                    {days[0].toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                    {' – '}
                    {days[13].toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </h1>
                  <input
                    type="date"
                    value={toLocalDateStr(fortnightStart)}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setFortnightStart(getMondayOfWeek(new Date(`${e.target.value}T00:00:00`)));
                    }}
                    title="Jumps to the Monday of that date's week"
                    className="mt-1 px-2 py-0.5 border border-gray-200 rounded text-xs text-gray-600"
                  />
                </div>
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
                    const dayDutyAssignments = dutyAllocationsByDate[dateStr] || [];
                    const staffOwnAllocation = dayAllocations.find(a => a.staff_id === fortnightSelectedStaffId)
                      || dayDutyAssignments.find(d => d.staff_id === fortnightSelectedStaffId);

                    // One line per person per day, grouped further by
                    // activity — see groupAllocationsByStaff.
                    const byStaff = groupAllocationsByStaff(dayAllocations, dayDutyAssignments);

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
                                onClick={(e) => { e.stopPropagation(); handleRemoveFortnightPersonDay(person, date); }}
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

                    {fortnightWizardStep === 'oncall' && (
                      <>
                        <p className="text-xs font-semibold text-gray-600 uppercase mb-2">2. No consultant on site for this shift time</p>
                        {onCallPeopleForModalDate.length === 0 ? (
                          <p className="text-sm text-gray-500">Nobody's on call this date either — assign a consultant to a card first, then add {selectedStaff.name} to it.</p>
                        ) : (
                          <>
                            <p className="text-xs text-gray-500 mb-2">Select from these:</p>
                            <div className="space-y-2">
                              {onCallPeopleForModalDate.map(d => (
                                <button
                                  key={`${d.date}-${d.duty_type}`}
                                  onClick={() => handleFortnightConfirmOnCall(d.staff_id, d.staff?.name)}
                                  className="w-full text-left px-3 py-2 rounded-lg text-sm border bg-white border-gray-300 hover:bg-blue-50 hover:border-blue-400 transition"
                                >
                                  <span className="block font-medium">{d.staff?.name}</span>
                                  <span className="block text-xs text-gray-500">{dutyTypeByKey.get(d.duty_type)?.label || d.duty_type}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    )}

                    {fortnightWizardStep === 'location' && isJuniorSelectedStaff && cardsInSessionForJunior.length > 0 && (
                      <>
                        <p className="text-xs font-semibold text-gray-600 uppercase mb-2">2. Choose what they're covering</p>
                        <div className="space-y-2">
                          {cardsInSessionForJunior.map(card => (
                            <button
                              key={card.theatreActivityId}
                              onClick={() => handleFortnightPickActivity(card.activityId, card.locationId, card.theatreActivityId)}
                              className="w-full text-left px-3 py-2 rounded-lg text-sm border bg-white border-gray-300 hover:bg-blue-50 hover:border-blue-400 transition"
                            >
                              <span className="block font-medium">
                                {card.locationName} — {card.activityName}
                                {card.startTime && card.endTime && (
                                  <span className="font-normal text-gray-500"> ({card.startTime.slice(0, 5)}–{card.endTime.slice(0, 5)})</span>
                                )}
                              </span>
                              <span className="block text-xs text-gray-500">
                                with {card.people.map(p => `${p.name}${p.role ? ` (${p.role}${p.onCall ? ', on call' : ''})` : ''}`).join(', ')}
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {fortnightWizardStep === 'location' && (!isJuniorSelectedStaff || cardsInSessionForJunior.length === 0) && (
                      <>
                        <p className="text-xs font-semibold text-gray-600 uppercase mb-2">2. Choose a location</p>
                        {fortnightWizardOnCallStaffId && (
                          <p className="text-xs text-gray-500 mb-2">On call: {fortnightWizardOnCallStaffName}</p>
                        )}
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
                    {(() => {
                      const modalByStaff = groupAllocationsByStaff(modalDateAllocations, modalDateDutyAssignments);
                      if (modalByStaff.size === 0) {
                        return <p className="text-sm text-gray-400 italic">Nobody yet.</p>;
                      }
                      return (
                        <div className="space-y-1 p-3 bg-gray-50 rounded-lg border border-gray-200">
                          {Array.from(modalByStaff.values()).map(person => (
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
                                onClick={() => handleRemoveFortnightPersonDay(person, fortnightModalDate)}
                                title="Removes all of this person's activities and duties for the day"
                                className="text-xs text-red-600 hover:text-red-700 font-semibold flex-shrink-0"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
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

            {pendingSickReports.length > 0 && (
              <div className="mb-6 space-y-2">
                {pendingSickReports.map(report => (
                  <div key={report.sick_report_id} className="p-4 bg-red-50 border border-red-300 rounded-lg flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-gray-900">{report.staff?.name} reported sick</p>
                      <p className="text-xs text-gray-600">
                        {new Date(`${report.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleResolveSickReport(report.sick_report_id, 'approved')}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleResolveSickReport(report.sick_report_id, 'denied')}
                        className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-medium rounded-lg transition"
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
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
                  <p className="text-sm text-gray-500">{refData.department?.name || 'Department'} - Rostering Officer</p>
                  <input
                    type="date"
                    value={toLocalDateStr(selectedDate)}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setSelectedDate(new Date(`${e.target.value}T00:00:00`));
                    }}
                    className="mt-1 px-2 py-0.5 border border-gray-200 rounded text-xs text-gray-600"
                  />
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

              {/* One line per person actually on duty today, with every
                  duty type they cover after their name (e.g. someone
                  covering both ED and Anaesthetics on call reads as one
                  line, not two) — a quick-glance summary of the dropdowns
                  below, distinctly coloured from the rest of this panel. */}
              {(() => {
                const dutyByStaff = new Map();
                refData.dutyTypes.filter(d => d.active !== false).forEach(dutyType => {
                  const staffId = dutyAssignments[dutyType.key];
                  if (!staffId) return;
                  if (!dutyByStaff.has(staffId)) {
                    const staffMember = refData.staff.find(s => s.staff_id === staffId);
                    dutyByStaff.set(staffId, { staffId, name: staffMember?.name || '?', labels: [] });
                  }
                  dutyByStaff.get(staffId).labels.push(dutyType.label);
                });

                if (dutyByStaff.size === 0) return null;

                return (
                  <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg space-y-1">
                    {Array.from(dutyByStaff.values()).map(person => (
                      <p key={person.staffId} className="text-sm">
                        <span className="font-semibold text-gray-900">{person.name}</span>
                        <span className="text-indigo-700"> ({person.labels.join(', ')})</span>
                      </p>
                    ))}
                  </div>
                );
              })()}

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
                getSessionGroups({ start_time: ta.start_time, end_time: ta.end_time }, sessionBoundaries).forEach(group => groupedActivities[group].push(ta));
              });
              // Location, then activity, within each session — so two cards
              // for the same location+activity (e.g. ED's staggered Day/Late
              // shifts) land next to each other instead of wherever creation
              // order happened to put them, without changing that they're
              // still genuinely separate, independently-editable cards.
              const activityNameFor = (ta) => refData.activities.find(a => a.activity_id === ta.activity_id)?.name || '';
              Object.values(groupedActivities).forEach(list => {
                list.sort((a, b) =>
                  (a.locations?.name || '').localeCompare(b.locations?.name || '')
                  || activityNameFor(a).localeCompare(activityNameFor(b))
                );
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
                const entryCoversGroup = (entry) => getSessionGroups(refData.shifts.find(s => s.shift_id === entry.shiftId), sessionBoundaries).includes(groupKey);
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

                const hasNobodyAssigned = entries.length === 0;

                return (
                <div key={`${ta.theatre_activity_id}-${groupKey}`} className={`rounded-lg shadow-sm p-6 border-l-4 ${hasNobodyAssigned ? 'bg-red-50 border-red-300' : 'bg-white border-blue-500'}`}>
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
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-900 text-xs font-semibold rounded-full">
                        <Hand size={12} />
                        {getTotalVolunteerCount(ta.theatre_activity_id)} volunteer{getTotalVolunteerCount(ta.theatre_activity_id) === 1 ? '' : 's'} waiting
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
                                <span className="inline-flex items-center gap-1"><Hand size={13} />{s.name}{label}</span>
                              </button>
                            );
                          })}
                          {getRankedStaffOptions(ta.activity_id, s => !rankRequiresSupervision(s.rank) && !volunteerIds.has(s.staff_id) && !consultantEntries.some(ce => ce.staffId === s.staff_id)).map(s => {
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
                                <span className="inline-flex items-center gap-1"><Hand size={13} />{s.name}{label}</span>
                              </button>
                            );
                          })}
                          {getRankedStaffOptions(ta.activity_id, s => rankRequiresSupervision(s.rank) && !volunteerIds.has(s.staff_id) && !registrarEntries.some(re => re.staffId === s.staff_id)).map(s => {
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

            {/* Session Times Section — Morning/Afternoon/Night boundaries
                used to group cards into the Day view's Allocations
                sections and the staff coffee-order filters (see
                shiftSessionUtils.js). Defaults match every department's
                current behavior until edited here. */}
            <CollapsibleSection title="Session Times">
              <p className="text-xs text-gray-500 mb-3">
                Controls which "Allocations" section a shift's hours fall under in the Day view, and the coffee-order session filters. A gap between two windows (e.g. Morning ending before Afternoon starts) belongs to neither.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Morning Start</label>
                  <input
                    type="time"
                    value={sessionBoundariesInput.morningStart}
                    onChange={(e) => setSessionBoundariesInput(prev => ({ ...prev, morningStart: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Morning End</label>
                  <input
                    type="time"
                    value={sessionBoundariesInput.morningEnd}
                    onChange={(e) => setSessionBoundariesInput(prev => ({ ...prev, morningEnd: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Afternoon Start</label>
                  <input
                    type="time"
                    value={sessionBoundariesInput.afternoonStart}
                    onChange={(e) => setSessionBoundariesInput(prev => ({ ...prev, afternoonStart: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Afternoon End</label>
                  <input
                    type="time"
                    value={sessionBoundariesInput.afternoonEnd}
                    onChange={(e) => setSessionBoundariesInput(prev => ({ ...prev, afternoonEnd: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Night Start</label>
                  <input
                    type="time"
                    value={sessionBoundariesInput.nightStart}
                    onChange={(e) => setSessionBoundariesInput(prev => ({ ...prev, nightStart: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Night End</label>
                  <input
                    type="time"
                    value={sessionBoundariesInput.nightEnd}
                    onChange={(e) => setSessionBoundariesInput(prev => ({ ...prev, nightEnd: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">Can wrap past midnight (e.g. 20:00 → 08:00).</p>
                </div>
              </div>
              <button
                onClick={handleSaveSessionTimes}
                disabled={savingSessionTimes}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
              >
                {savingSessionTimes ? 'Saving...' : 'Save'}
              </button>
            </CollapsibleSection>

            {/* Shift Properties Group — Shifts, Shift Pattern Rules, Duty
                Types, Leave Types */}
            <CollapsibleSection title="Shift Properties">
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
                  <input
                    type="text"
                    placeholder="Abbreviation (e.g., 'A') — shown on the Calendar when this slot is short"
                    value={newDutyTypeAbbreviation}
                    onChange={(e) => setNewDutyTypeAbbreviation(e.target.value)}
                    maxLength={4}
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
                          <input
                            type="text"
                            placeholder="Abbreviation (e.g., 'A')"
                            value={editDutyTypeAbbreviation}
                            onChange={(e) => setEditDutyTypeAbbreviation(e.target.value)}
                            maxLength={4}
                            className="px-2 py-1 border border-gray-300 rounded text-sm col-span-2"
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
                            {dutyType.label}{dutyType.abbreviation && <span className="ml-2 text-xs font-normal text-orange-700">({dutyType.abbreviation})</span>}{dutyType.active === false && <span className="ml-2 text-xs font-normal text-gray-500">(inactive)</span>}
                          </p>
                          <p className="text-xs text-gray-600">
                            {dutyType.counts_as_on_call ? 'Counts as on call' : 'Not counted as on call'} • order {dutyType.sort_order}
                            {dutyType.start_time && dutyType.end_time
                              ? ` • ${dutyType.start_time.slice(0, 5)}–${dutyType.end_time.slice(0, 5)} card at On Call`
                              : ' • no card (top panel only)'}
                            {dutyType.required_advanced_skills?.length > 0 && (
                              <span className="text-purple-700"> • requires {dutyType.required_advanced_skills.length} skill{dutyType.required_advanced_skills.length === 1 ? '' : 's'}</span>
                            )}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingDutyTypeSkillsId(dutyType.duty_type_id)}
                            className="px-3 py-1 bg-purple-100 hover:bg-purple-200 text-purple-900 font-medium rounded text-xs transition"
                          >
                            Skills
                          </button>
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
            </CollapsibleSection>

            {/* Week Templates Section — the "what has to happen every
                week" skeleton (locations + activities per day-of-week, no
                staff) applied to a specific week from the Calendar tab,
                which then colours red if a required slot goes unfilled. */}
            <CollapsibleSection title="Week Templates">
              <div className="mb-6 p-4 bg-purple-50 rounded-lg">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Template name (e.g., 'Standard Week')"
                    value={newWeekTemplateName}
                    onChange={(e) => setNewWeekTemplateName(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <button
                    onClick={handleCreateWeekTemplate}
                    disabled={!newWeekTemplateName.trim()}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
                  >
                    Add Template
                  </button>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {refData.weekTemplates.length === 0 && (
                  <p className="text-sm text-gray-500">No week templates yet — add one above.</p>
                )}
                {refData.weekTemplates.map(template => (
                  <div key={template.week_template_id} className={`p-3 border rounded-lg flex items-center justify-between ${editingWeekTemplateId === template.week_template_id ? 'border-purple-400 bg-purple-50' : 'border-gray-200'}`}>
                    <p className="font-semibold text-sm text-gray-900">{template.name}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSelectWeekTemplateToEdit(template.week_template_id)}
                        className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition"
                      >
                        {editingWeekTemplateId === template.week_template_id ? 'Editing…' : 'Edit'}
                      </button>
                      <button
                        onClick={() => handleDeleteWeekTemplate(template.week_template_id)}
                        className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded text-xs transition"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {editingWeekTemplateId && (
                <div className="border-t border-gray-200 pt-4">
                  <p className="text-xs font-semibold text-gray-600 uppercase mb-3">
                    Entries for {refData.weekTemplates.find(t => t.week_template_id === editingWeekTemplateId)?.name}
                  </p>

                  <div className="mb-4 p-3 bg-gray-50 rounded-lg space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={newEntryDayOfWeek}
                        onChange={(e) => setNewEntryDayOfWeek(parseInt(e.target.value, 10))}
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                      >
                        {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((label, idx) => (
                          <option key={idx} value={idx}>{label}</option>
                        ))}
                      </select>
                      <select
                        value={newEntrySession}
                        onChange={(e) => setNewEntrySession(e.target.value)}
                        title="Matched against a shift with the same session at apply time, purely to satisfy the card's required shift field"
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                      >
                        <option value="full">Whole Day</option>
                        <option value="AM">Morning</option>
                        <option value="PM">Afternoon</option>
                        <option value="night">Night</option>
                      </select>
                      <select
                        value={newEntryLocationId}
                        onChange={(e) => {
                          const locationId = e.target.value;
                          setNewEntryLocationId(locationId);
                          // Pre-fill rather than force — the officer can still
                          // change it, this just saves the click when there's
                          // only one legal choice anyway.
                          const onlyActivity = activitiesAllowedAtLocation(locationId);
                          setNewEntryActivityId(onlyActivity.length === 1 ? onlyActivity[0].activity_id : '');
                        }}
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                      >
                        <option value="">— Location —</option>
                        {refData.locations.filter(l => l.active !== false).map(l => (
                          <option key={l.location_id} value={l.location_id}>{l.name}</option>
                        ))}
                      </select>
                      <select
                        value={newEntryActivityId}
                        onChange={(e) => setNewEntryActivityId(e.target.value)}
                        disabled={!newEntryLocationId}
                        className="px-2 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
                      >
                        <option value="">— Activity —</option>
                        {activitiesAllowedAtLocation(newEntryLocationId).map(a => (
                          <option key={a.activity_id} value={a.activity_id}>{a.name}</option>
                        ))}
                      </select>
                      <input
                        type="time"
                        value={newEntryStartTime}
                        onChange={(e) => setNewEntryStartTime(e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                      <input
                        type="time"
                        value={newEntryEndTime}
                        onChange={(e) => setNewEntryEndTime(e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <button
                      onClick={handleAddWeekTemplateEntry}
                      disabled={!newEntryLocationId || !newEntryActivityId || !newEntryStartTime || !newEntryEndTime}
                      className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
                    >
                      Add Entry
                    </button>
                  </div>

                  {loadingWeekTemplateEntries ? (
                    <p className="text-sm text-gray-500">Loading entries…</p>
                  ) : (
                    <div className="space-y-3">
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((dayLabel, dayIdx) => {
                        const dayEntries = weekTemplateEntries.filter(e => e.day_of_week === dayIdx);
                        if (dayEntries.length === 0) return null;
                        return (
                          <div key={dayIdx}>
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{dayLabel}</p>
                            <div className="space-y-1">
                              {dayEntries.map(entry => {
                                const location = refData.locations.find(l => l.location_id === entry.location_id);
                                const activity = refData.activities.find(a => a.activity_id === entry.activity_id);
                                return (
                                  <div key={entry.week_template_entry_id} className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg text-sm">
                                    <span>
                                      {location?.name || 'Unknown location'} — {activity?.name || 'Unknown activity'}
                                      <span className="text-gray-500"> ({entry.start_time?.slice(0, 5)}–{entry.end_time?.slice(0, 5)})</span>
                                    </span>
                                    <button
                                      onClick={() => handleDeleteWeekTemplateEntry(entry.week_template_entry_id)}
                                      className="text-xs text-red-600 hover:text-red-700 font-semibold"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      {weekTemplateEntries.length === 0 && (
                        <p className="text-sm text-gray-500">No entries yet — add one above.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CollapsibleSection>

            {/* Excel Roster Import Section — see rosterExcelImport.js for
                what's covered (SMO/Consultant, Registrar/RMO, Intern) and
                what's deliberately not (Locums, the Standby/AF summary). */}
            <CollapsibleSection title="Excel Roster Import">
              <RosterExcelImportTab
                departmentId={departmentId}
                department={refData.department}
                staffList={refData.staff}
                locations={refData.locations}
                activities={refData.activities}
                leaveTypes={refData.leaveTypes}
                staffRanks={refData.staffRanks}
                onStaffChanged={refreshStaffList}
                isSuperAdmin={isSuperAdmin}
                onDepartmentChanged={(patch) => setRefData(prev => ({ ...prev, department: { ...prev.department, ...patch } }))}
              />
            </CollapsibleSection>

            {/* Excel Roster Export — the reverse direction: downloads one
                or more consecutive weeks of the live roster as an .xlsx.
                See RosterExcelExportTab.jsx / rosterExcelExport.js /
                fetchRosterExportWeek for what it does and doesn't try to
                reproduce from the original source file's layout. */}
            <CollapsibleSection title="Excel Roster Export">
              <RosterExcelExportTab
                departmentId={departmentId}
                staffList={refData.staff}
                locations={refData.locations}
                activities={refData.activities}
                leaveTypes={refData.leaveTypes}
              />
            </CollapsibleSection>

            {/* Phone Book Section — non-staff numbers (nearest tertiary
                ED, on-site ED SMO line, Nurse Unit Manager, etc.), shown to
                everyone under the staff view's Phone Book tab. */}
            <CollapsibleSection title="Phone Book">
              {/* Coffee Place — separate from the general numbers list
                  below: the Coffee Orders modal looks this up directly to
                  build its "text the order" link. */}
              <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
                <p className="text-xs font-semibold text-amber-900 uppercase mb-2">Coffee Place</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <input
                    type="text"
                    placeholder="Name (e.g., 'Roasted on Main')"
                    value={coffeePlaceNameInput}
                    onChange={(e) => setCoffeePlaceNameInput(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="tel"
                    placeholder="Phone number"
                    value={coffeePlacePhoneInput}
                    onChange={(e) => setCoffeePlacePhoneInput(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <button
                  onClick={handleSaveCoffeePlace}
                  disabled={savingCoffeePlace}
                  className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
                >
                  {savingCoffeePlace ? 'Saving...' : 'Save'}
                </button>
                <p className="text-xs text-gray-500 mt-2">Where the staff view's Coffee Orders summary texts the order to.</p>
              </div>

              <div className="mb-6 p-4 bg-teal-50 rounded-lg">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <input
                    type="text"
                    placeholder="Name (e.g., 'Nearest Tertiary ED')"
                    value={newPhoneBookLabel}
                    onChange={(e) => setNewPhoneBookLabel(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="tel"
                    placeholder="Phone number"
                    value={newPhoneBookPhone}
                    onChange={(e) => setNewPhoneBookPhone(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <button
                  onClick={handleCreatePhoneBookEntry}
                  disabled={!newPhoneBookLabel.trim() || !newPhoneBookPhone.trim()}
                  className="w-full px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
                >
                  Add Number
                </button>
              </div>

              <div className="space-y-2">
                {refData.phoneBookEntries.length === 0 && (
                  <p className="text-sm text-gray-500">No phone book entries yet — add one above.</p>
                )}
                {refData.phoneBookEntries.map(entry => (
                  <div key={entry.phone_book_entry_id} className="p-3 border border-gray-200 rounded-lg flex items-center justify-between gap-2">
                    {editingPhoneBookEntryId === entry.phone_book_entry_id ? (
                      <div className="flex flex-wrap gap-2 items-center flex-1">
                        <input
                          type="text"
                          value={editPhoneBookLabel}
                          onChange={(e) => setEditPhoneBookLabel(e.target.value)}
                          className="flex-1 min-w-[8rem] px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <input
                          type="tel"
                          value={editPhoneBookPhone}
                          onChange={(e) => setEditPhoneBookPhone(e.target.value)}
                          className="px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <button
                          onClick={handleUpdatePhoneBookEntry}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingPhoneBookEntryId(null)}
                          className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded text-xs transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="font-semibold text-sm text-gray-900">{entry.label}</p>
                          <p className="text-xs text-gray-600 font-mono">{entry.phone}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleStartEditPhoneBookEntry(entry)}
                            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeletePhoneBookEntry(entry.phone_book_entry_id)}
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

            {/* Card Properties Group — Locations, Activities */}
            <CollapsibleSection title="Card Properties">
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
                            onClick={() => setEditingLocationSkillsId(loc.location_id)}
                            className="px-3 py-1 bg-purple-100 hover:bg-purple-200 text-purple-900 font-medium rounded text-xs transition"
                          >
                            Skills
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
                          {act.required_advanced_skills?.length > 0 && (
                            <span className="ml-2 text-xs font-normal text-purple-700">
                              · requires {act.required_advanced_skills.length} skill{act.required_advanced_skills.length === 1 ? '' : 's'}
                            </span>
                          )}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingActivitySkillsId(act.activity_id)}
                            className="px-3 py-1 bg-purple-100 hover:bg-purple-200 text-purple-900 font-medium rounded text-xs transition"
                          >
                            Skills
                          </button>
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
            </CollapsibleSection>

            {/* Audit Balance Group — Case Mix Report, On-Call & Weekend
                Fairness */}
            <CollapsibleSection title="Audit Balance">
            {/* Case Mix Report Section */}
            <CollapsibleSection title="Case Mix Report">
              <CaseMixReport departmentId={departmentId} refreshKey={staffVersion} />
            </CollapsibleSection>

            {/* On-Call / Weekend Fairness Section */}
            <CollapsibleSection title="On-Call & Weekend Fairness">
              <FairnessReport departmentId={departmentId} refreshKey={staffVersion} />
            </CollapsibleSection>

            {/* Rule Violations Section — ED-specific hard scheduling rules
                (see edRuleChecks.js), gated on this department actually
                using the ED shift-code vocabulary those rules are written
                against (roster_import_format doubles as that signal —
                confirmed 2026-09-01 these rules are department-specific,
                not generic). */}
            {refData.department?.roster_import_format === 'ed' && (
              <CollapsibleSection title="Rule Violations">
                <RuleViolationsReport
                  departmentId={departmentId}
                  state={ruleCheckState}
                  setState={setRuleCheckState}
                  onInvestigate={(staffId, dateStr) => {
                    setFortnightSelectedStaffId(staffId);
                    setFortnightStart(getMondayOfWeek(new Date(`${dateStr}T00:00:00`)));
                    setActiveTab('fortnight');
                  }}
                  onInvestigateDate={(dateStr) => {
                    setSelectedDate(new Date(`${dateStr}T00:00:00`));
                    setActiveTab('day');
                  }}
                />
              </CollapsibleSection>
            )}
            </CollapsibleSection>

            {/* Staff Settings Group — Ranks, Staff and Availability, Staff
                Activity Profiles, Staff Accounts */}
            <CollapsibleSection title="Staff Settings">
            {/* Ranks Section — a prerequisite for adding staff at all (see
                migrations/2026-08-31_staff_ranks.sql): a staff member's rank
                must match one of this department's own configured ranks. */}
            <CollapsibleSection title="Ranks">
              {rankError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                  <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{rankError}</p>
                </div>
              )}

              <div className="mb-4 p-3 border border-gray-200 rounded-lg space-y-2">
                <input
                  type="text"
                  placeholder="Rank name (e.g., 'Basic Trainee (ACRRM, RACGP, CICM, GP)')"
                  value={newRankName}
                  onChange={(e) => setNewRankName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <div className="flex gap-2 items-center">
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={newRankRequiresSupervision}
                      onChange={(e) => setNewRankRequiresSupervision(e.target.checked)}
                    />
                    Requires supervision by a higher rank
                  </label>
                  <button
                    onClick={handleCreateStaffRank}
                    disabled={savingRank || !newRankName.trim()}
                    className="ml-auto px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
                  >
                    Add
                  </button>
                </div>
              </div>

              {refData.staffRanks.length === 0 ? (
                <p className="text-sm text-gray-500">No ranks configured yet — staff can't be added until at least one exists.</p>
              ) : (
                <div className="space-y-2">
                  {[...refData.staffRanks].sort((a, b) => a.sort_order - b.sort_order).map((rank, index, sorted) => (
                    <div key={rank.rule_id} className="p-3 border border-gray-200 rounded-lg flex items-center justify-between gap-2">
                      {editingRankId === rank.rule_id ? (
                        <div className="flex flex-wrap gap-2 items-center flex-1">
                          <input
                            type="text"
                            value={editRankName}
                            onChange={(e) => setEditRankName(e.target.value)}
                            className="flex-1 min-w-[10rem] px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                          <button
                            onClick={handleSaveRankName}
                            disabled={savingRank || !editRankName.trim()}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded text-xs transition"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingRankId(null)}
                            className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded text-xs transition"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <div>
                            <p className="font-semibold text-sm text-gray-900">{rank.rank}</p>
                            <label className="flex items-center gap-1.5 text-xs text-gray-600 mt-1">
                              <input
                                type="checkbox"
                                checked={rank.requires_supervision}
                                disabled={savingRank}
                                onChange={() => handleToggleRankSupervision(rank)}
                              />
                              Requires supervision by a higher rank
                            </label>
                          </div>
                          <div className="flex gap-1 items-center">
                            <button
                              onClick={() => handleMoveRank(rank, 'up')}
                              disabled={savingRank || index === 0}
                              title="Move up"
                              className="px-2 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-700 font-medium rounded text-xs transition"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => handleMoveRank(rank, 'down')}
                              disabled={savingRank || index === sorted.length - 1}
                              title="Move down"
                              className="px-2 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-700 font-medium rounded text-xs transition"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => handleStartEditRank(rank)}
                              className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => handleDeleteStaffRank(rank)}
                              disabled={savingRank}
                              className="px-3 py-1 bg-red-100 hover:bg-red-200 disabled:opacity-50 text-red-900 font-medium rounded text-xs transition"
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleSection>

            {/* Staff and Availability Section */}
            <CollapsibleSection title="Staff and Availability">
              <StaffAvailabilityTab departmentId={departmentId} staffList={refData.staff} leaveTypes={refData.leaveTypes} advancedSkills={refData.advancedSkills} staffRanks={refData.staffRanks} onStaffChanged={refreshStaffList} />
            </CollapsibleSection>

            {/* Staff Profiles Section */}
            <CollapsibleSection title="Staff Activity Profiles">
              <StaffProfilesTab departmentId={departmentId} refreshKey={staffVersion} />
            </CollapsibleSection>

            {/* Staff Accounts Section */}
            <CollapsibleSection title="Staff Accounts">
              <StaffAccountsTab departmentId={departmentId} refreshKey={staffVersion} staffRanks={refData.staffRanks} />
            </CollapsibleSection>
            </CollapsibleSection>

            {/* Staff Filters Group — the configurable Advanced Skill list
                used to tag staff (Staff and Availability tab, above) and to
                restrict who's offered for an Activity/Duty Type slot (the
                "Skills" button on each, in Card Properties/Duty Types). */}
            <CollapsibleSection title="Staff Filters">
            <CollapsibleSection title="Advanced Skill">
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  placeholder="Skill name (e.g., 'Anaesthetics')"
                  value={newAdvancedSkillName}
                  onChange={(e) => setNewAdvancedSkillName(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <button
                  onClick={handleCreateAdvancedSkill}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition text-sm"
                >
                  Add
                </button>
              </div>

              <p className="text-xs text-gray-600 mb-4">
                Officers check these against each staff member in Staff and Availability, then require one-or-more of them on an Activity or Duty Type to limit who's offered for that slot — e.g. only staff with Anaesthetics or Endoscopy show up for an Endoscopy consultant slot.
              </p>

              <div className="space-y-2">
                {refData.advancedSkills.map(skill => (
                  <div key={skill.advanced_skill_id} className="p-3 border border-gray-200 rounded-lg flex items-center justify-between gap-2">
                    {editingAdvancedSkillId === skill.advanced_skill_id ? (
                      <div className="flex gap-2 items-center flex-1">
                        <input
                          type="text"
                          value={editAdvancedSkillName}
                          onChange={(e) => setEditAdvancedSkillName(e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <button
                          onClick={handleUpdateAdvancedSkill}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingAdvancedSkillId(null)}
                          className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded text-xs transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="font-semibold text-sm text-gray-900">{skill.name}</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleStartEditAdvancedSkill(skill)}
                            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteAdvancedSkill(skill.advanced_skill_id)}
                            className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded text-xs transition"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {refData.advancedSkills.length === 0 && (
                  <p className="text-sm text-gray-500">No advanced skills yet — add one above.</p>
                )}
              </div>
            </CollapsibleSection>
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

      {/* Location Activity Skills Matrix — a location-scoped view onto the
          same activity_types.required_advanced_skills set from the
          Activities section's own "Skills" button (see
          handleUpdateActivityRequiredSkills). Only lists activities usable
          at this location (activitiesAllowedAtLocation), since that's the
          set an officer actually cares about from here. The requirement
          itself is shared everywhere that activity is used, not scoped to
          just this location. */}
      {editingLocationSkillsId && (() => {
        const location = refData.locations.find(l => l.location_id === editingLocationSkillsId);
        const activitiesHere = activitiesAllowedAtLocation(editingLocationSkillsId);
        const toggleSkill = (activity, skillId) => {
          const current = activity.required_advanced_skills || [];
          const next = current.includes(skillId) ? current.filter(id => id !== skillId) : [...current, skillId];
          handleUpdateActivityRequiredSkills(activity.activity_id, next);
        };
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-3xl max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{location?.name} — Required Advanced Skills by Activity</h2>
                  <p className="text-sm text-gray-600">Leave an activity with none checked to allow any staff. Otherwise, only staff with at least one checked skill are offered for its consultant/registrar slots — this applies wherever that activity is used, not just at {location?.name}.</p>
                </div>
                <button onClick={() => setEditingLocationSkillsId(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                  <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {refData.advancedSkills.length === 0 ? (
                <p className="text-sm text-gray-500">No advanced skills configured yet — add some under Staff Filters -&gt; Advanced Skill in Settings.</p>
              ) : activitiesHere.length === 0 ? (
                <p className="text-sm text-gray-500">No activities are usable at this location yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-3 py-2 border border-gray-200 font-semibold text-sm text-gray-700">Activity</th>
                        {refData.advancedSkills.map(skill => (
                          <th key={skill.advanced_skill_id} className="text-center px-3 py-2 border border-gray-200 font-semibold text-sm text-gray-700">
                            {skill.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activitiesHere.map(activity => (
                        <tr key={activity.activity_id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 border border-gray-200 text-sm font-semibold text-gray-900">{activity.name}</td>
                          {refData.advancedSkills.map(skill => (
                            <td key={skill.advanced_skill_id} className="text-center px-3 py-2 border border-gray-200">
                              <input
                                type="checkbox"
                                checked={(activity.required_advanced_skills || []).includes(skill.advanced_skill_id)}
                                onChange={() => toggleSkill(activity, skill.advanced_skill_id)}
                                className="w-5 h-5 cursor-pointer accent-purple-600"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Activity Required Skills Modal — narrows the consultant/registrar
          pickers for this Activity to staff holding at least one of these
          Advanced Skills. Empty = no restriction. */}
      {editingActivitySkillsId && (() => {
        const activity = refData.activities.find(a => a.activity_id === editingActivitySkillsId);
        const requiredIds = activity?.required_advanced_skills || [];
        const required = refData.advancedSkills.filter(s => requiredIds.includes(s.advanced_skill_id));
        const notRequired = refData.advancedSkills.filter(s => !requiredIds.includes(s.advanced_skill_id));
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{activity?.name} — Required Advanced Skills</h2>
                  <p className="text-sm text-gray-600">Leave empty to allow any staff. Otherwise, only staff with at least one checked skill are offered.</p>
                </div>
                <button onClick={() => setEditingActivitySkillsId(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                  <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {refData.advancedSkills.length === 0 ? (
                <p className="text-sm text-gray-500">No advanced skills configured yet — add some under Staff Filters -&gt; Advanced Skill in Settings.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Available Skills</p>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
                      {notRequired.length === 0 && (
                        <p className="p-3 text-sm text-gray-400 italic">Every skill is already required</p>
                      )}
                      {notRequired.map(skill => (
                        <button
                          key={skill.advanced_skill_id}
                          onClick={() => handleUpdateActivityRequiredSkills(activity.activity_id, [...requiredIds, skill.advanced_skill_id])}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition flex items-center justify-between gap-2"
                        >
                          {skill.name}
                          <span className="text-blue-600 text-xs font-semibold flex-shrink-0">Add →</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Required Here (any one)</p>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
                      {required.length === 0 && (
                        <p className="p-3 text-sm text-gray-400 italic">None selected — every staff member is offered</p>
                      )}
                      {required.map(skill => (
                        <button
                          key={skill.advanced_skill_id}
                          onClick={() => handleUpdateActivityRequiredSkills(activity.activity_id, requiredIds.filter(id => id !== skill.advanced_skill_id))}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 transition flex items-center justify-between gap-2"
                        >
                          <span className="text-red-600 text-xs font-semibold flex-shrink-0">← Remove</span>
                          {skill.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Duty Type Required Skills Modal — same as the Activity one above,
          but narrows the Duty Assignments dropdown for this on-call slot. */}
      {editingDutyTypeSkillsId && (() => {
        const dutyType = refData.dutyTypes.find(d => d.duty_type_id === editingDutyTypeSkillsId);
        const requiredIds = dutyType?.required_advanced_skills || [];
        const required = refData.advancedSkills.filter(s => requiredIds.includes(s.advanced_skill_id));
        const notRequired = refData.advancedSkills.filter(s => !requiredIds.includes(s.advanced_skill_id));
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{dutyType?.label} — Required Advanced Skills</h2>
                  <p className="text-sm text-gray-600">Leave empty to allow any staff. Otherwise, only staff with at least one checked skill are offered.</p>
                </div>
                <button onClick={() => setEditingDutyTypeSkillsId(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                  <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {refData.advancedSkills.length === 0 ? (
                <p className="text-sm text-gray-500">No advanced skills configured yet — add some under Staff Filters -&gt; Advanced Skill in Settings.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Available Skills</p>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
                      {notRequired.length === 0 && (
                        <p className="p-3 text-sm text-gray-400 italic">Every skill is already required</p>
                      )}
                      {notRequired.map(skill => (
                        <button
                          key={skill.advanced_skill_id}
                          onClick={() => handleUpdateDutyTypeRequiredSkills(dutyType.duty_type_id, [...requiredIds, skill.advanced_skill_id])}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition flex items-center justify-between gap-2"
                        >
                          {skill.name}
                          <span className="text-blue-600 text-xs font-semibold flex-shrink-0">Add →</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Required Here (any one)</p>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
                      {required.length === 0 && (
                        <p className="p-3 text-sm text-gray-400 italic">None selected — every staff member is offered</p>
                      )}
                      {required.map(skill => (
                        <button
                          key={skill.advanced_skill_id}
                          onClick={() => handleUpdateDutyTypeRequiredSkills(dutyType.duty_type_id, requiredIds.filter(id => id !== skill.advanced_skill_id))}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 transition flex items-center justify-between gap-2"
                        >
                          <span className="text-red-600 text-xs font-semibold flex-shrink-0">← Remove</span>
                          {skill.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
            <Settings size={20} className="mx-auto" />
            <div className="text-[10px] font-semibold mt-0.5">Settings</div>
          </button>
        </div>
      </div>
    </div>
  );
}
