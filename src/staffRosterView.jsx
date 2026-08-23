import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, X, AlertCircle, Loader, Search, Download, Coffee, Copy, Check } from 'lucide-react';
import {
  getStaffById,
  getStaffAssignmentsForStaffDate,
  getStaffAssignmentsForDate,
  getStaffAssignmentsForWeek,
  getAllOnCallAssignmentsForWeek,
  getDutyAssignmentsForDate,
  getDutyTypes,
  searchStaff,
  getStaffAvailability,
  toggleStaffAvailability,
  getStaffWeekScheduleForExport,
  getAvailableShiftsForStaff,
  createVolunteerRequest,
  updateMyCoffeeOrder,
  getActivityTypes,
  updateMyActivityRestrictions,
  updateMyEmail,
  updateMyPhone,
  signOut,
} from './supabaseClient';
import CollapsibleSection from './CollapsibleSection';
import { RANK_OPTIONS } from './StaffAvailabilityTab';
import CoffeePicker from './CoffeePicker';
import EditableCell from './EditableCell';
import { getSessionGroups, SESSION_GROUP_ORDER, SESSION_GROUP_LABELS } from './shiftSessionUtils';
import {
  computeAvailabilityCompliance,
  COMPLIANCE_STYLES,
  getAvailabilityState,
  nextAvailabilityState,
  stateToStoredValue,
  DAY_STATE_STYLES,
} from './availabilityUtils';
import { buildAssignmentsIcs, getIcsExportFilename, downloadTextFile } from './icsExport';
import { toLocalDateStr } from './dateUtils';
import { NO_COFFEE, parseCoffeeOrder } from './coffeeUtils';
import { getMondayOfWeek } from './payrollExport';

const SETTINGS_WEEKS_SHOWN = 4;
const SETTINGS_DAYS_SHOWN = SETTINGS_WEEKS_SHOWN * 7;
const SETTINGS_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const COFFEE_SESSION_LABELS = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' };

// staff_assignments.role is only ever the coarse consultant/registrar
// bucket a rank was mapped to at assignment time (see the roleForRank-style
// logic in supabaseClient.js) — showing it next to a colleague's name read
// as their rank but wasn't one (an Intern shows role: 'registrar'). This is
// the real rank, from the joined staff row.
const RANK_LABEL = Object.fromEntries(RANK_OPTIONS.map(r => [r.value, r.label]));

const toDateStr = toLocalDateStr;

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export default function StaffRosterView({ departmentId, staffId }) {
  const [activeTab, setActiveTab] = useState('day');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dayViewDate, setDayViewDate] = useState(new Date());
  const [staffMember, setStaffMember] = useState(null);
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
  const [todayOnCall, setTodayOnCall] = useState([]);
  // Which of "My allocations for today" row is expanded to show who else
  // is on that same session, if any.
  const [expandedAllocationId, setExpandedAllocationId] = useState(null);
  const [loadingDay, setLoadingDay] = useState(false);

  // Week tab state
  const [weekAssignments, setWeekAssignments] = useState([]);
  const [loadingWeek, setLoadingWeek] = useState(false);

  // On-call tab state
  const [allOnCallAssignments, setAllOnCallAssignments] = useState([]);
  const [loadingOnCall, setLoadingOnCall] = useState(false);

  // Volunteer tab state
  const [volunteerOpportunities, setVolunteerOpportunities] = useState([]);
  const [loadingVolunteer, setLoadingVolunteer] = useState(false);
  const [volunteeringKey, setVolunteeringKey] = useState(null); // theatre_activity_id currently being submitted
  const [volunteerError, setVolunteerError] = useState(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [selectedSearchResult, setSelectedSearchResult] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Coffee Orders modal state
  const [showCoffeeModal, setShowCoffeeModal] = useState(false);
  const [loadingCoffeeModal, setLoadingCoffeeModal] = useState(false);
  const [coffeeModalError, setCoffeeModalError] = useState(null);
  const [coffeeModalStaff, setCoffeeModalStaff] = useState([]); // [{ staff_id, name, rank, coffee_order, sessionGroups }]
  const [coffeeCopied, setCoffeeCopied] = useState(false);
  // Which shift groupings to include — all on by default ("everyone working
  // today"); unchecking a box drops that session's staff from the list
  // instead of trying to guess it from the viewer's local clock.
  const [coffeeSessionFilters, setCoffeeSessionFilters] = useState({ morning: true, afternoon: true, night: true });

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

  // Load staff member info
  useEffect(() => {
    const init = async () => {
      if (!staffId || !departmentId) {
        setError('Staff ID or Department ID not configured');
        setLoading(false);
        return;
      }

      try {
        const [{ data, error: staffError }, { data: dutyTypesData, error: dutyTypesError }] = await Promise.all([
          getStaffById(staffId),
          getDutyTypes(departmentId),
        ]);
        if (staffError) throw staffError;
        if (dutyTypesError) throw dutyTypesError;
        setStaffMember(data);
        setDutyTypes(dutyTypesData);
        setError(null);
      } catch (err) {
        setError(`Failed to load staff: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [staffId, departmentId]);

  // Load today's assignments
  useEffect(() => {
    if (activeTab !== 'day' || !staffId || !departmentId) return;

    const loadDay = async () => {
      setLoadingDay(true);
      try {
        const [assignRes, allAssignRes, dutyRes] = await Promise.all([
          getStaffAssignmentsForStaffDate(staffId, dayViewDate),
          getStaffAssignmentsForDate(departmentId, dayViewDate),
          getDutyAssignmentsForDate(departmentId, dayViewDate),
        ]);
        if (assignRes.error) throw assignRes.error;
        if (allAssignRes.error) throw allAssignRes.error;
        if (dutyRes.error) throw dutyRes.error;
        setTodayAssignments(assignRes.data);
        setTodayAllAssignments(allAssignRes.data);
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

  // Load on-call roster
  useEffect(() => {
    if (activeTab !== 'oncall' || !staffId || !departmentId) return;

    const loadOnCall = async () => {
      setLoadingOnCall(true);
      try {
        const weekStart = new Date(currentDate);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
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
              map[record.date] = record.available;
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

  // Load activity types for the Activity Restrictions sub-tab
  useEffect(() => {
    if (activeTab !== 'settings' || settingsSubTab !== 'restrictions' || !departmentId) return;

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
    if (!staffIdToView) return;
    try {
      const { data, error: fetchError } = await getStaffById(staffIdToView);
      if (fetchError) throw fetchError;
      setSelectedSearchResult(data);
    } catch (err) {
      setError(`Failed to load staff details: ${err.message}`);
    }
  };

  const handleExportCalendar = async () => {
    if (!staffId || !departmentId) return;

    setExporting(true);
    try {
      const weekStart = startOfWeek(new Date());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const { data, error: fetchError } = await getStaffWeekScheduleForExport(staffId, departmentId, weekStart);
      if (fetchError) throw fetchError;

      if (data.length === 0) {
        // Uses its own alert rather than the shared `error` banner, which
        // isn't rendered on every tab — Export is reachable from all of them.
        window.alert('No assignments this week to export.');
        return;
      }

      const startStr = toDateStr(weekStart);
      const endStr = toDateStr(weekEnd);
      const icsContent = buildAssignmentsIcs(data);
      const filename = getIcsExportFilename(staffMember?.name, startStr, endStr);
      downloadTextFile(filename, 'text/calendar;charset=utf-8', icsContent);
    } catch (err) {
      window.alert(`Failed to export calendar: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  // Fetched fresh on open (rather than reusing Day-tab state) so the coffee
  // run works correctly no matter which tab the button is clicked from.
  const handleOpenCoffeeModal = async () => {
    if (!departmentId) return;

    setShowCoffeeModal(true);
    setLoadingCoffeeModal(true);
    setCoffeeCopied(false);
    setCoffeeSessionFilters({ morning: true, afternoon: true, night: true });
    try {
      const { data, error: fetchError } = await getStaffAssignmentsForDate(departmentId, new Date());
      if (fetchError) throw fetchError;

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
        getSessionGroups(assignment.shifts).forEach(g => byStaff.get(assignment.staff_id).sessionGroups.add(g));
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

  const coffeeOrdersForModal = coffeeModalStaff
    .filter(person => person.sessionGroups.some(g => coffeeSessionFilters[g]))
    .map(person => ({ ...person, ...parseCoffeeOrder(person.coffee_order) }))
    .filter(person => person.coffeeType !== NO_COFFEE);

  const handleCopyCoffeeOrders = async () => {
    const lines = coffeeOrdersForModal.map(person =>
      `${person.name} (${person.rank}): ${person.coffeeType} - ${person.milkType}`
    );
    const text = [`Coffee orders for ${formatDate(new Date())}`, '', ...lines, '', `${lines.length} coffee${lines.length === 1 ? '' : 's'} to order`].join('\n');
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

  const renderContent = () => {
    if (activeTab === 'day') {
      // Morning/Afternoon/Night group the WHOLE department's assignments (not
      // just this staff member's own) so staff can look up who's rostered
      // where — "Allocations" above is the personal-only view.
      const groupedAssignments = { morning: [], afternoon: [], night: [] };
      todayAllAssignments.forEach(assignment => {
        getSessionGroups(assignment.shifts).forEach(group => groupedAssignments[group].push(assignment));
      });

      return (
        <div className="p-4 pb-24">
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{formatDate(dayViewDate)}</h1>
                <p className="text-sm text-gray-500">Your roster</p>
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
                  <h2 className="font-bold mb-3" style={{ fontFamily: "'Comic Sans MS', 'Comic Sans', cursive", color: '#f97316', fontSize: '1.75rem' }}>On-Call</h2>
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
                  <h2 className="font-bold mb-3" style={{ fontFamily: "'Comic Sans MS', 'Comic Sans', cursive", color: '#f97316', fontSize: '1.75rem' }}>My allocations for today</h2>
                  {todayAssignments.length === 0 ? (
                    <p className="text-sm text-gray-500">No assignments for this date.</p>
                  ) : (
                    <div className="space-y-3">
                      {todayAssignments.map(assignment => {
                        const isExpanded = expandedAllocationId === assignment.assignment_id;
                        const sessions = getSessionGroups(assignment.shifts);
                        const colleagues = isExpanded
                          ? Array.from(
                              new Map(
                                sessions
                                  .flatMap(g => groupedAssignments[g])
                                  .filter(a => a.staff_id !== staffId && a.location_id === assignment.location_id)
                                  .map(a => [a.staff_id, a])
                              ).values()
                            )
                          : [];

                        return (
                          <div key={assignment.assignment_id} className="rounded-lg border border-gray-200 overflow-hidden">
                            <button
                              onClick={() => setExpandedAllocationId(isExpanded ? null : assignment.assignment_id)}
                              className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-gray-50 transition"
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
                                        <span className="text-xs text-gray-500">{RANK_LABEL[c.staff?.rank] || c.staff?.rank}</span>
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
                  // One card per location (not per assignment), so e.g. OT9's
                  // consultant and registrar show together instead of as two
                  // separate, identical-looking cards.
                  const byLocation = [];
                  const byLocationIndex = new Map();
                  groupedAssignments[groupKey].forEach(assignment => {
                    const locationId = assignment.location_id;
                    if (!byLocationIndex.has(locationId)) {
                      byLocationIndex.set(locationId, byLocation.length);
                      byLocation.push({ locationId, locationName: assignment.locations?.name, assignments: [] });
                    }
                    byLocation[byLocationIndex.get(locationId)].assignments.push(assignment);
                  });

                  return (
                    <CollapsibleSection key={groupKey} title={SESSION_GROUP_LABELS[groupKey]}>
                      {byLocation.length === 0 ? (
                        <p className="text-sm text-gray-500">No assignments.</p>
                      ) : (
                        <div className="space-y-4">
                          {byLocation.map(({ locationId, locationName, assignments }) => {
                            const cardHasYou = assignments.some(a => a.staff_id === staffId);
                            return (
                              <div key={`${locationId}-${groupKey}`} className={`border-l-4 rounded-lg p-4 ${cardHasYou ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}>
                                <h3 className="text-lg font-bold text-gray-900 mb-2">{locationName}</h3>
                                <div className="space-y-2">
                                  {assignments.map(assignment => {
                                    const isYou = assignment.staff_id === staffId;
                                    return (
                                      <div key={assignment.assignment_id} className={`flex items-center justify-between gap-2 p-2 rounded ${isYou ? 'bg-blue-100' : 'bg-white'}`}>
                                        <div>
                                          <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                            <button onClick={() => handleViewStaffDetail(assignment.staff_id)} className="hover:underline hover:text-blue-700">
                                              {assignment.staff?.name}
                                            </button>
                                            {isYou && <span className="px-2 py-0.5 bg-blue-600 text-white text-xs font-semibold rounded-full">You</span>}
                                          </p>
                                          <p className="text-xs text-gray-600">
                                            {assignment.shifts?.name} ({assignment.shifts?.start_time?.slice(0, 5)} - {assignment.shifts?.end_time?.slice(0, 5)})
                                          </p>
                                        </div>
                                        <p className="text-xs font-medium text-gray-600">{RANK_LABEL[assignment.staff?.rank] || assignment.role}</p>
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
                  weekAssignments.forEach((assignment) => {
                    if (!byDate.has(assignment.date)) byDate.set(assignment.date, []);
                    byDate.get(assignment.date).push(assignment);
                  });

                  return Array.from(byDate.entries()).map(([date, assignments]) => (
                    <div key={date} className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-green-500">
                      <p className="text-xs font-semibold text-gray-600 uppercase mb-3">
                        {new Date(date).toLocaleDateString('en-AU', { weekday: 'long', month: 'short', day: 'numeric' })}
                      </p>
                      <div className="space-y-3">
                        {assignments.map((assignment, i) => (
                          <div key={assignment.assignment_id} className={i > 0 ? 'pt-3 border-t border-gray-100' : ''}>
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
      const weekStart = new Date(currentDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());

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
                <h1 className="text-2xl font-bold text-gray-900">On-Call Roster</h1>
                <p className="text-sm text-gray-500">Week of {formatDateShort(weekStart)}</p>
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
                                <p className="text-sm font-bold text-gray-900">{assignment.staff?.name}</p>
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
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'volunteer') {
      return (
        <div className="p-4 pb-24">
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Available Shifts</h1>
              <p className="text-sm text-gray-500">Unfilled shifts you're eligible for, over the next 30 days</p>
              {volunteerError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
                  <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{volunteerError}</p>
                </div>
              )}
            </div>

            {loadingVolunteer ? (
              <div className="text-center py-8">
                <Loader size={32} className="text-blue-600 animate-spin mx-auto mb-2" />
                <p className="text-gray-600 text-sm">Loading available shifts...</p>
              </div>
            ) : volunteerOpportunities.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm p-6 text-center">
                <p className="text-gray-600">No unfilled shifts you're eligible for right now.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {volunteerOpportunities.map(opportunity => (
                  <div key={`${opportunity.theatre_activity_id}-${opportunity.role_needed}`} className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-purple-500">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-600 uppercase">Date</p>
                        <p className="text-sm font-medium text-gray-900">
                          {new Date(`${opportunity.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                      <div className="px-3 py-1 bg-purple-100 text-purple-900 text-xs font-semibold rounded uppercase">
                        {opportunity.role_needed} needed
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
                    Tap a date to cycle your availability: grey = not set, green = available, red = unavailable. Changes save immediately.
                  </p>
                </div>
              </>
            )}
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
                <button onClick={() => setShowCoffeeModal(false)} className="p-1 hover:bg-gray-100 rounded-lg -mt-1 -mr-1">
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
            ) : coffeeOrdersForModal.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">No coffee orders — nobody working today wants a coffee (or nobody's set a preference yet).</p>
            ) : (
              <>
                <div className="overflow-y-auto flex-1 -mx-6 px-6">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 bg-white">
                      <tr>
                        <th className="text-left px-2 py-2 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">Staff Name</th>
                        <th className="text-left px-2 py-2 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">Rank</th>
                        <th className="text-left px-2 py-2 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">Coffee Type</th>
                        <th className="text-left px-2 py-2 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">Milk Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coffeeOrdersForModal.map(person => (
                        <tr key={person.staff_id} className="hover:bg-gray-50">
                          <td className="px-2 py-2 border-b border-gray-100 text-sm font-medium text-gray-900">{person.name}</td>
                          <td className="px-2 py-2 border-b border-gray-100 text-sm text-gray-600 capitalize">{person.rank}</td>
                          <td className="px-2 py-2 border-b border-gray-100 text-sm text-gray-900">{person.coffeeType}</td>
                          <td className="px-2 py-2 border-b border-gray-100 text-sm text-gray-900">{person.milkType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                  <p className="text-sm font-semibold text-gray-900">
                    {coffeeOrdersForModal.length} coffee{coffeeOrdersForModal.length === 1 ? '' : 's'} to order
                  </p>
                  <button
                    onClick={handleCopyCoffeeOrders}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium rounded-lg transition"
                  >
                    {coffeeCopied ? <Check size={16} /> : <Copy size={16} />}
                    {coffeeCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
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
              <button
                onClick={() => setSelectedSearchResult(null)}
                className="p-1 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            {selectedSearchResult.phone && (
              <div className="bg-blue-50 rounded-lg p-4 mb-6">
                <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">Phone</p>
                <p className="text-lg font-mono font-semibold text-gray-900">{selectedSearchResult.phone}</p>
              </div>
            )}

            {selectedSearchResult.email && (
              <div className="bg-green-50 rounded-lg p-4 mb-6">
                <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">Email</p>
                <p className="text-sm font-semibold text-gray-900 break-all">{selectedSearchResult.email}</p>
              </div>
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
            <div className="text-sm font-semibold">On-Call</div>
          </button>
          <button
            onClick={() => setActiveTab('volunteer')}
            className={`flex-1 py-4 text-center transition ${
              activeTab === 'volunteer' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="text-sm font-semibold">Volunteer</div>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-4 text-center transition ${
              activeTab === 'settings' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="text-sm font-semibold">Settings</div>
          </button>
          <button
            onClick={handleExportCalendar}
            disabled={exporting}
            className="flex-1 py-4 text-center text-gray-600 hover:text-gray-900 transition disabled:opacity-50"
          >
            {exporting ? (
              <Loader size={20} className="mx-auto animate-spin" />
            ) : (
              <Download size={20} className="mx-auto" />
            )}
            <div className="text-[10px] font-semibold mt-0.5">Export</div>
          </button>
          <button
            onClick={handleOpenCoffeeModal}
            className="flex-1 py-4 text-center text-gray-600 hover:text-gray-900 transition"
            title="Coffee orders for today"
          >
            <Coffee size={20} className="mx-auto" />
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
