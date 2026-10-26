import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, X, AlertCircle, Loader, Search, Download, Coffee, Copy, Check, Hand, Settings, Phone, Star, Shuffle, Plus } from 'lucide-react';
import TwoFactorSettings from './TwoFactorSettings';
import ChangePassword from './ChangePassword';
import NotificationSettings from './NotificationSettings';
import StaffWalkthrough from './StaffWalkthrough';
import { CallbackBanner, MyCallbacks } from './CallbackPanel';
import {
  getStaffById,
  getStaffAssignmentsForStaffDate,
  getStaffAssignmentsForDate,
  getStaffAssignmentsForWeek,
  getVisitorAssignmentsForDate,
  getAllOnCallAssignmentsForWeek,
  getDutyAssignmentsForDate,
  getDutyTypes,
  getPhoneBookEntries,
  getDepartment,
  searchStaff,
  getStaffAvailability,
  toggleStaffAvailability,
  getStaffWeekScheduleForExport,
  getStaffAssignmentDatesInRange,
  getAvailableShiftsForStaff,
  createVolunteerRequest,
  getStaffRanks,
  getMySickCallState,
  createSickReport,
  getSickCallRecipients,
  createSickCallAlerts,
  notifyVolunteering,
  updateMyCoffeeOrder,
  getActivityTypes,
  updateMyActivityRestrictions,
  updateMyEmail,
  updateMyPhone,
  signOut,
  getStarredStaff,
  starStaffMember,
  unstarStaffMember,
  getCoffeeOrderAdjustments,
  getVisitorsForDate,
  removeCoffeeOrderStaff,
  restoreCoffeeOrderStaff,
  addCoffeeOrderExtra,
  removeCoffeeOrderExtra,
} from './supabaseClient';
import CollapsibleSection from './CollapsibleSection';
import CoffeePicker from './CoffeePicker';
import { summarizeCoffeeOrder } from './coffeeDay';
import EditableCell from './EditableCell';
import { getSessionGroups, SESSION_GROUP_ORDER, SESSION_GROUP_LABELS, getDepartmentSessionBoundaries, dedupeAssignmentsByShift } from './shiftSessionUtils';
import {
  computeAvailabilityCompliance,
  COMPLIANCE_STYLES,
  getAvailabilityState,
  nextAvailabilityState,
  stateToStoredValue,
  storedAvailabilityValue,
  DAY_STATE_STYLES,
} from './availabilityUtils';
import { buildAssignmentsIcs, getIcsExportFilename, downloadTextFile } from './icsExport';
import { toLocalDateStr } from './dateUtils';
import { NO_COFFEE, NO_MILK, COFFEE_TYPES, MILK_TYPES, milkIsFixedForCoffeeType, parseCoffeeOrder, composeCoffeeOrder, coffeeAttention } from './coffeeUtils';
import { getMondayOfWeek } from './payrollExport';
import { isIOS } from './installPrompt';
import { GRADE_LABEL } from './staffGrade';
import { jobCategoryFor, jobCardStyle, jobBoxStyle, holdsOnCallDuty } from './jobColours';
import { edLateOnCallFor } from './edLateOnCall';
import { sickCallShiftsInWindow, describeSickCallShift } from './sickCallShifts';

const SETTINGS_WEEKS_SHOWN = 4;
const SETTINGS_DAYS_SHOWN = SETTINGS_WEEKS_SHOWN * 7;
const SETTINGS_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const COFFEE_SESSION_LABELS = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' };

// staff_assignments.role is only ever the coarse consultant/registrar
// bucket a rank was mapped to at assignment time (see the roleForRank-style
// logic in supabaseClient.js) — showing it next to a colleague's name read
// as their rank but wasn't one (an Intern shows role: 'registrar'). This is
// the real rank, from the joined staff row.
//
// Ranks are now a free-text, per-department list (see
// migrations/2026-08-31_staff_ranks.sql and Settings → Ranks) — an officer
// types the display text directly (e.g. "TS4"), so it needs no lookup.
// This map only exists to pretty-print the handful of snake_case values
// every department was seeded with before that change.
const RANK_LABEL = {
  consultant: 'Consultant',
  fellow: 'Fellow',
  advanced_trainee: 'Advanced Trainee',
  basic_trainee: 'Basic Trainee',
  intern: 'Intern',
};

// A visitor's role line: "Consultant · DR Roster" for a district doctor,
// else their place on the card ("Surgeon").
const visitorLabel = (v) => {
  const role = v.role === 'consultant' ? 'Consultant' : v.role === 'registrar' ? 'Registrar' : v.role;
  return v.source === 'dr_roster' ? `${role} · DR Roster` : role;
};

const toDateStr = toLocalDateStr;


// Why each person is on the Notify Sick modal's list — see
// getSickCallRecipients in supabaseClient.js.
const SICK_CALL_REASON_LABEL = {
  officer: 'Rostering officer',
  on_call: 'On call now',
  next_day_consultant: 'Consultant tomorrow 08:00',
};

function formatCrossoverWeekRange(weekStart) {
  if (!weekStart) return '';
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  return `${fmt(weekStart)} – ${fmt(end)}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export default function StaffRosterView({ departmentId, staffId }) {
  // A notification about an offered shift links to ?tab=volunteer (see
  // supabase/functions/notify-volunteering), opening Variation directly.
  const [activeTab, setActiveTab] = useState(() => (
    new URLSearchParams(window.location.search).get('tab') === 'volunteer' ? 'volunteer' : 'day'
  ));
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dayViewDate, setDayViewDate] = useState(new Date());
  const [staffMember, setStaffMember] = useState(null);
  const [staffRanks, setStaffRanks] = useState([]); // rank_supervision_rules for this department — just enough to know if this staff member is senior, for the "hide registrar shifts" toggle below
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // This department's configured on-call/duty slots (see
  // migrations/2026-08-22_duty_types.sql) — drives the On-Call widget on the
  // Day tab and the on-call tab's weekly grouping, replacing what used to be
  // a fixed first/second-on-call + AM/PM coordinator list for every department.
  const [dutyTypes, setDutyTypes] = useState([]);

  // Day tab state
  const [todayAssignments, setTodayAssignments] = useState([]); // this staff member's own assignments
  const [todayAllAssignments, setTodayAllAssignments] = useState([]); // whole department's assignments, for the Morning/Afternoon/Night "who is where" lookup
  const [todayOnCallRows, setTodayOnCall] = useState([]); // duty_assignments; see todayOnCall below
  // Which of "My allocations for today" row is expanded to show who else
  // is on that same session, if any.
  const [expandedAllocationId, setExpandedAllocationId] = useState(null);
  const [loadingDay, setLoadingDay] = useState(false);

  // Week tab state
  const [weekAssignments, setWeekAssignments] = useState([]);
  const [loadingWeek, setLoadingWeek] = useState(false);

  // Starred colleagues (see migrations/2026-08-31_staff_favorites.sql) —
  // shown under "your weekly assignments", expandable to their own week,
  // with a "crossover" comparison against the current week.
  const [starredStaff, setStarredStaff] = useState([]);
  const [starringError, setStarringError] = useState(null);
  const [expandedStarredId, setExpandedStarredId] = useState(null);
  const [colleagueWeekAssignments, setColleagueWeekAssignments] = useState([]);
  const [loadingColleagueWeek, setLoadingColleagueWeek] = useState(false);
  const [crossoverStaff, setCrossoverStaff] = useState(null); // { starred_staff_id, staff: {name} }
  const [crossoverWeekStart, setCrossoverWeekStart] = useState(null);
  const [crossoverDays, setCrossoverDays] = useState(null);
  const [loadingCrossover, setLoadingCrossover] = useState(false);

  // On-call tab state (renamed "Phone Book" in the nav — the on-call
  // roster plus the officer-managed non-staff numbers below it)
  const [allOnCallAssignments, setAllOnCallAssignments] = useState([]);
  const [loadingOnCall, setLoadingOnCall] = useState(false);
  const [phoneBookEntries, setPhoneBookEntries] = useState([]);
  const [department, setDepartment] = useState(null); // for coffee_place_name/coffee_place_phone — see the Coffee Orders modal

  // This department's Morning/Afternoon/Night windows (see
  // migrations/2026-08-31_department_session_times.sql) — passed into every
  // getSessionGroups call below.
  const sessionBoundaries = getDepartmentSessionBoundaries(department);

  // Volunteer tab state (nav label "Variation" — this tab covers both
  // picking up unfilled shifts and reporting sick, the two ways someone's
  // day can vary from the roster)
  const [volunteerOpportunities, setVolunteerOpportunities] = useState([]);
  const [loadingVolunteer, setLoadingVolunteer] = useState(false);
  const [volunteeringKey, setVolunteeringKey] = useState(null); // theatre_activity_id currently being submitted
  const [volunteerError, setVolunteerError] = useState(null);
  // A senior sees both consultant- and registrar-designated shifts (they're
  // eligible to cover either) — this toggle lets them cut the list down to
  // just the ones that actually need a consultant. Not shown to a junior
  // staff member: they only ever see registrar-designated shifts anyway
  // (see getAvailableShiftsForStaff), so hiding them would just empty the
  // list.
  const [hideRegistrarShifts, setHideRegistrarShifts] = useState(false);
  const isSeniorStaff = staffMember && staffRanks.find(r => r.rank === staffMember.rank)?.requires_supervision === false;
  // Notify Sick — enabled while this staff member has a shift under way or
  // starting within 24 hours (see sickCallShifts.js) that they haven't
  // already reported. sickShifts is every such shift; mySickReports their
  // reports for those dates, latest first.
  const [sickShifts, setSickShifts] = useState([]);
  const [mySickReports, setMySickReports] = useState([]);
  const [submittingSickReport, setSubmittingSickReport] = useState(false);
  // The Notify Sick confirm modal — which shift(s), who'll get a pop-up,
  // and the (editable) message they'll see. The message follows the ticked
  // shifts until it's been edited by hand.
  const [showSickModal, setShowSickModal] = useState(false);
  const [sickRecipients, setSickRecipients] = useState([]);
  const [loadingSickRecipients, setLoadingSickRecipients] = useState(false);
  const [sickMessage, setSickMessage] = useState('');
  const [sickMessageEdited, setSickMessageEdited] = useState(false);
  const [selectedSickShiftIds, setSelectedSickShiftIds] = useState([]);
  // Bumped when a callback/overtime is recorded, so My Variations reloads.
  const [callbacksVersion, setCallbacksVersion] = useState(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [selectedSearchResult, setSelectedSearchResult] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Export Calendar modal state — one row per upcoming week that has any
  // assignment in it, each independently checkable.
  const [showExportModal, setShowExportModal] = useState(false);
  const [loadingExportWeeks, setLoadingExportWeeks] = useState(false);
  const [exportWeeks, setExportWeeks] = useState([]); // [{ weekStart: Date, label, selected }]

  // Coffee Orders modal state
  const [showCoffeeModal, setShowCoffeeModal] = useState(false);
  const [loadingCoffeeModal, setLoadingCoffeeModal] = useState(false);
  const [coffeeModalError, setCoffeeModalError] = useState(null);
  const [coffeeModalStaff, setCoffeeModalStaff] = useState([]); // [{ staff_id, name, rank, coffee_order, sessionGroups }]
  const [coffeeCopied, setCoffeeCopied] = useState(false);
  const [coffeeChoosingHandover, setCoffeeChoosingHandover] = useState(false); // "Text order" pressed: pickup or delivery?
  // Today's people and visitors still needing a coffee order — the red count
  // on the Coffee button. coffeeAttentionPick holds the coffee chosen for
  // each one in the popup before it's added (key -> composed order).
  const [coffeeAttentionList, setCoffeeAttentionList] = useState([]);
  const [coffeeAttentionPick, setCoffeeAttentionPick] = useState({});
  // Which shift groupings to include — all on by default ("everyone working
  // today"); unchecking a box drops that session's staff from the list
  // instead of trying to guess it from the viewer's local clock.
  const [coffeeSessionFilters, setCoffeeSessionFilters] = useState({ morning: true, afternoon: false, night: false });
  // Day-scoped adjustments to the otherwise roster-computed order — who to
  // leave off, and coffees for people not on the roster at all (locums,
  // visiting surgeons). Persisted per department+date (see
  // migrations/2026-09-09_coffee_order_day_adjustments.sql) so whoever
  // opens Coffee later today sees the same adjusted list, but nothing here
  // carries over to another day.
  const [coffeeRemovedStaffIds, setCoffeeRemovedStaffIds] = useState(new Set());
  const [coffeeExtras, setCoffeeExtras] = useState([]); // [{ extra_id, coffee_type, milk_type, quantity, label }]
  const [showAddCoffeeExtra, setShowAddCoffeeExtra] = useState(false);
  const [extraFormLabel, setExtraFormLabel] = useState('');
  const [extraFormCoffeeType, setExtraFormCoffeeType] = useState(COFFEE_TYPES[1]);
  const [extraFormMilkType, setExtraFormMilkType] = useState(MILK_TYPES[0]);
  const [extraFormExtraShot, setExtraFormExtraShot] = useState(false);
  const [extraFormQuantity, setExtraFormQuantity] = useState(1);

  // Settings tab state
  const [settingsSubTab, setSettingsSubTab] = useState('profile');
  const [settingsWeekStart, setSettingsWeekStart] = useState(() => startOfWeek(new Date()));
  const [availabilityMap, setAvailabilityMap] = useState({});
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [savingAvailabilityDate, setSavingAvailabilityDate] = useState(null);
  const [activityTypes, setActivityTypes] = useState([]);
  const [loadingActivityTypes, setLoadingActivityTypes] = useState(false);
  const [savingActivityName, setSavingActivityName] = useState(null);
  const [savingProfileField, setSavingProfileField] = useState(null);

  // Load staff member info. staffId can legitimately be null here — a
  // super-admin's membership in a department they have no real `staff` row
  // in is synthesized with staff_id: null (see getMyMemberships in
  // supabaseClient.js) — so this only requires departmentId, and skips the
  // personal getStaffById lookup when there's no staffId to look up.
  useEffect(() => {
    const init = async () => {
      if (!departmentId) {
        setError('Department ID not configured');
        setLoading(false);
        return;
      }

      try {
        // phoneBookError isn't fatal to the rest of the staff view — until
        // migrations/2026-08-24_phone_book.sql has been run, the table
        // doesn't exist yet, and the Phone Book tab should just show
        // nothing rather than block loading everything else.
        const [staffRes, { data: dutyTypesData, error: dutyTypesError }, { data: phoneBookData }, { data: departmentData }, { data: staffRanksData }] = await Promise.all([
          staffId ? getStaffById(staffId) : Promise.resolve({ data: null, error: null }),
          getDutyTypes(departmentId),
          getPhoneBookEntries(departmentId),
          getDepartment(departmentId),
          getStaffRanks(departmentId),
        ]);
        if (staffRes.error) throw staffRes.error;
        if (dutyTypesError) throw dutyTypesError;
        setStaffMember(staffRes.data);
        setDutyTypes(dutyTypesData);
        setPhoneBookEntries(phoneBookData || []);
        setDepartment(departmentData || null);
        setStaffRanks(staffRanksData || []);
        setError(staffId ? null : 'You have no personal staff record in this department (likely viewing as a super-admin) — showing the department-wide roster only, nothing personal.');
      } catch (err) {
        setError(`Failed to load staff: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [staffId, departmentId]);

  // Load today's assignments. The department-wide fetches (allAssignRes,
  // dutyRes) don't need a personal staffId, so they still run for a
  // super-admin with no staff row in this department — only the personal
  // "my own allocations" fetch is skipped without one.
  useEffect(() => {
    if (activeTab !== 'day' || !departmentId) return;

    const loadDay = async () => {
      setLoadingDay(true);
      try {
        const [assignRes, allAssignRes, dutyRes, visitorRes] = await Promise.all([
          staffId ? getStaffAssignmentsForStaffDate(staffId, dayViewDate) : Promise.resolve({ data: [], error: null }),
          getStaffAssignmentsForDate(departmentId, dayViewDate),
          getDutyAssignmentsForDate(departmentId, dayViewDate),
          getVisitorAssignmentsForDate(departmentId, dayViewDate),
        ]);
        if (assignRes.error) throw assignRes.error;
        if (allAssignRes.error) throw allAssignRes.error;
        if (dutyRes.error) throw dutyRes.error;
        if (visitorRes.error) throw visitorRes.error;
        setTodayAssignments(assignRes.data);
        // Visitors (visiting surgeons, district doctors from DR Roster) are
        // listed with everyone else in "who is where".
        setTodayAllAssignments([...allAssignRes.data, ...visitorRes.data]);
        setTodayOnCall(dutyRes.data);
      } catch (err) {
        setError(`Failed to load today's assignments: ${err.message}`);
      } finally {
        setLoadingDay(false);
      }
    };

    loadDay();
  }, [activeTab, staffId, departmentId, dayViewDate]);

  // Load week's assignments
  useEffect(() => {
    if (activeTab !== 'week' || !staffId || !departmentId) return;

    const loadWeek = async () => {
      setLoadingWeek(true);
      try {
        const weekStart = getMondayOfWeek(currentDate);
        const { data, error: weekError } = await getStaffAssignmentsForWeek(staffId, weekStart);
        if (weekError) throw weekError;
        setWeekAssignments(data);
      } catch (err) {
        setError(`Failed to load week's assignments: ${err.message}`);
      } finally {
        setLoadingWeek(false);
      }
    };

    loadWeek();
  }, [activeTab, staffId, departmentId, currentDate]);

  // Load starred colleagues
  useEffect(() => {
    if (activeTab !== 'week' || !staffId) return;

    const loadStarred = async () => {
      const { data, error: starredError } = await getStarredStaff(staffId);
      if (starredError) {
        setError(`Failed to load starred colleagues: ${starredError.message}`);
        return;
      }
      setStarredStaff(data);
    };

    loadStarred();
  }, [activeTab, staffId]);

  // Reload the expanded colleague's week whenever the week navigation
  // moves — otherwise cycling forward/back left their panel stuck showing
  // whichever week was current at the moment it was expanded.
  useEffect(() => {
    if (activeTab !== 'week' || !expandedStarredId) return;

    const loadColleagueWeek = async () => {
      setLoadingColleagueWeek(true);
      try {
        const weekStart = getMondayOfWeek(currentDate);
        const { data, error: weekError } = await getStaffAssignmentsForWeek(expandedStarredId, weekStart);
        if (weekError) throw weekError;
        setColleagueWeekAssignments(data);
      } catch (err) {
        setError(`Failed to load colleague's week: ${err.message}`);
      } finally {
        setLoadingColleagueWeek(false);
      }
    };

    loadColleagueWeek();
  }, [activeTab, expandedStarredId, currentDate]);

  const handleToggleStar = async (targetStaffId) => {
    setStarringError(null);
    const existing = starredStaff.find(f => f.starred_staff_id === targetStaffId);
    try {
      if (existing) {
        const { error: unstarError } = await unstarStaffMember(existing.favorite_id);
        if (unstarError) throw unstarError;
        setStarredStaff(prev => prev.filter(f => f.favorite_id !== existing.favorite_id));
      } else {
        const { data, error: starError } = await starStaffMember(staffId, targetStaffId);
        if (starError) throw starError;
        setStarredStaff(prev => [...prev, data]);
      }
    } catch (err) {
      setStarringError(err.message);
    }
  };

  const handleToggleExpandStarred = (colleague) => {
    setExpandedStarredId(prev => prev === colleague.starred_staff_id ? null : colleague.starred_staff_id);
  };

  const loadCrossoverDays = async (colleague, weekStart) => {
    setLoadingCrossover(true);
    try {
      const [myWeekRes, colleagueWeekRes] = await Promise.all([
        getStaffAssignmentsForWeek(staffId, weekStart),
        getStaffAssignmentsForWeek(colleague.starred_staff_id, weekStart),
      ]);
      if (myWeekRes.error) throw myWeekRes.error;
      if (colleagueWeekRes.error) throw colleagueWeekRes.error;

      // "Off" means no work assignment that day — not the narrower "marked
      // themselves unavailable/on leave" (getStaffOffDays), which most staff
      // never bother to set and so understated "both off" days: a colleague
      // with a completely empty week showed no crossover days at all even
      // though every one of those days was, in the plain sense, a day off.
      const myWorkingDates = new Set(myWeekRes.data.map(a => a.date));
      const colleagueWorkingDates = new Set(colleagueWeekRes.data.map(a => a.date));

      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const dateStr = toLocalDateStr(d);
        const myWorking = myWorkingDates.has(dateStr);
        const colleagueWorking = colleagueWorkingDates.has(dateStr);
        let status = null;
        if (myWorking && colleagueWorking) status = 'working';
        else if (!myWorking && !colleagueWorking) status = 'off';
        return { dateStr, label: SETTINGS_DAY_LABELS[d.getDay()], status };
      });
      setCrossoverDays(days);
    } catch (err) {
      setError(`Failed to load crossover: ${err.message}`);
    } finally {
      setLoadingCrossover(false);
    }
  };

  const handleOpenCrossover = (colleague) => {
    const weekStart = getMondayOfWeek(currentDate);
    setCrossoverStaff(colleague);
    setCrossoverWeekStart(weekStart);
    setCrossoverDays(null);
    loadCrossoverDays(colleague, weekStart);
  };

  const handleCloseCrossover = () => {
    setCrossoverStaff(null);
    setCrossoverWeekStart(null);
    setCrossoverDays(null);
  };

  const handleCrossoverWeekNav = (deltaDays) => {
    const weekStart = new Date(crossoverWeekStart);
    weekStart.setDate(weekStart.getDate() + deltaDays);
    setCrossoverWeekStart(weekStart);
    setCrossoverDays(null);
    loadCrossoverDays(crossoverStaff, weekStart);
  };

  // Load on-call roster
  useEffect(() => {
    if (activeTab !== 'oncall' || !staffId || !departmentId) return;

    const loadOnCall = async () => {
      setLoadingOnCall(true);
      try {
        const weekStart = getMondayOfWeek(currentDate);
        const { data, error: onCallError } = await getAllOnCallAssignmentsForWeek(departmentId, weekStart);
        if (onCallError) throw onCallError;
        setAllOnCallAssignments(data);
      } catch (err) {
        setError(`Failed to load on-call roster: ${err.message}`);
      } finally {
        setLoadingOnCall(false);
      }
    };

    loadOnCall();
  }, [activeTab, staffId, departmentId, currentDate]);

  // Load unfilled shifts this staff member could volunteer for
  useEffect(() => {
    if (activeTab !== 'volunteer' || !staffId || !departmentId) return;

    const loadVolunteerOpportunities = async () => {
      setLoadingVolunteer(true);
      try {
        const { data, error: fetchError } = await getAvailableShiftsForStaff(staffId, departmentId);
        if (fetchError) throw fetchError;
        setVolunteerOpportunities(data);
        setVolunteerError(null);
      } catch (err) {
        setVolunteerError(`Failed to load available shifts: ${err.message}`);
      } finally {
        setLoadingVolunteer(false);
      }
    };

    loadVolunteerOpportunities();
  }, [activeTab, staffId, departmentId]);

  // Which shifts Notify Sick can be used for, and what's already been sent.
  useEffect(() => {
    if (activeTab !== 'volunteer' || !staffId || !departmentId) return;

    const loadSickReportState = async () => {
      const { data, error: stateError } = await getMySickCallState(staffId, new Date());
      if (stateError) {
        console.error('Failed to load sick report state:', stateError);
        return;
      }
      setSickShifts(sickCallShiftsInWindow(data.assignments, new Date()));
      setMySickReports(data.reports);
    };

    loadSickReportState();
  }, [activeTab, staffId, departmentId]);

  // A report covers its whole date, so a shift on a date that's already
  // been reported isn't offered again.
  const reportedSickDates = new Set(mySickReports.map(r => r.date));
  const unreportedSickShifts = sickShifts.filter(s => !reportedSickDates.has(s.assignment.date));
  const sickShiftDates = new Set(sickShifts.map(s => s.assignment.date));
  const shownSickReports = mySickReports.filter((r, i) =>
    sickShiftDates.has(r.date) && mySickReports.findIndex(o => o.date === r.date) === i);

  const defaultSickMessage = (shiftIds) => {
    const chosen = unreportedSickShifts.filter(s => shiftIds.includes(s.assignment.assignment_id));
    const name = staffMember?.name || 'A staff member';
    if (chosen.length === 0) return `${name} has called in sick.`;
    return `${name} has called in sick for ${chosen.length === 1 ? 'their shift' : 'their shifts'} on ${chosen.map(describeSickCallShift).join(' and ')}.`;
  };

  const toggleSickShift = (assignmentId) => {
    const next = selectedSickShiftIds.includes(assignmentId)
      ? selectedSickShiftIds.filter(id => id !== assignmentId)
      : [...selectedSickShiftIds, assignmentId];
    setSelectedSickShiftIds(next);
    if (!sickMessageEdited) setSickMessage(defaultSickMessage(next));
  };

  const handleOpenSickModal = async () => {
    if (!staffId || !departmentId || unreportedSickShifts.length === 0) return;

    // Just one shift it could be: it's chosen, and the modal asks to
    // confirm it. More than one: nothing's ticked until they choose.
    const initial = unreportedSickShifts.length === 1 ? [unreportedSickShifts[0].assignment.assignment_id] : [];
    setSelectedSickShiftIds(initial);
    setSickMessage(defaultSickMessage(initial));
    setSickMessageEdited(false);
    setSickRecipients([]);
    setShowSickModal(true);
    setLoadingSickRecipients(true);
    const { data, error: recipientsErr } = await getSickCallRecipients(departmentId, staffId, new Date());
    if (recipientsErr) setVolunteerError(`Failed to work out who to notify: ${recipientsErr.message}`);
    setSickRecipients(data);
    setLoadingSickRecipients(false);
  };

  const handleNotifySick = async () => {
    if (!staffId || !departmentId || selectedSickShiftIds.length === 0 || !sickMessage.trim()) return;
    // A second check — this emails officers and can wake whoever's on call.
    if (!window.confirm('Are you sure you want to send the sick call notification?')) return;

    setSubmittingSickReport(true);
    try {
      const message = sickMessage.trim();
      // One report per date ticked — nearly always just one.
      const dates = [...new Set(unreportedSickShifts
        .filter(s => selectedSickShiftIds.includes(s.assignment.assignment_id))
        .map(s => s.assignment.date))];
      for (const date of dates) {
        const { data, error: sickErr } = await createSickReport(departmentId, staffId, date, message);
        if (sickErr) throw sickErr;
        // Recorded before the alerts go out, so a failure there can't leave
        // the button live for a second, duplicate report.
        setMySickReports(prev => [data, ...prev]);
        setShowSickModal(false);
        const { error: alertsErr } = await createSickCallAlerts(departmentId, data.sick_report_id, sickRecipients, message);
        if (alertsErr) throw new Error(`your report was saved, but the pop-ups didn't go out (${alertsErr.message}) — contact your officer directly`);
        notifyVolunteering('sick', { sickReportId: data.sick_report_id });
      }
      setVolunteerError(null);
    } catch (err) {
      setVolunteerError(`Failed to send sick report: ${err.message}`);
    } finally {
      setSubmittingSickReport(false);
    }
  };

  const handleVolunteer = async (opportunity) => {
    if (!staffId || !departmentId) return;

    setVolunteeringKey(opportunity.theatre_activity_id);
    try {
      const { error: volunteerErr } = await createVolunteerRequest(departmentId, opportunity.theatre_activity_id, staffId, opportunity.role_needed);
      if (volunteerErr) throw volunteerErr;

      setVolunteerOpportunities(prev => prev.map(o =>
        o.theatre_activity_id === opportunity.theatre_activity_id ? { ...o, already_volunteered: true } : o
      ));
      setVolunteerError(null);
    } catch (err) {
      setVolunteerError(`Failed to send volunteer request: ${err.message}`);
    } finally {
      setVolunteeringKey(null);
    }
  };

  // Load availability for the settings tab
  useEffect(() => {
    if (activeTab !== 'settings' || !staffId || !departmentId) return;

    const loadAvailability = async () => {
      setLoadingAvailability(true);
      try {
        const results = await Promise.all(
          [0, 1, 2, 3].map(weekOffset => {
            const start = new Date(settingsWeekStart);
            start.setDate(start.getDate() + weekOffset * 7);
            return getStaffAvailability(departmentId, start);
          })
        );

        const map = {};
        results.forEach(({ data, error: fetchError }) => {
          if (fetchError) throw fetchError;
          (data || []).forEach(record => {
            if (record.staff_id === staffId) {
              map[record.date] = storedAvailabilityValue(record);
            }
          });
        });

        setAvailabilityMap(map);
        setError(null);
      } catch (err) {
        setError(`Failed to load availability: ${err.message}`);
      } finally {
        setLoadingAvailability(false);
      }
    };

    loadAvailability();
  }, [activeTab, staffId, departmentId, settingsWeekStart]);

  // Load activity types — for the Activity Restrictions sub-tab, and for
  // the Day tab's location cards (to tell apart two different activities
  // sharing the same location, and to merge cards that are really the same
  // location+activity split across more than one underlying record).
  useEffect(() => {
    const dayTabNeedsIt = activeTab === 'day' || activeTab === 'week'; // week: job-type colours
    const restrictionsTabNeedsIt = activeTab === 'settings' && settingsSubTab === 'restrictions';
    if ((!dayTabNeedsIt && !restrictionsTabNeedsIt) || !departmentId) return;

    const loadActivityTypes = async () => {
      setLoadingActivityTypes(true);
      try {
        const { data, error: fetchError } = await getActivityTypes(departmentId);
        if (fetchError) throw fetchError;
        setActivityTypes(data);
        setError(null);
      } catch (err) {
        setError(`Failed to load activities: ${err.message}`);
      } finally {
        setLoadingActivityTypes(false);
      }
    };

    loadActivityTypes();
  }, [activeTab, settingsSubTab, departmentId]);

  const handleRestrictionToggle = async (activityName, canDo) => {
    if (!staffId || !staffMember) return;
    const current = staffMember.activity_restrictions || [];
    const nextRestrictions = canDo
      ? [...current, activityName]
      : current.filter(a => a !== activityName);

    setSavingActivityName(activityName);
    try {
      const { error: updateError } = await updateMyActivityRestrictions(staffId, nextRestrictions);
      if (updateError) throw updateError;
      setStaffMember(prev => prev && { ...prev, activity_restrictions: nextRestrictions });
      setError(null);
    } catch (err) {
      setError(`Failed to update activity restrictions: ${err.message}`);
    } finally {
      setSavingActivityName(null);
    }
  };

  const handleAvailabilityDayClick = async (date) => {
    if (!staffId) return;
    const dateStr = toDateStr(date);
    const nextState = nextAvailabilityState(getAvailabilityState(availabilityMap, dateStr));
    const storedValue = stateToStoredValue(nextState);

    setSavingAvailabilityDate(dateStr);
    try {
      const { error: toggleError } = await toggleStaffAvailability(departmentId, staffId, date, storedValue);
      if (toggleError) throw toggleError;

      setAvailabilityMap(prev => {
        const next = { ...prev };
        if (storedValue === null) {
          delete next[dateStr];
        } else {
          next[dateStr] = storedValue;
        }
        return next;
      });
      setError(null);
    } catch (err) {
      setError(`Failed to update availability: ${err.message}`);
    } finally {
      setSavingAvailabilityDate(null);
    }
  };

  const handleCoffeeOrderChange = async (coffeeOrder) => {
    if (!staffId) return;
    try {
      const { error: updateError } = await updateMyCoffeeOrder(staffId, coffeeOrder);
      if (updateError) throw updateError;
      setStaffMember(prev => prev && { ...prev, coffee_order: coffeeOrder });
      loadCoffeeAttention();
      setError(null);
    } catch (err) {
      setError(`Failed to update coffee order: ${err.message}`);
    }
  };

  const handleEmailChange = async (email) => {
    if (!staffId) return;
    setSavingProfileField('email');
    try {
      const { error: updateError } = await updateMyEmail(staffId, email);
      if (updateError) throw updateError;
      setStaffMember(prev => prev && { ...prev, email });
      setError(null);
    } catch (err) {
      setError(`Failed to update email: ${err.message}`);
    } finally {
      setSavingProfileField(null);
    }
  };

  const handlePhoneChange = async (phone) => {
    if (!staffId) return;
    setSavingProfileField('phone');
    try {
      const { error: updateError } = await updateMyPhone(staffId, phone);
      if (updateError) throw updateError;
      setStaffMember(prev => prev && { ...prev, phone });
      setError(null);
    } catch (err) {
      setError(`Failed to update phone: ${err.message}`);
    } finally {
      setSavingProfileField(null);
    }
  };

  // Search staff
  const handleSearch = async () => {
    if (!searchQuery.trim() || !departmentId) return;

    try {
      const { data, error: searchError } = await searchStaff(departmentId, searchQuery);
      if (searchError) throw searchError;
      setSearchResults(data);
    } catch (err) {
      setError(`Search failed: ${err.message}`);
    }
  };

  // Opens the same staff detail popup used by search, for a name clicked
  // directly on the roster (On-Call, Morning/Afternoon/Night Allocations) —
  // fetches full details (phone, coffee order, etc.) on demand since the
  // roster queries only carry name/rank for those rows.
  const handleViewStaffDetail = async (staffIdToView) => {
    // Visitors aren't staff: there's no profile to show.
    if (!staffIdToView || String(staffIdToView).startsWith('visitor:')) return;
    try {
      const { data, error: fetchError } = await getStaffById(staffIdToView);
      if (fetchError) throw fetchError;
      setSelectedSearchResult(data);
    } catch (err) {
      setError(`Failed to load staff details: ${err.message}`);
    }
  };

  // How far ahead to look for weeks to offer in the export modal. Bounds an
  // otherwise-unbounded "every future week" query — long enough to cover any
  // realistically-published roster.
  const EXPORT_LOOKAHEAD_WEEKS = 26;

  const handleOpenExportModal = async () => {
    if (!staffId || !departmentId) return;

    setShowExportModal(true);
    setLoadingExportWeeks(true);
    setExportWeeks([]);
    try {
      const weekStart = startOfWeek(new Date());
      const lookaheadEnd = new Date(weekStart);
      lookaheadEnd.setDate(lookaheadEnd.getDate() + EXPORT_LOOKAHEAD_WEEKS * 7 - 1);

      const { data, error: fetchError } = await getStaffAssignmentDatesInRange(
        staffId,
        toDateStr(weekStart),
        toDateStr(lookaheadEnd)
      );
      if (fetchError) throw fetchError;

      const weekStartsWithData = new Map();
      (data || []).forEach(({ date }) => {
        const [y, m, d] = date.split('-').map(Number);
        const ws = startOfWeek(new Date(y, m - 1, d));
        weekStartsWithData.set(toDateStr(ws), ws);
      });

      const weeks = Array.from(weekStartsWithData.values())
        .sort((a, b) => a - b)
        .map(ws => ({ weekStart: ws, label: formatCrossoverWeekRange(ws), selected: true }));

      if (weeks.length === 0) {
        setShowExportModal(false);
        // Uses its own alert rather than the shared `error` banner, which
        // isn't rendered on every tab — Export is reachable from all of them.
        window.alert('No upcoming assignments to export.');
        return;
      }
      setExportWeeks(weeks);
    } catch (err) {
      setShowExportModal(false);
      window.alert(`Failed to load weeks: ${err.message}`);
    } finally {
      setLoadingExportWeeks(false);
    }
  };

  const allExportWeeksSelected = exportWeeks.length > 0 && exportWeeks.every(w => w.selected);

  const handleToggleAllExportWeeks = () => {
    const nextSelected = !allExportWeeksSelected;
    setExportWeeks(prev => prev.map(w => ({ ...w, selected: nextSelected })));
  };

  const handleToggleExportWeek = (weekKey) => {
    setExportWeeks(prev => prev.map(w => (toDateStr(w.weekStart) === weekKey ? { ...w, selected: !w.selected } : w)));
  };

  const handleConfirmExport = async () => {
    const selectedWeeks = exportWeeks.filter(w => w.selected).sort((a, b) => a.weekStart - b.weekStart);
    if (selectedWeeks.length === 0) return;

    setExporting(true);
    try {
      const results = await Promise.all(
        selectedWeeks.map(w => getStaffWeekScheduleForExport(staffId, departmentId, w.weekStart))
      );
      const failed = results.find(r => r.error);
      if (failed) throw failed.error;

      const allAssignments = results.flatMap(r => r.data);
      if (allAssignments.length === 0) {
        window.alert('No assignments in the selected weeks to export.');
        return;
      }

      const lastWeekEnd = new Date(selectedWeeks[selectedWeeks.length - 1].weekStart);
      lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);

      const startStr = toDateStr(selectedWeeks[0].weekStart);
      const endStr = toDateStr(lastWeekEnd);
      const icsContent = buildAssignmentsIcs(allAssignments);
      const filename = getIcsExportFilename(staffMember?.name, startStr, endStr);
      downloadTextFile(filename, 'text/calendar;charset=utf-8', icsContent);
      setShowExportModal(false);
    } catch (err) {
      window.alert(`Failed to export calendar: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  // Read on load and again whenever the coffee list changes, so the red
  // count is there before anyone opens Coffee. Coffee is ordered at 10:30,
  // so only people and visitors working the morning session need one.
  const loadCoffeeAttention = async () => {
    if (!departmentId) return;
    try {
      const [{ data: assignments, error: assignError }, { data: adjustments, error: adjError }, { data: visitors, error: visitorError }] = await Promise.all([
        getStaffAssignmentsForDate(departmentId, new Date()),
        getCoffeeOrderAdjustments(departmentId, new Date()),
        getVisitorsForDate(departmentId, new Date()),
      ]);
      const error = assignError || adjError || visitorError;
      if (error) throw error;

      const morning = (shift) => getSessionGroups(shift, sessionBoundaries).includes('morning');
      const rostered = [...new Map(assignments
        .filter(a => a.staff_id && morning(a.shifts))
        .map(a => [a.staff_id, {
          staff_id: a.staff_id, name: a.staff?.name, rank: a.staff?.rank, coffee_order: a.staff?.coffee_order,
        }])).values()];
      const visitorNames = visitors.filter(v => morning({ start_time: v.start_time, end_time: v.end_time })).map(v => v.name);
      const list = coffeeAttention({
        rostered,
        visitorNames,
        removedStaffIds: adjustments.removedStaffIds,
        extras: adjustments.extras,
      });
      setCoffeeAttentionList(list);
      return list;
    } catch (err) {
      console.error('loadCoffeeAttention error:', err);
      return [];
    }
  };

  // Also re-read once the department's session times have loaded, since the
  // morning check depends on them.
  useEffect(() => {
    loadCoffeeAttention();
  }, [departmentId, department]);

  // The 8:15 "no coffee order" push (and the coffee emails) link to
  // ?coffee=1: if anyone still needs an order, greet them with who, then on
  // to the Coffee popup; if nobody does, straight to the Coffee popup. Once only: the flag is dropped so a reload doesn't repeat it.
  const [showCoffeeGreeting, setShowCoffeeGreeting] = useState(false);
  useEffect(() => {
    if (!departmentId || !department) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('coffee') !== '1') return;
    params.delete('coffee');
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
    // Greet only if someone still needs an order; otherwise straight to Coffee.
    loadCoffeeAttention().then(list => {
      if (list?.length) setShowCoffeeGreeting(true);
      else handleOpenCoffeeModal();
    });
  }, [departmentId, department]);

  const closeCoffeeModal = () => {
    setShowCoffeeModal(false);
    loadCoffeeAttention();
  };

  // Fetched fresh on open (rather than reusing Day-tab state) so the coffee
  // run works correctly no matter which tab the button is clicked from.
  const handleOpenCoffeeModal = async () => {
    if (!departmentId) return;

    setShowCoffeeModal(true);
    setCoffeeChoosingHandover(false);
    setLoadingCoffeeModal(true);
    setCoffeeCopied(false);
    setCoffeeSessionFilters({ morning: true, afternoon: false, night: false });
    setShowAddCoffeeExtra(false);
    try {
      const [{ data, error: fetchError }, { data: adjustments, error: adjustmentsError }] = await Promise.all([
        getStaffAssignmentsForDate(departmentId, new Date()),
        getCoffeeOrderAdjustments(departmentId, new Date()),
      ]);
      if (fetchError) throw fetchError;
      if (adjustmentsError) throw adjustmentsError;
      setCoffeeRemovedStaffIds(new Set(adjustments.removedStaffIds));
      setCoffeeExtras(adjustments.extras);

      // A staff member can have more than one assignment today (e.g. a
      // morning shift in one location, afternoon in another) — union their
      // session groups across all of them rather than keeping just one, so
      // unchecking "Afternoon" doesn't also hide someone who's ALSO working
      // this morning.
      const byStaff = new Map();
      data.forEach(assignment => {
        if (!assignment.staff_id) return;
        if (!byStaff.has(assignment.staff_id)) {
          byStaff.set(assignment.staff_id, {
            staff_id: assignment.staff_id,
            name: assignment.staff?.name,
            rank: assignment.staff?.rank,
            coffee_order: assignment.staff?.coffee_order,
            sessionGroups: new Set(),
          });
        }
        getSessionGroups(assignment.shifts, sessionBoundaries).forEach(g => byStaff.get(assignment.staff_id).sessionGroups.add(g));
      });

      const list = [...byStaff.values()]
        .map(person => ({ ...person, sessionGroups: [...person.sessionGroups] }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCoffeeModalStaff(list);
      setCoffeeModalError(null);
    } catch (err) {
      setCoffeeModalError(`Failed to load coffee orders: ${err.message}`);
    } finally {
      setLoadingCoffeeModal(false);
    }
  };

  // Everyone rostered today who wants a coffee, before removals — the
  // per-person table shows all of these (with a checkbox for removing
  // them), while the summary/count/text below only counts the ones still
  // included.
  const coffeeOrdersForModal = coffeeModalStaff
    .filter(person => person.sessionGroups.some(g => coffeeSessionFilters[g]))
    .map(person => ({ ...person, ...parseCoffeeOrder(person.coffee_order) }))
    .filter(person => person.coffeeType !== NO_COFFEE);

  const coffeeOrdersIncluded = coffeeOrdersForModal.filter(person => !coffeeRemovedStaffIds.has(person.staff_id));

  // What's ordered from the café: one line per distinct coffee, with
  // extras tallied in (see summarizeCoffeeOrder). The 9:00 email uses the
  // same lines.
  const coffeeSummaryLines = summarizeCoffeeOrder(coffeeOrdersIncluded, coffeeExtras);

  const coffeeExtrasTotal = coffeeExtras.reduce((sum, extra) => sum + extra.quantity, 0);
  const totalCoffeeCount = coffeeOrdersIncluded.length + coffeeExtrasTotal;

  const handleToggleCoffeeStaffRemoved = async (targetStaffId, shouldRemove) => {
    // Optimistic — the checkbox flips immediately; a failure just puts it
    // back and surfaces the error, same as everywhere else in this modal.
    setCoffeeRemovedStaffIds(prev => {
      const next = new Set(prev);
      if (shouldRemove) next.add(targetStaffId); else next.delete(targetStaffId);
      return next;
    });
    const { error } = shouldRemove
      ? await removeCoffeeOrderStaff(departmentId, new Date(), targetStaffId, staffId)
      : await restoreCoffeeOrderStaff(departmentId, new Date(), targetStaffId);
    if (error) {
      setCoffeeRemovedStaffIds(prev => {
        const next = new Set(prev);
        if (shouldRemove) next.delete(targetStaffId); else next.add(targetStaffId);
        return next;
      });
      setCoffeeModalError(`Failed to update coffee order: ${error.message}`);
    }
  };

  const handleOpenAddCoffeeExtra = () => {
    setExtraFormLabel('');
    setExtraFormCoffeeType(COFFEE_TYPES[1]);
    setExtraFormMilkType(MILK_TYPES[0]);
    setExtraFormExtraShot(false);
    setExtraFormQuantity(1);
    setShowAddCoffeeExtra(true);
  };

  const handleExtraCoffeeTypeChange = (newType) => {
    setExtraFormCoffeeType(newType);
    if (milkIsFixedForCoffeeType(newType)) setExtraFormMilkType(NO_MILK);
    else if (!extraFormMilkType || extraFormMilkType === NO_MILK) setExtraFormMilkType(MILK_TYPES[0]);
  };

  const handleSubmitCoffeeExtra = async () => {
    const quantity = Math.max(1, Math.round(Number(extraFormQuantity)) || 1);
    const milkType = milkIsFixedForCoffeeType(extraFormCoffeeType) ? NO_MILK : extraFormMilkType;
    const { data, error } = await addCoffeeOrderExtra(departmentId, new Date(), {
      coffeeType: extraFormCoffeeType,
      milkType,
      extraShot: extraFormExtraShot,
      quantity,
      label: extraFormLabel.trim(),
      addedBy: staffId,
    });
    if (error) {
      setCoffeeModalError(`Failed to add coffee: ${error.message}`);
      return;
    }
    setCoffeeExtras(prev => [...prev, data]);
    setShowAddCoffeeExtra(false);
  };

  const handleRemoveCoffeeExtra = async (extraId) => {
    setCoffeeExtras(prev => prev.filter(extra => extra.extra_id !== extraId));
    const { error } = await removeCoffeeOrderExtra(extraId);
    if (error) setCoffeeModalError(`Failed to remove coffee: ${error.message}`);
  };

  // Adds someone from "Needs a coffee order" as a one-off coffee for today.
  // A saved profile order is only changed by its owner or an officer, so
  // this never touches the person's own coffee_order.
  const handleAddCoffeeAttention = async (item) => {
    const order = coffeeAttentionPick[item.key] ?? composeCoffeeOrder('Flat White', MILK_TYPES[0], false);
    const { coffeeType, milkType, extraShot } = parseCoffeeOrder(order);
    if (coffeeType === NO_COFFEE) {
      setCoffeeModalError(`Choose a coffee for ${item.name} first`);
      return;
    }
    const { data, error } = await addCoffeeOrderExtra(departmentId, new Date(), {
      coffeeType,
      milkType,
      extraShot,
      quantity: 1,
      label: item.name,
      addedBy: staffId,
    });
    if (error) {
      setCoffeeModalError(`Failed to add coffee: ${error.message}`);
      return;
    }
    setCoffeeExtras(prev => [...prev, data]);
    setCoffeeAttentionList(prev => prev.filter(x => x.key !== item.key));
  };

  // The text to the café, for picking the order up or having it delivered.
  const COFFEE_HANDOVER_LINE = {
    pickup: "I can pick it up at 10:25, but let me know if delivery is easier!",
    delivery: "If you can deliver it to the hospital today at 10:30 that'd be awesome. If not, let me know.",
  };
  const coffeeOrderMessage = (handover) => [
    'Good morning, the order for the hospital coffees is:',
    '',
    ...coffeeSummaryLines,
    '',
    COFFEE_HANDOVER_LINE[handover],
    '',
    'Thanks!',
    'Have a good day',
  ].join('\n');

  // iOS Safari and Android disagree on the separator between an sms: URI's
  // number and its query string (& vs ?) — there's no single syntax both
  // accept.
  const coffeePlaceSmsHref = department?.coffee_place_phone
    ? (handover) => `sms:${encodeURIComponent(department.coffee_place_phone)}${isIOS() ? '&' : '?'}body=${encodeURIComponent(coffeeOrderMessage(handover))}`
    : null;

  const handleCopyCoffeeOrders = async () => {
    const lines = coffeeOrdersIncluded.map(person =>
      `${person.name} (${person.rank}): ${person.coffeeType} - ${person.milkType}${person.extraShot ? ' + Xtra Shot' : ''}`
    );
    const extraLines = coffeeExtras.map(extra =>
      `${extra.label || 'Extra'} x${extra.quantity}: ${extra.coffee_type}${extra.milk_type && extra.milk_type !== NO_MILK ? ` - ${extra.milk_type}` : ''}${extra.extra_shot ? ' + Xtra Shot' : ''}`
    );
    const text = [`Coffee orders for ${formatDate(new Date())}`, '', ...lines, ...extraLines, '', `${totalCoffeeCount} coffee${totalCoffeeCount === 1 ? '' : 's'} to order`].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCoffeeCopied(true);
      setTimeout(() => setCoffeeCopied(false), 2000);
    } catch (err) {
      window.alert('Failed to copy to clipboard.');
    }
  };

  const formatDate = (date) => date.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const formatDateShort = (date) => date.toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' });

  // ============================================================
  // RENDER CONTENT
  // ============================================================

  // Today's on-call, plus — when nobody's in the ED on-call slot — the
  // consultant on the ED late, who's on call instead (display only, see
  // edLateOnCall.js).
  const todayEdLate = edLateOnCallFor(todayAllAssignments, todayOnCallRows.map(d => d.duty_type), dutyTypes);
  const todayOnCall = todayEdLate
    ? [...todayOnCallRows, { duty_type: todayEdLate.dutyKey, staff_id: todayEdLate.staffId, staff: { name: todayEdLate.staffName }, derived: true }]
    : todayOnCallRows;

  // An assignment's activity name, for its job-type colour (jobColours.js).
  const activityNameFor = (assignment) => activityTypes.find(a => a.activity_id === assignment.theatre_activities?.activity_id)?.name;

  const renderContent = () => {
    if (activeTab === 'day') {
      // Morning/Afternoon/Night group the WHOLE department's assignments (not
      // just this staff member's own) so staff can look up who's rostered
      // where — "Allocations" above is the personal-only view.
      const groupedAssignments = { morning: [], afternoon: [], night: [] };
      todayAllAssignments.forEach(assignment => {
        getSessionGroups(assignment.shifts, sessionBoundaries).forEach(group => groupedAssignments[group].push(assignment));
      });

      return (
        <div className="p-4 pb-24">
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{formatDate(dayViewDate)}</h1>
                <p className="text-sm text-gray-500">Your roster</p>
                <input
                  type="date"
                  value={toLocalDateStr(dayViewDate)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setDayViewDate(new Date(`${e.target.value}T00:00:00`));
                  }}
                  className="mt-1 px-2 py-0.5 border border-gray-200 rounded text-xs text-gray-600"
                />
                {error && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                    <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setDayViewDate(new Date(dayViewDate.getTime() - 24 * 60 * 60 * 1000))}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <ChevronLeft size={24} />
                </button>
                <button
                  onClick={() => setDayViewDate(new Date(dayViewDate.getTime() + 24 * 60 * 60 * 1000))}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <ChevronRight size={24} />
                </button>
              </div>
            </div>

            {loadingDay ? (
              <div className="text-center py-8">
                <Loader size={32} className="text-blue-600 animate-spin mx-auto mb-2" />
                <p className="text-gray-600 text-sm">Loading assignments...</p>
              </div>
            ) : (
              <>
                {/* On-Call */}
                <div className="bg-white rounded-lg shadow-xl p-6 mb-6">
                  <h2 className="font-bold mb-3" style={{ fontFamily: "'Comic Neue', cursive", color: '#f97316', fontSize: '1.75rem' }}>On-Call</h2>
                  {todayOnCall.length === 0 ? (
                    <p className="text-sm text-gray-500">No on-call roster set for this date.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {dutyTypes.map(dutyType => {
                        const duty = todayOnCall.find(d => d.duty_type === dutyType.key);
                        const isYou = duty?.staff_id === staffId;
                        return (
                          <div key={dutyType.duty_type_id} className={`p-3 rounded-lg border ${isYou ? 'bg-blue-50 border-blue-300' : 'border-gray-200'}`}>
                            <p className="text-xs font-semibold text-gray-600 uppercase mb-1">{dutyType.label}</p>
                            <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                              {duty?.staff?.name ? (
                                <button onClick={() => handleViewStaffDetail(duty.staff_id)} className="hover:underline hover:text-blue-700">
                                  {duty.staff.name}
                                </button>
                              ) : 'Unassigned'}
                              {duty?.derived && <span className="text-xs font-normal text-gray-500">(on the ED late)</span>}
                              {isYou && <span className="px-2 py-0.5 bg-blue-600 text-white text-xs font-semibold rounded-full">You</span>}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* My allocations for today — a flat, ungrouped summary of
                    every assignment this staff member has on this date,
                    shown above the Morning/Afternoon/Night breakdown for a
                    quick glance. The shift itself isn't shown — its
                    Morning/Afternoon/Night session(s) on the right already
                    say when it is. Click one to see who else is rostered
                    at that SAME location for that session (looked up from
                    groupedAssignments, the same department-wide data the
                    sections below use, narrowed to this assignment's own
                    location_id). */}
                <div className="bg-white rounded-lg shadow-xl p-6 mb-6">
                  <h2 className="font-bold mb-3" style={{ fontFamily: "'Comic Neue', cursive", color: '#f97316', fontSize: '1.75rem' }}>My allocations for today</h2>
                  {todayAssignments.length === 0 ? (
                    <p className="text-sm text-gray-500">No assignments for this date.</p>
                  ) : (
                    <div className="space-y-3">
                      {todayAssignments.map(assignment => {
                        const isExpanded = expandedAllocationId === assignment.assignment_id;
                        const sessions = getSessionGroups(assignment.shifts, sessionBoundaries);
                        const colleagues = isExpanded
                          ? Array.from(
                              new Map(
                                sessions
                                  .flatMap(g => groupedAssignments[g])
                                  .filter(a =>
                                    a.staff_id !== staffId
                                    && a.location_id === assignment.location_id
                                    && a.theatre_activities?.activity_id === assignment.theatre_activities?.activity_id
                                  )
                                  .map(a => [a.staff_id, a])
                              ).values()
                            ).sort((a, b) => (a.shifts?.start_time || '').localeCompare(b.shifts?.start_time || ''))
                          : [];

                        return (
                          <div
                            key={assignment.assignment_id}
                            style={jobCardStyle(jobCategoryFor(assignment.locations?.name, activityNameFor(assignment)))}
                            className="rounded-lg border border-l-4 overflow-hidden"
                          >
                            <button
                              onClick={() => setExpandedAllocationId(isExpanded ? null : assignment.assignment_id)}
                              className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-black/5 transition"
                            >
                              <div>
                                <p className="text-sm font-bold text-gray-900">{assignment.locations?.name}</p>
                                <p className="text-xs text-gray-600 capitalize">{assignment.role}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <div className="flex gap-1">
                                  {sessions.map(g => (
                                    <span key={g} className="px-2 py-0.5 bg-orange-100 text-orange-800 text-xs font-semibold rounded-full">
                                      {SESSION_GROUP_LABELS[g].replace(' Allocations', '')}
                                    </span>
                                  ))}
                                </div>
                                {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                              </div>
                            </button>
                            {isExpanded && (
                              <div className="px-3 pb-3 pt-2 border-t border-gray-100 bg-gray-50">
                                <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Also at this location this session</p>
                                {colleagues.length === 0 ? (
                                  <p className="text-xs text-gray-500">Nobody else rostered here this session.</p>
                                ) : (
                                  <div className="space-y-1">
                                    {colleagues.map(c => (
                                      <div key={c.staff_id} className="flex items-center justify-between gap-2">
                                        <button onClick={() => handleViewStaffDetail(c.staff_id)} className="text-sm font-medium text-gray-800 hover:underline hover:text-blue-700">
                                          {c.staff?.name}
                                        </button>
                                        <span className="text-xs text-gray-500">{c.visitor ? visitorLabel(c) : RANK_LABEL[c.staff?.rank] || c.staff?.rank}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {SESSION_GROUP_ORDER.map(groupKey => {
                  // One card per location+activity (not per assignment, and
                  // not per underlying card) — a location can have more
                  // than one activity going at once, and the same
                  // location+activity can be split across more than one
                  // theatre_activities record within a session (e.g. a
                  // long shift's cascade onto a sibling card), so grouping
                  // by location alone either mixed unrelated activities
                  // together or showed the same activity twice. Everyone
                  // on ANY card matching that location+activity within
                  // this session is merged into the one entry.
                  //
                  // One row per staff_id within that entry, not one row per
                  // assignment — the same person can genuinely have more
                  // than one staff_assignments row here (one per
                  // duplicate/sibling card), which used to list them twice
                  // even though it's one person doing one thing. Where a
                  // person has more than one such row, the earliest-starting
                  // one is kept, consistent with the earliest-first sort
                  // below.
                  const byLocationActivity = [];
                  const byLocationActivityIndex = new Map();
                  groupedAssignments[groupKey].forEach(assignment => {
                    const locationId = assignment.location_id;
                    const activityId = assignment.theatre_activities?.activity_id || null;
                    const key = `${locationId}|${activityId}`;
                    if (!byLocationActivityIndex.has(key)) {
                      byLocationActivityIndex.set(key, byLocationActivity.length);
                      const activity = activityTypes.find(a => a.activity_id === activityId);
                      byLocationActivity.push({
                        key,
                        locationId,
                        locationName: assignment.locations?.name,
                        jobCategory: jobCategoryFor(assignment.locations?.name, activity?.name),
                        activityLabel: activity ? (activity.abbreviation ? `${activity.name} (${activity.abbreviation})` : activity.name) : null,
                        assignmentsByStaff: new Map(),
                      });
                    }
                    const bucket = byLocationActivity[byLocationActivityIndex.get(key)];
                    const existing = bucket.assignmentsByStaff.get(assignment.staff_id);
                    if (!existing || (assignment.shifts?.start_time || '') < (existing.shifts?.start_time || '')) {
                      bucket.assignmentsByStaff.set(assignment.staff_id, assignment);
                    }
                  });
                  // Earliest shift first within each card, for a quick
                  // read of who's arriving when.
                  byLocationActivity.forEach(loc => {
                    loc.assignments = Array.from(loc.assignmentsByStaff.values())
                      .sort((a, b) => (a.shifts?.start_time || '').localeCompare(b.shifts?.start_time || ''));
                  });

                  return (
                    <CollapsibleSection key={groupKey} title={SESSION_GROUP_LABELS[groupKey]}>
                      {byLocationActivity.length === 0 ? (
                        <p className="text-sm text-gray-500">No assignments.</p>
                      ) : (
                        <div className="space-y-4">
                          {byLocationActivity.map(({ key, locationName, jobCategory, activityLabel, assignments }) => {
                            const cardHasYou = assignments.some(a => a.staff_id === staffId);
                            // Card and name-box colours match the Excel
                            // roster's job colours (jobColours.js); your own
                            // card gets a ring instead of turning blue.
                            return (
                              <div key={key} style={jobCardStyle(jobCategory)} className={`border-l-4 rounded-lg p-4 ${cardHasYou ? 'ring-2 ring-blue-500' : ''}`}>
                                <h3 className="text-lg font-bold text-gray-900 mb-2">
                                  {locationName}{activityLabel && <span className="text-sm font-medium text-gray-500"> — {activityLabel}</span>}
                                </h3>
                                <div className="space-y-2">
                                  {assignments.map(assignment => {
                                    const isYou = assignment.staff_id === staffId;
                                    const onCall = assignment.on_call || holdsOnCallDuty(
                                      todayOnCall.filter(d => d.staff_id === assignment.staff_id).map(d => d.duty_type),
                                      dutyTypes
                                    );
                                    const boxStyle = jobBoxStyle(jobCategory, onCall, 4);
                                    return (
                                      <div key={assignment.assignment_id} style={boxStyle} className={`flex items-center justify-between gap-2 p-2 rounded ${isYou ? 'ring-2 ring-blue-600' : ''}`}>
                                        <div>
                                          <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                            <button onClick={() => handleViewStaffDetail(assignment.staff_id)} className="hover:underline hover:text-blue-700">
                                              {assignment.staff?.name}
                                            </button>
                                            {isYou && <span className="px-2 py-0.5 bg-blue-600 text-white text-xs font-semibold rounded-full">You</span>}
                                          </p>
                                          <p className="text-xs text-gray-600">
                                            {assignment.visitor ? 'Visitor' : assignment.shifts?.name} ({assignment.shifts?.start_time?.slice(0, 5)} - {assignment.shifts?.end_time?.slice(0, 5)})
                                          </p>
                                        </div>
                                        <p className="text-xs font-medium text-gray-600">{assignment.visitor ? visitorLabel(assignment) : RANK_LABEL[assignment.staff?.rank] || assignment.role}</p>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CollapsibleSection>
                  );
                })}
              </>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'week') {
      const weekStart = getMondayOfWeek(currentDate);

      return (
        <div className="p-4 pb-24">
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Week of {formatDateShort(weekStart)}</h1>
                <p className="text-sm text-gray-500">Your roster for this week</p>
                <input
                  type="date"
                  value={toLocalDateStr(currentDate)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setCurrentDate(new Date(`${e.target.value}T00:00:00`));
                  }}
                  title="Jumps to that date's week"
                  className="mt-1 px-2 py-0.5 border border-gray-200 rounded text-xs text-gray-600"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentDate(new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000))}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <ChevronLeft size={24} />
                </button>
                <button
                  onClick={() => setCurrentDate(new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000))}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <ChevronRight size={24} />
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-6 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {starredStaff.length === 0 && !error && (
              <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
                <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Starred Colleagues</p>
                <p className="text-sm text-gray-500">
                  Search for a colleague on the Day tab and tap the star next to their name to pin them here.
                </p>
              </div>
            )}

            {starredStaff.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
                <p className="text-xs font-semibold text-gray-600 uppercase mb-3">Starred Colleagues</p>
                {starringError && (
                  <p className="text-xs text-red-700 mb-3">{starringError}</p>
                )}
                <div className="space-y-2">
                  {starredStaff.map(colleague => (
                    <div key={colleague.favorite_id} className="border border-gray-200 rounded-lg">
                      <div className="flex items-center justify-between gap-2 p-3">
                        <button
                          onClick={() => handleToggleExpandStarred(colleague)}
                          className="flex-1 text-left flex items-center gap-2 min-w-0"
                        >
                          <ChevronDown
                            size={16}
                            className={`text-gray-400 transition-transform flex-shrink-0 ${expandedStarredId === colleague.starred_staff_id ? 'rotate-180' : ''}`}
                          />
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); handleViewStaffDetail(colleague.starred_staff_id); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleViewStaffDetail(colleague.starred_staff_id); } }}
                            className="font-medium text-gray-900 hover:underline hover:text-blue-700 truncate"
                          >
                            {colleague.staff?.name}
                          </span>
                        </button>
                        <button
                          onClick={() => handleToggleStar(colleague.starred_staff_id)}
                          title="Remove from starred"
                          className="p-1 hover:bg-yellow-50 rounded-lg flex-shrink-0"
                        >
                          <Star size={18} className="fill-yellow-400 text-yellow-500" />
                        </button>
                        <button
                          onClick={() => handleOpenCrossover(colleague)}
                          title="Compare this week"
                          className="flex items-center gap-1 px-2 py-1 bg-purple-100 hover:bg-purple-200 text-purple-900 text-xs font-medium rounded-lg transition flex-shrink-0"
                        >
                          <Shuffle size={14} /> Crossover
                        </button>
                      </div>

                      {expandedStarredId === colleague.starred_staff_id && (
                        <div className="border-t border-gray-100 p-3">
                          {loadingColleagueWeek ? (
                            <div className="text-center py-4">
                              <Loader size={20} className="text-blue-600 animate-spin mx-auto" />
                            </div>
                          ) : colleagueWeekAssignments.length === 0 ? (
                            <p className="text-xs text-gray-500">No assignments this week</p>
                          ) : (
                            <div className="space-y-2">
                              {(() => {
                                const byDate = new Map();
                                dedupeAssignmentsByShift(colleagueWeekAssignments).forEach((assignment) => {
                                  if (!byDate.has(assignment.date)) byDate.set(assignment.date, []);
                                  byDate.get(assignment.date).push(assignment);
                                });
                                return Array.from(byDate.entries()).map(([date, assignments]) => (
                                  <div key={date}>
                                    <p className="text-xs font-semibold text-gray-600 uppercase">
                                      {new Date(date).toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })}
                                    </p>
                                    {assignments.map((assignment) => (
                                      <p key={assignment.assignment_id} className="text-sm text-gray-700">
                                        {assignment.locations?.name} — {assignment.shifts?.name} ({assignment.shifts?.start_time?.slice(0, 5)}-{assignment.shifts?.end_time?.slice(0, 5)})
                                      </p>
                                    ))}
                                  </div>
                                ));
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loadingWeek ? (
              <div className="text-center py-8">
                <Loader size={32} className="text-blue-600 animate-spin mx-auto mb-2" />
                <p className="text-gray-600 text-sm">Loading week's assignments...</p>
              </div>
            ) : weekAssignments.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm p-6 text-center">
                <p className="text-gray-600">No assignments for this week</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* One card per date (Date/Day shown once), not one per
                    assignment row — someone in a Morning and an Afternoon
                    activity the same day reads as one card with both
                    listed underneath, an expanded version of the same
                    one-line-per-day idea as the officer Fortnight view. */}
                {(() => {
                  const byDate = new Map();
                  dedupeAssignmentsByShift(weekAssignments).forEach((assignment) => {
                    if (!byDate.has(assignment.date)) byDate.set(assignment.date, []);
                    byDate.get(assignment.date).push(assignment);
                  });

                  return Array.from(byDate.entries()).map(([date, assignments]) => (
                    <div key={date} className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-green-500">
                      <p className="text-xs font-semibold text-gray-600 uppercase mb-3">
                        {new Date(date).toLocaleDateString('en-AU', { weekday: 'long', month: 'short', day: 'numeric' })}
                      </p>
                      <div className="space-y-3">
                        {assignments.map((assignment) => (
                          <div
                            key={assignment.assignment_id}
                            style={jobCardStyle(jobCategoryFor(assignment.locations?.name, activityNameFor(assignment)))}
                            className="p-3 rounded-lg border border-l-4"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="text-base font-bold text-gray-900">{assignment.locations?.name}</h3>
                              <p className="text-xs font-medium text-gray-600 capitalize flex-shrink-0">{assignment.role}</p>
                            </div>
                            <p className="text-sm text-gray-600">
                              {assignment.shifts?.name} ({assignment.shifts?.start_time?.slice(0, 5)} - {assignment.shifts?.end_time?.slice(0, 5)})
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'oncall') {
      const weekStart = getMondayOfWeek(currentDate);

      // Group by duty type
      const groupedByDuty = {};
      allOnCallAssignments.forEach((assignment) => {
        if (!groupedByDuty[assignment.duty_type]) {
          groupedByDuty[assignment.duty_type] = [];
        }
        groupedByDuty[assignment.duty_type].push(assignment);
      });

      return (
        <div className="p-4 pb-24">
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Phone Book</h1>
                <p className="text-sm text-gray-500">On-call roster — week of {formatDateShort(weekStart)}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentDate(new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000))}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <ChevronLeft size={24} />
                </button>
                <button
                  onClick={() => setCurrentDate(new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000))}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <ChevronRight size={24} />
                </button>
              </div>
            </div>

            {loadingOnCall ? (
              <div className="text-center py-8">
                <Loader size={32} className="text-blue-600 animate-spin mx-auto mb-2" />
                <p className="text-gray-600 text-sm">Loading on-call roster...</p>
              </div>
            ) : (
              <div className="space-y-6">
                {dutyTypes.map((dutyType) =>
                  groupedByDuty[dutyType.key] ? (
                    <CollapsibleSection key={dutyType.duty_type_id} title={dutyType.label}>
                      <div className="space-y-3">
                        {groupedByDuty[dutyType.key].map((assignment) => (
                          <div
                            key={assignment.duty_id}
                            className={`p-4 border-l-4 rounded ${
                              assignment.staff_id === staffId
                                ? 'bg-blue-50 border-blue-500'
                                : 'bg-gray-50 border-gray-300'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-xs font-semibold text-gray-600 uppercase mb-1">
                                  {new Date(assignment.date).toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })}
                                </p>
                                <button onClick={() => handleViewStaffDetail(assignment.staff_id)} className="text-sm font-bold text-gray-900 hover:underline hover:text-blue-700">
                                  {assignment.staff?.name}
                                </button>
                                {assignment.staff?.phone && (
                                  <p className="text-xs text-gray-600 font-mono">{assignment.staff.phone}</p>
                                )}
                              </div>
                              {assignment.staff_id === staffId && (
                                <div className="px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded">
                                  You
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CollapsibleSection>
                  ) : null
                )}

                {phoneBookEntries.length > 0 && (
                  <CollapsibleSection title="Phone Book" defaultOpen>
                    <div className="space-y-2">
                      {phoneBookEntries.map(entry => (
                        <a
                          key={entry.phone_book_entry_id}
                          href={`tel:${entry.phone}`}
                          className="block p-4 bg-teal-50 hover:bg-teal-100 border-l-4 border-teal-500 rounded transition"
                        >
                          <p className="text-xs font-semibold text-gray-600 uppercase mb-1">{entry.label}</p>
                          <p className="text-sm font-mono font-bold text-teal-700 underline">{entry.phone}</p>
                        </a>
                      ))}
                    </div>
                  </CollapsibleSection>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'volunteer') {
      const visibleOpportunities = hideRegistrarShifts
        ? volunteerOpportunities.filter(o => o.role_needed !== 'registrar')
        : volunteerOpportunities;

      return (
        <div className="p-4 pb-24">
          <div className="max-w-2xl mx-auto">
            {/* Order: Variations (Callback per on-call slot / Overtime
                buttons — only while on call or near the end of a rostered
                shift), My Variations, Notify Sick, then Available Shifts. */}
            <CallbackBanner
              staffId={staffId}
              departmentId={departmentId}
              staffName={staffMember?.name}
              dutyTypes={dutyTypes}
              onRecorded={() => setCallbacksVersion(v => v + 1)}
            />
            <CollapsibleSection title="My Variations">
              <MyCallbacks staffId={staffId} dutyTypes={dutyTypes} refreshKey={callbacksVersion} />
            </CollapsibleSection>

            {/* Shared error box for Notify Sick and Volunteer below */}
            {volunteerError && (
              <div className="mb-6 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{volunteerError}</p>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h2 className="text-lg font-bold text-gray-900 mb-1">Notify Sick</h2>
              <p className="text-sm text-gray-500 mb-4">
                {sickShifts.length > 0
                  ? "Let your officer know you can't make a shift in the next 24 hours."
                  : "You don't have a shift in the next 24 hours."}
              </p>
              {shownSickReports.map(report => (
                <p key={report.sick_report_id} className={`text-sm font-medium text-center py-2 px-2 rounded-lg mb-2 ${
                  report.status === 'approved' ? 'bg-green-50 text-green-800'
                  : report.status === 'denied' ? 'bg-red-50 text-red-800'
                  : 'bg-orange-50 text-orange-800'
                }`}>
                  {new Date(`${report.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}:{' '}
                  {report.status === 'approved' && 'Approved by your officer.'}
                  {report.status === 'denied' && 'Your officer denied this report — get in touch with them directly.'}
                  {report.status === 'pending' && "Sent — your officers have been emailed and whoever's on call notified. Waiting on your officer's approval."}
                </p>
              ))}
              {(unreportedSickShifts.length > 0 || shownSickReports.length === 0) && (
                <button
                  onClick={handleOpenSickModal}
                  disabled={unreportedSickShifts.length === 0}
                  className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg transition"
                >
                  Notify Sick
                </button>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Available Shifts</h1>
              <p className="text-sm text-gray-500">Shifts your officers have opened up for volunteering</p>
              {isSeniorStaff && (
                <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hideRegistrarShifts}
                    onChange={(e) => setHideRegistrarShifts(e.target.checked)}
                  />
                  Hide registrar shifts
                </label>
              )}
            </div>

            {loadingVolunteer ? (
              <div className="text-center py-8">
                <Loader size={32} className="text-blue-600 animate-spin mx-auto mb-2" />
                <p className="text-gray-600 text-sm">Loading available shifts...</p>
              </div>
            ) : visibleOpportunities.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm p-6 text-center">
                <p className="text-gray-600">
                  {volunteerOpportunities.length === 0
                    ? 'No shifts have been opened up for volunteering right now.'
                    : 'No shifts to show — try unchecking "Hide registrar shifts".'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {visibleOpportunities.map(opportunity => (
                  <div key={`${opportunity.theatre_activity_id}-${opportunity.role_needed}`} className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-purple-500">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-600 uppercase">Date</p>
                        <p className="text-sm font-medium text-gray-900">
                          {new Date(`${opportunity.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                      <div className="px-3 py-1 bg-purple-100 text-purple-900 text-xs font-semibold rounded uppercase">
                        {opportunity.required_grade ? GRADE_LABEL[opportunity.required_grade] : opportunity.role_needed} needed
                      </div>
                    </div>

                    <h3 className="text-lg font-bold text-gray-900 mb-1">{opportunity.location}</h3>
                    {opportunity.activity && <p className="text-sm text-gray-700 mb-1">{opportunity.activity}</p>}
                    {opportunity.shift && (
                      <p className="text-sm text-gray-500 mb-4">
                        {opportunity.shift} ({opportunity.shift_start?.slice(0, 5)} - {opportunity.shift_end?.slice(0, 5)})
                      </p>
                    )}

                    {opportunity.already_volunteered ? (
                      <button disabled className="w-full bg-gray-100 text-gray-500 font-medium py-2 rounded-lg cursor-default">
                        Request Sent
                      </button>
                    ) : (
                      <button
                        onClick={() => handleVolunteer(opportunity)}
                        disabled={volunteeringKey === opportunity.theatre_activity_id}
                        className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition"
                      >
                        {volunteeringKey === opportunity.theatre_activity_id ? 'Sending…' : 'Volunteer'}
                      </button>
                    )}
                    {opportunity.already_volunteered && (
                      <p className="text-xs text-gray-500 text-center mt-2">
                        Your volunteer request has been sent to officers for approval.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {showSickModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto">
                  <div className="flex justify-between items-start mb-4">
                    <h2 className="text-xl font-bold text-gray-900">Notify Sick</h2>
                    <button onClick={() => setShowSickModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                      <X size={20} />
                    </button>
                  </div>

                  {unreportedSickShifts.length === 1 ? (
                    <p className="text-sm font-medium text-gray-900 mb-4">
                      Are you calling in sick for your shift on {describeSickCallShift(unreportedSickShifts[0])}?
                    </p>
                  ) : (
                    <div className="mb-4">
                      <p className="text-sm font-medium text-gray-900 mb-2">Which shift are you calling in sick for? Tick each one.</p>
                      <div className="space-y-2">
                        {unreportedSickShifts.map(s => (
                          <label key={s.assignment.assignment_id} className="flex items-start gap-2 p-2 border border-gray-200 rounded-lg text-sm text-gray-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedSickShiftIds.includes(s.assignment.assignment_id)}
                              onChange={() => toggleSickShift(s.assignment.assignment_id)}
                              className="mt-0.5 h-4 w-4"
                            />
                            <span>{describeSickCallShift(s)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Message</label>
                  <textarea
                    value={sickMessage}
                    onChange={(e) => { setSickMessage(e.target.value); setSickMessageEdited(true); }}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
                  />

                  <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Will pop up for</p>
                  {loadingSickRecipients ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                      <Loader size={16} className="animate-spin" /> Working out who's on…
                    </div>
                  ) : sickRecipients.length === 0 ? (
                    <p className="text-sm text-gray-500 italic mb-4">Nobody found — contact your officer directly.</p>
                  ) : (
                    <ul className="text-sm text-gray-800 space-y-1 mb-4">
                      {sickRecipients.map(r => (
                        <li key={r.staff_id}>
                          <span className="font-medium">{r.name}</span>
                          <span className="text-gray-500"> — {r.reasons.map(reason => SICK_CALL_REASON_LABEL[reason]).join(', ')}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowSickModal(false)}
                      className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-lg transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleNotifySick}
                      disabled={submittingSickReport || loadingSickRecipients || selectedSickShiftIds.length === 0 || !sickMessage.trim()}
                      className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg transition"
                    >
                      {submittingSickReport ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'settings') {
      const SETTINGS_SUB_TABS = [
        { key: 'profile', label: 'Profile' },
        { key: 'restrictions', label: 'Activity Restrictions' },
        { key: 'coffee', label: 'Coffee Preferences' },
        { key: 'availability', label: 'Availability' },
        { key: 'notifications', label: 'Notifications' },
        { key: 'security', label: 'Security' },
        { key: 'walkthrough', label: 'Walkthrough' },
      ];

      const settingsDays = [];
      for (let i = 0; i < SETTINGS_DAYS_SHOWN; i++) {
        const d = new Date(settingsWeekStart);
        d.setDate(d.getDate() + i);
        settingsDays.push(d);
      }

      const availableDaysCount = settingsDays.filter(d => getAvailabilityState(availabilityMap, toDateStr(d)) === 'available').length;
      const compliance = computeAvailabilityCompliance(availableDaysCount, settingsDays.length, staffMember?.fte);
      const complianceStyle = COMPLIANCE_STYLES[compliance.status];
      const restrictions = staffMember?.activity_restrictions || [];

      return (
        <div className="p-4 pb-24">
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                  <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <div className="flex gap-1 mt-4 border-b border-gray-200 -mx-6 px-6 overflow-x-auto">
                {SETTINGS_SUB_TABS.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setSettingsSubTab(tab.key)}
                    className={`px-3 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition ${
                      settingsSubTab === tab.key
                        ? 'text-blue-600 border-blue-600'
                        : 'text-gray-500 border-transparent hover:text-gray-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {settingsSubTab === 'profile' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <dl className="divide-y divide-gray-100">
                  {[
                    ['Name', staffMember?.name],
                    ['Rank', staffMember?.rank],
                    ['FTE', staffMember?.fte],
                  ].map(([label, value]) => (
                    <div key={label} className="py-3 flex justify-between gap-4">
                      <dt className="text-sm text-gray-500">{label}</dt>
                      <dd className="text-sm font-semibold text-gray-900 capitalize text-right">
                        {value || <span className="text-gray-400 italic normal-case">Not set</span>}
                      </dd>
                    </div>
                  ))}
                  <div className="py-3 flex justify-between items-center gap-4">
                    <dt className="text-sm text-gray-500 flex-shrink-0">Email</dt>
                    <dd className="text-sm font-semibold text-gray-900 w-48">
                      <EditableCell
                        value={staffMember?.email}
                        placeholder="Add email…"
                        disabled={savingProfileField === 'email'}
                        onSave={handleEmailChange}
                      />
                    </dd>
                  </div>
                  <div className="py-3 flex justify-between items-center gap-4">
                    <dt className="text-sm text-gray-500 flex-shrink-0">Phone</dt>
                    <dd className="text-sm font-semibold text-gray-900 w-48">
                      <EditableCell
                        value={staffMember?.phone}
                        placeholder="Add phone…"
                        disabled={savingProfileField === 'phone'}
                        onSave={handlePhoneChange}
                      />
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {settingsSubTab === 'restrictions' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <p className="text-xs text-gray-600 mb-4">Check any activities you can't do.</p>
                {loadingActivityTypes ? (
                  <div className="text-center py-8">
                    <Loader size={24} className="text-blue-600 animate-spin mx-auto mb-2" />
                    <p className="text-gray-600 text-sm">Loading activities...</p>
                  </div>
                ) : activityTypes.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4">No activities configured for this department.</p>
                ) : (
                  <div className="space-y-1">
                    {activityTypes.map(activity => {
                      const cantDo = restrictions.includes(activity.name);
                      const saving = savingActivityName === activity.name;
                      return (
                        <label
                          key={activity.activity_id}
                          className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={cantDo}
                            disabled={saving}
                            onChange={(e) => handleRestrictionToggle(activity.name, e.target.checked)}
                            className="w-5 h-5 cursor-pointer accent-blue-600 disabled:opacity-50"
                          />
                          <span className="text-sm text-gray-900">I can't do {activity.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {settingsSubTab === 'coffee' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <p className="text-sm font-semibold text-gray-700 mb-3">Your Coffee Order</p>
                <CoffeePicker
                  value={staffMember?.coffee_order}
                  onSave={handleCoffeeOrderChange}
                />
              </div>
            )}

            {settingsSubTab === 'notifications' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                {staffId
                  ? <NotificationSettings staffId={staffId} departmentId={departmentId} email={staffMember?.email} />
                  : <p className="text-sm text-gray-600">Notifications need a staff record linked to your login.</p>}
              </div>
            )}

            {settingsSubTab === 'security' && (
              <div className="space-y-6">
                <ChangePassword />
                <TwoFactorSettings />
              </div>
            )}

            {settingsSubTab === 'availability' && (
              <>
                {!loadingAvailability && (compliance.status === 'red' || compliance.status === 'orange') && (
                  <div className={`mb-6 p-4 rounded-lg border ${complianceStyle.bg} ${complianceStyle.border}`}>
                    <div className="flex gap-2 items-start">
                      <AlertCircle size={18} className={`${complianceStyle.text} flex-shrink-0 mt-0.5`} />
                      <p className={`text-sm font-medium ${complianceStyle.text}`}>
                        {compliance.status === 'red'
                          ? "You haven't provided enough availability. Please mark more days as available so a fair roster can be created for you."
                          : 'More availability should be provided ideally, to allow creation of a fair roster.'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-lg shadow-sm p-6">
                  <div className="flex items-center justify-between mb-3">
                    <button
                      onClick={() => {
                        const d = new Date(settingsWeekStart);
                        d.setDate(d.getDate() - SETTINGS_DAYS_SHOWN);
                        setSettingsWeekStart(d);
                      }}
                      className="p-2 hover:bg-gray-100 rounded-lg transition"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <p className="text-sm font-semibold text-gray-700">
                      {settingsDays[0].toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                      {' – '}
                      {settingsDays[settingsDays.length - 1].toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <button
                      onClick={() => {
                        const d = new Date(settingsWeekStart);
                        d.setDate(d.getDate() + SETTINGS_DAYS_SHOWN);
                        setSettingsWeekStart(d);
                      }}
                      className="p-2 hover:bg-gray-100 rounded-lg transition"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>

                  {loadingAvailability ? (
                    <div className="text-center py-8">
                      <Loader size={24} className="text-blue-600 animate-spin mx-auto mb-2" />
                      <p className="text-gray-600 text-sm">Loading availability...</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-7 gap-2">
                      {SETTINGS_DAY_LABELS.map(label => (
                        <div key={label} className="text-center text-xs font-bold text-gray-600 py-1">
                          {label}
                        </div>
                      ))}
                      {settingsDays.map(date => {
                        const dateStr = toDateStr(date);
                        const state = getAvailabilityState(availabilityMap, dateStr);
                        const style = DAY_STATE_STYLES[state];
                        const saving = savingAvailabilityDate === dateStr;
                        return (
                          <button
                            key={dateStr}
                            onClick={() => handleAvailabilityDayClick(date)}
                            disabled={saving}
                            title={style.title}
                            className={`aspect-square p-1 rounded-lg font-semibold text-xs transition border-2 disabled:opacity-50 ${style.classes}`}
                          >
                            {date.getDate()}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <p className="text-xs text-gray-500 mt-3">
                    Tap a date to cycle your availability: grey = not set, green = available, red = unavailable (you can still pick up district shifts in DR Roster), dark grey = working elsewhere (no district shifts either). Changes save immediately.
                  </p>
                </div>
              </>
            )}

            {settingsSubTab === 'walkthrough' && <StaffWalkthrough />}
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
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Search Modal */}
      {showSearch && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center p-4 z-50 pt-20">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
            <div className="p-4 border-b border-gray-200">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="Search staff..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  autoFocus
                />
                <button onClick={handleSearch} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
                  Search
                </button>
                <button
                  onClick={() => {
                    setShowSearch(false);
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {searchResults.length > 0 && (
              <div className="max-h-96 overflow-y-auto">
                {searchResults.map((result) => (
                  <button
                    key={result.staff_id}
                    onClick={() => {
                      setSelectedSearchResult(result);
                      setShowSearch(false);
                    }}
                    className="w-full text-left p-4 border-b border-gray-200 hover:bg-blue-50 transition"
                  >
                    <p className="font-semibold text-gray-900">{result.name}</p>
                    <p className="text-xs text-gray-600">{result.rank}</p>
                    {result.phone && <p className="text-xs text-gray-600 font-mono">{result.phone}</p>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Coffee Orders Modal */}
      {showCoffeeGreeting && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2 mb-3">
              <Coffee size={22} /> Good morning{staffMember?.name ? ` ${staffMember.name.replace(/^\s*(dr|prof|a\/prof)\.?\s+/i, '').trim().split(/\s+/)[0]}` : ''}!
            </h2>
            {coffeeAttentionList.length > 0 && (
              <>
                <p className="text-sm text-gray-700 mb-2">
                  {coffeeAttentionList.length === 1 ? 'This person is' : 'These people are'} working today with no coffee order yet:
                </p>
                <ul className="text-sm font-medium text-gray-900 list-disc pl-5 mb-3">
                  {coffeeAttentionList.map(item => <li key={item.key}>{item.name}{item.kind === 'visitor' ? ' (visitor)' : ''}</li>)}
                </ul>
                <p className="text-xs text-gray-500 mb-4">Add theirs before the coffee order is emailed at 9:00.</p>
              </>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCoffeeGreeting(false)} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
                Close
              </button>
              <button
                onClick={() => { setShowCoffeeGreeting(false); handleOpenCoffeeModal(); }}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg"
              >
                Add coffees
              </button>
            </div>
          </div>
        </div>
      )}

      {showCoffeeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Coffee size={22} /> Coffee Orders
                </h2>
                <p className="text-sm text-gray-600">{formatDate(new Date())}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button onClick={closeCoffeeModal} className="p-1 hover:bg-gray-100 rounded-lg -mt-1 -mr-1">
                  <X size={20} />
                </button>
                <div className="flex gap-3">
                  {SESSION_GROUP_ORDER.map(groupKey => (
                    <label key={groupKey} className="flex items-center gap-1 text-xs font-medium text-gray-700 cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={coffeeSessionFilters[groupKey]}
                        onChange={(e) => setCoffeeSessionFilters(prev => ({ ...prev, [groupKey]: e.target.checked }))}
                        className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
                      />
                      {COFFEE_SESSION_LABELS[groupKey]}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {coffeeModalError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{coffeeModalError}</p>
              </div>
            )}

            {loadingCoffeeModal ? (
              <div className="text-center py-8">
                <Loader size={32} className="text-blue-600 animate-spin mx-auto mb-2" />
                <p className="text-gray-600 text-sm">Loading coffee orders...</p>
              </div>
            ) : (
              <>
                {totalCoffeeCount > 0 && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex-shrink-0">
                    <p className="text-xs font-semibold text-amber-900 uppercase mb-2">Order Summary</p>
                    <ul className="text-sm text-gray-900 space-y-0.5 mb-3 list-disc list-inside">
                      {coffeeSummaryLines.map((line, i) => <li key={i}>{line}</li>)}
                    </ul>
                    {coffeePlaceSmsHref ? (
                      coffeeChoosingHandover ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-amber-900 text-center">Pick up or delivery?</p>
                          <div className="grid grid-cols-2 gap-2">
                            {[['pickup', 'Pick up 10:25'], ['delivery', 'Delivery 10:30']].map(([handover, label]) => (
                              <a
                                key={handover}
                                href={coffeePlaceSmsHref(handover)}
                                onClick={() => setCoffeeChoosingHandover(false)}
                                className="block text-center px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition"
                              >
                                {label}
                              </a>
                            ))}
                          </div>
                          <button
                            onClick={() => setCoffeeChoosingHandover(false)}
                            className="block w-full text-center text-xs text-gray-600 hover:text-gray-900"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setCoffeeChoosingHandover(true)}
                          className="block w-full text-center px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition"
                        >
                          Text order to {department?.coffee_place_name || 'Coffee Place'}
                        </button>
                      )
                    ) : (
                      <p className="text-xs text-gray-500">An officer can set a Coffee Place number in Settings → Phone Book to text this order directly from here.</p>
                    )}
                  </div>
                )}

                {coffeeAttentionList.length > 0 && (
                  <div className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 flex-shrink-0">
                    <p className="text-xs font-semibold text-red-800 uppercase mb-2">Needs a coffee order ({coffeeAttentionList.length})</p>
                    <div className="space-y-3 max-h-48 overflow-y-auto">
                      {coffeeAttentionList.map(item => (
                        <div key={item.key} className="space-y-1">
                          <div className="text-sm text-gray-900">
                            <span className="font-medium">{item.name}</span>
                            <span className="text-xs text-gray-600"> · {item.kind === 'visitor' ? 'Visitor, not on the roster' : 'No coffee order saved'}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <CoffeePicker
                              value={coffeeAttentionPick[item.key] ?? composeCoffeeOrder('Flat White', MILK_TYPES[0], false)}
                              onSave={(order) => setCoffeeAttentionPick(prev => ({ ...prev, [item.key]: order }))}
                            />
                            <button
                              onClick={() => handleAddCoffeeAttention(item)}
                              className="px-3 py-1 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition"
                            >
                              Add to coffee list
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(coffeeOrdersForModal.length > 0 || coffeeExtras.length > 0) ? (
                  <div className="overflow-y-auto flex-1 -mx-6 px-6">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 bg-white">
                        <tr>
                          <th className="px-2 py-2 border-b border-gray-200 w-8" />
                          <th className="text-left px-2 py-2 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">Staff Name</th>
                          <th className="text-left px-2 py-2 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">Rank</th>
                          <th className="text-left px-2 py-2 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">Coffee Type</th>
                          <th className="text-left px-2 py-2 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">Milk Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {coffeeOrdersForModal.map(person => {
                          const removed = coffeeRemovedStaffIds.has(person.staff_id);
                          return (
                            <tr key={person.staff_id} className={`hover:bg-gray-50 ${removed ? 'opacity-40' : ''}`}>
                              <td className="px-2 py-2 border-b border-gray-100">
                                <input
                                  type="checkbox"
                                  checked={!removed}
                                  onChange={(e) => handleToggleCoffeeStaffRemoved(person.staff_id, !e.target.checked)}
                                  title={removed ? 'Left off today\'s order' : 'Include in today\'s order'}
                                  className="w-4 h-4 cursor-pointer accent-blue-600"
                                />
                              </td>
                              <td className="px-2 py-2 border-b border-gray-100 text-sm font-medium text-gray-900">{person.name}</td>
                              <td className="px-2 py-2 border-b border-gray-100 text-sm text-gray-600 capitalize">{person.rank}</td>
                              <td className="px-2 py-2 border-b border-gray-100 text-sm text-gray-900">{person.coffeeType}{person.extraShot ? ' + Shot' : ''}</td>
                              <td className="px-2 py-2 border-b border-gray-100 text-sm text-gray-900">{person.milkType}</td>
                            </tr>
                          );
                        })}
                        {/* Extras — coffees for people not on the roster
                            (locums, visiting surgeons, etc). Rendered as
                            plain rows in the same table, not a separate
                            block, so they read as part of the one list
                            instead of a prominent stack of cards that
                            crowds out the real list on a small screen. */}
                        {coffeeExtras.map(extra => (
                          <tr key={extra.extra_id} className="hover:bg-gray-50">
                            <td className="px-2 py-2 border-b border-gray-100">
                              <button
                                onClick={() => handleRemoveCoffeeExtra(extra.extra_id)}
                                title="Remove"
                                className="p-0.5 hover:bg-gray-200 rounded"
                              >
                                <X size={14} className="text-gray-500" />
                              </button>
                            </td>
                            <td className="px-2 py-2 border-b border-gray-100 text-sm font-medium text-gray-900">
                              {extra.label || 'Extra'}{extra.quantity > 1 ? ` ×${extra.quantity}` : ''}
                            </td>
                            <td className="px-2 py-2 border-b border-gray-100 text-sm text-gray-500 italic">extra</td>
                            <td className="px-2 py-2 border-b border-gray-100 text-sm text-gray-900">{extra.coffee_type}{extra.extra_shot ? ' + Shot' : ''}</td>
                            <td className="px-2 py-2 border-b border-gray-100 text-sm text-gray-900">{extra.milk_type && extra.milk_type !== NO_MILK ? extra.milk_type : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 py-4">No coffee orders — nobody working today wants a coffee (or nobody's set a preference yet).</p>
                )}

                <div className={(coffeeOrdersForModal.length > 0 || coffeeExtras.length > 0) ? 'mt-4 pt-4 border-t border-gray-200 flex-shrink-0' : 'flex-shrink-0'}>
                  {showAddCoffeeExtra ? (
                    <div className="p-3 border border-gray-200 rounded-lg space-y-2">
                      <p className="text-xs font-semibold text-gray-600 uppercase">Add someone not on the roster</p>
                      <input
                        type="text"
                        value={extraFormLabel}
                        onChange={(e) => setExtraFormLabel(e.target.value)}
                        placeholder="Who's it for? (optional — e.g. Locum)"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                      <div className="flex gap-2">
                        <select
                          value={extraFormCoffeeType}
                          onChange={(e) => handleExtraCoffeeTypeChange(e.target.value)}
                          className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded text-sm"
                        >
                          {COFFEE_TYPES.filter(t => t !== NO_COFFEE).map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <select
                          value={milkIsFixedForCoffeeType(extraFormCoffeeType) ? NO_MILK : extraFormMilkType}
                          disabled={milkIsFixedForCoffeeType(extraFormCoffeeType)}
                          onChange={(e) => setExtraFormMilkType(e.target.value)}
                          className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50"
                        >
                          {milkIsFixedForCoffeeType(extraFormCoffeeType) ? (
                            <option value={NO_MILK}>{NO_MILK}</option>
                          ) : (
                            MILK_TYPES.map(m => <option key={m} value={m}>{m}</option>)
                          )}
                        </select>
                        <input
                          type="number"
                          min={1}
                          value={extraFormQuantity}
                          onChange={(e) => setExtraFormQuantity(e.target.value)}
                          className="w-16 flex-shrink-0 px-2 py-1.5 border border-gray-300 rounded text-sm"
                        />
                      </div>
                      <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={extraFormExtraShot}
                          onChange={(e) => setExtraFormExtraShot(e.target.checked)}
                          className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
                        />
                        Xtra shot
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowAddCoffeeExtra(false)}
                          className="flex-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium rounded-lg transition"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSubmitCoffeeExtra}
                          className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={handleOpenAddCoffeeExtra}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-dashed border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-800 text-sm font-medium rounded-lg transition"
                    >
                      <Plus size={16} /> Add someone not on the roster (locum, visitor…)
                    </button>
                  )}
                </div>

                {totalCoffeeCount > 0 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 flex-shrink-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {totalCoffeeCount} coffee{totalCoffeeCount === 1 ? '' : 's'} to order
                    </p>
                    <button
                      onClick={handleCopyCoffeeOrders}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium rounded-lg transition"
                    >
                      {coffeeCopied ? <Check size={16} /> : <Copy size={16} />}
                      {coffeeCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Staff Detail Popup */}
      {selectedSearchResult && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{selectedSearchResult.name}</h2>
                <p className="text-sm text-gray-600 capitalize">{selectedSearchResult.rank}</p>
              </div>
              <div className="flex items-center gap-1">
                {selectedSearchResult.staff_id !== staffId && (
                  <button
                    onClick={() => handleToggleStar(selectedSearchResult.staff_id)}
                    title={
                      starredStaff.some(f => f.starred_staff_id === selectedSearchResult.staff_id)
                        ? 'Remove from starred'
                        : starredStaff.length >= 10
                          ? 'You can only star up to 10 people'
                          : 'Star — shows under your Week tab'
                    }
                    disabled={!starredStaff.some(f => f.starred_staff_id === selectedSearchResult.staff_id) && starredStaff.length >= 10}
                    className="p-1 hover:bg-yellow-50 rounded-lg disabled:opacity-30"
                  >
                    <Star
                      size={22}
                      className={starredStaff.some(f => f.starred_staff_id === selectedSearchResult.staff_id) ? 'fill-yellow-400 text-yellow-500' : 'text-gray-300'}
                    />
                  </button>
                )}
                <button
                  onClick={() => setSelectedSearchResult(null)}
                  className="p-1 hover:bg-gray-100 rounded-lg"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {starringError && (
              <p className="text-xs text-red-700 mb-4">{starringError}</p>
            )}

            {selectedSearchResult.phone && (
              <a href={`tel:${selectedSearchResult.phone}`} className="block bg-blue-50 hover:bg-blue-100 rounded-lg p-4 mb-6 transition">
                <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">Phone</p>
                <p className="text-lg font-mono font-semibold text-blue-700 underline">{selectedSearchResult.phone}</p>
              </a>
            )}

            {selectedSearchResult.email && (
              <a href={`mailto:${selectedSearchResult.email}`} className="block bg-green-50 hover:bg-green-100 rounded-lg p-4 mb-6 transition">
                <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">Email</p>
                <p className="text-sm font-semibold text-blue-700 underline break-all">{selectedSearchResult.email}</p>
              </a>
            )}

            {selectedSearchResult.coffee_order && (
              <div className="bg-orange-50 rounded-lg p-4 mb-6">
                <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">Coffee Order</p>
                <p className="text-sm font-semibold text-gray-900">{selectedSearchResult.coffee_order}</p>
              </div>
            )}

            {selectedSearchResult.activity_restrictions && selectedSearchResult.activity_restrictions.length > 0 && (
              <div className="bg-yellow-50 rounded-lg p-4 mb-6">
                <p className="text-xs text-gray-600 uppercase tracking-wide mb-2">Activity Restrictions</p>
                <div className="flex flex-wrap gap-2">
                  {selectedSearchResult.activity_restrictions.map((activity, idx) => (
                    <span key={idx} className="px-2 py-1 bg-yellow-200 text-yellow-900 text-xs rounded font-medium">
                      {activity}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setSelectedSearchResult(null)}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium py-2 rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Export Calendar Modal — one checkbox per upcoming week that has
          any assignment in it, all selected by default. */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Export Calendar</h2>
                <p className="text-sm text-gray-600">Choose which upcoming weeks to include.</p>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="p-1 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            {loadingExportWeeks ? (
              <div className="py-8 flex justify-center">
                <Loader size={24} className="animate-spin text-gray-400" />
              </div>
            ) : (
              <>
                <label className="flex items-center gap-2 pb-3 mb-2 border-b border-gray-200 font-semibold text-sm text-gray-900">
                  <input
                    type="checkbox"
                    checked={allExportWeeksSelected}
                    onChange={handleToggleAllExportWeeks}
                    className="w-4 h-4 rounded"
                  />
                  Select all
                </label>

                <div className="overflow-y-auto flex-1 -mx-1 px-1 mb-4">
                  {exportWeeks.map((w) => {
                    const key = toDateStr(w.weekStart);
                    return (
                      <label key={key} className="flex items-center gap-2 py-2 text-sm text-gray-900">
                        <input
                          type="checkbox"
                          checked={w.selected}
                          onChange={() => handleToggleExportWeek(key)}
                          className="w-4 h-4 rounded"
                        />
                        {w.label}
                      </label>
                    );
                  })}
                </div>

                <button
                  onClick={handleConfirmExport}
                  disabled={exporting || exportWeeks.every(w => !w.selected)}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium py-2 rounded-lg flex items-center justify-center gap-2"
                >
                  {exporting ? <Loader size={18} className="animate-spin" /> : <Download size={18} />}
                  Export
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Crossover Modal — navigate week-by-week to see working-together
          and both-off days against a starred colleague. */}
      {crossoverStaff && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Crossover</h2>
                <p className="text-sm text-gray-600">You &amp; {crossoverStaff.staff?.name}</p>
              </div>
              <button
                onClick={handleCloseCrossover}
                className="p-1 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => handleCrossoverWeekNav(-7)}
                disabled={loadingCrossover}
                aria-label="Previous week"
                className="p-1.5 hover:bg-gray-100 rounded-lg disabled:opacity-40"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm font-medium text-gray-700">
                {formatCrossoverWeekRange(crossoverWeekStart)}
              </span>
              <button
                onClick={() => handleCrossoverWeekNav(7)}
                disabled={loadingCrossover}
                aria-label="Next week"
                className="p-1.5 hover:bg-gray-100 rounded-lg disabled:opacity-40"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            {loadingCrossover ? (
              <div className="text-center py-8">
                <Loader size={32} className="text-blue-600 animate-spin mx-auto" />
              </div>
            ) : crossoverDays && (
              <>
                <div className="grid grid-cols-7 gap-1 mb-4">
                  {crossoverDays.map(day => (
                    <div
                      key={day.dateStr}
                      title={day.status === 'working' ? 'Working together' : day.status === 'off' ? 'Both off' : ''}
                      className={`aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-bold border-2 ${
                        day.status === 'working'
                          ? 'bg-green-100 border-green-500 text-green-800'
                          : day.status === 'off'
                            ? 'bg-gray-200 border-gray-400 text-gray-700'
                            : 'bg-white border-gray-200 text-gray-300'
                      }`}
                    >
                      <span>{day.label.slice(0, 2)}</span>
                      {day.status === 'working' && (
                        <span className="text-[9px] font-semibold leading-none mt-0.5">Work</span>
                      )}
                      {day.status === 'off' && (
                        <span className="text-[9px] font-semibold leading-none mt-0.5">Off</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="space-y-1 text-sm">
                  <p className="text-gray-700">
                    <span className="inline-block w-3 h-3 rounded bg-green-100 border-2 border-green-500 mr-2 align-middle" />
                    Working together: {crossoverDays.filter(d => d.status === 'working').map(d => d.label).join(', ') || 'none'}
                  </p>
                  <p className="text-gray-700">
                    <span className="inline-block w-3 h-3 rounded bg-gray-200 border-2 border-gray-400 mr-2 align-middle" />
                    Both off: {crossoverDays.filter(d => d.status === 'off').map(d => d.label).join(', ') || 'none'}
                  </p>
                </div>
              </>
            )}

            <button
              onClick={handleCloseCrossover}
              className="w-full mt-6 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium py-2 rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      {renderContent()}

      {/* Bottom Tab Navigation */}
      {/* Logout Button */}
      <div className="fixed top-4 right-4 z-40 bg-white rounded-lg shadow-md p-3">
        <button
          onClick={() => {
            if (window.confirm('Log out?')) {
              signOut();
            }
          }}
          className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded text-sm transition"
        >
          Log Out
        </button>
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="max-w-3xl mx-auto flex justify-around">
          <button
            onClick={() => setActiveTab('day')}
            className={`flex-1 py-4 text-center transition ${
              activeTab === 'day' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="text-sm font-semibold">Day</div>
          </button>
          <button
            onClick={() => setActiveTab('week')}
            className={`flex-1 py-4 text-center transition ${
              activeTab === 'week' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="text-sm font-semibold">Week</div>
          </button>
          <button
            onClick={() => setActiveTab('oncall')}
            className={`flex-1 py-4 text-center transition ${
              activeTab === 'oncall' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Phone size={20} className="mx-auto" />
            <div className="text-[10px] font-semibold mt-0.5">Phone Book</div>
          </button>
          <button
            onClick={() => setActiveTab('volunteer')}
            className={`flex-1 py-4 text-center transition ${
              activeTab === 'volunteer' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Hand size={20} className="mx-auto" />
            <div className="text-[10px] font-semibold mt-0.5">Variation</div>
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
          <button
            onClick={handleOpenExportModal}
            disabled={loadingExportWeeks}
            className="flex-1 py-4 text-center text-gray-600 hover:text-gray-900 transition disabled:opacity-50"
          >
            {loadingExportWeeks ? (
              <Loader size={20} className="mx-auto animate-spin" />
            ) : (
              <Download size={20} className="mx-auto" />
            )}
            <div className="text-[10px] font-semibold mt-0.5">Export</div>
          </button>
          <button
            onClick={handleOpenCoffeeModal}
            className="relative flex-1 py-4 text-center text-gray-600 hover:text-gray-900 transition"
            title={coffeeAttentionList.length > 0 ? `Coffee orders for today — ${coffeeAttentionList.length} need an order` : 'Coffee orders for today'}
          >
            <Coffee size={20} className="mx-auto" />
            {coffeeAttentionList.length > 0 && (
              <span className="absolute top-2 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[18px] text-center">
                {coffeeAttentionList.length}
              </span>
            )}
            <div className="text-[10px] font-semibold mt-0.5">Coffee</div>
          </button>
          <button
            onClick={() => setShowSearch(true)}
            className="flex-1 py-4 text-center text-gray-600 hover:text-gray-900 transition"
          >
            <Search size={20} className="mx-auto" />
          </button>
        </div>
      </div>
    </div>
  );
}
