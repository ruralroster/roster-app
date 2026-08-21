import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle, Loader, X } from 'lucide-react';
import {
  getStaffAvailability,
  toggleStaffAvailability,
  updateStaffFTE,
  bulkSetStaffAvailability,
  clearStaffUnavailabilityRange,
  createStaff,
  deactivateStaff,
  reactivateStaff,
  updateStaffPayrollNumber,
  updateStaffPositionId,
  updateStaffCostCentre,
} from './supabaseClient';
import {
  FTE_OPTIONS,
  DEFAULT_FTE,
  formatFte,
  computeAvailabilityCompliance,
  COMPLIANCE_STYLES,
  getAvailabilityState,
  nextAvailabilityState,
  stateToStoredValue,
  DAY_STATE_STYLES,
  getMaterializationWindow,
  getDatesForWeekday,
  getDatesForFortnightlyTemplate,
  getFortnightlyEndDate,
  getDatesInRange,
  MATERIALIZATION_MONTHS_AHEAD,
  MIN_FORTNIGHT_COUNT,
  MAX_FORTNIGHT_COUNT,
} from './availabilityUtils';
import { toLocalDateStr } from './dateUtils';

const WEEKS_SHOWN = 4;
const DAYS_SHOWN = WEEKS_SHOWN * 7;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const RANK_OPTIONS = [
  { value: 'consultant', label: 'Consultant' },
  { value: 'fellow', label: 'Fellow' },
  { value: 'advanced_trainee', label: 'Advanced Trainee' },
  { value: 'basic_trainee', label: 'Basic Trainee' },
];

const toDateStr = toLocalDateStr;

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function getMondayOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export default function StaffAvailabilityTab({ departmentId, staffList = [], leaveTypes = [], onStaffChanged }) {
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [weekStartDate, setWeekStartDate] = useState(() => startOfWeek(new Date()));
  const [availabilityMap, setAvailabilityMap] = useState({});
  const [leaveTypeMap, setLeaveTypeMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savingDate, setSavingDate] = useState(null);
  const [fteOverrides, setFteOverrides] = useState({});
  const [savingFte, setSavingFte] = useState(false);
  const [payrollNumberOverrides, setPayrollNumberOverrides] = useState({});
  const [savingPayrollNumber, setSavingPayrollNumber] = useState(false);
  const [positionIdOverrides, setPositionIdOverrides] = useState({});
  const [savingPositionId, setSavingPositionId] = useState(false);
  const [costCentreOverrides, setCostCentreOverrides] = useState({});
  const [savingCostCentre, setSavingCostCentre] = useState(false);
  const [recurringDays, setRecurringDays] = useState(new Set());
  const [fortnightlyAnchorDate, setFortnightlyAnchorDate] = useState(() => toDateStr(startOfWeek(new Date())));
  const [fortnightCount, setFortnightCount] = useState(MAX_FORTNIGHT_COUNT);
  const [showFortnightlyModal, setShowFortnightlyModal] = useState(false);
  const [fortnightlySlots, setFortnightlySlots] = useState(new Set()); // "weekIndex-dayOfWeek" keys
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [showOffWeekModal, setShowOffWeekModal] = useState(false);
  const [offWeekLeaveTypeId, setOffWeekLeaveTypeId] = useState('');
  const [applyingRule, setApplyingRule] = useState(false);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRank, setNewStaffRank] = useState('consultant');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  const [savingStaff, setSavingStaff] = useState(false);

  useEffect(() => {
    if (!selectedStaffId && staffList.length > 0) {
      const firstActive = staffList.find(s => s.active !== false);
      setSelectedStaffId((firstActive || staffList[0]).staff_id);
    }
  }, [staffList, selectedStaffId]);

  // Rule inputs are per-staff-member scratch state — don't carry over when switching who's selected.
  useEffect(() => {
    setRecurringDays(new Set());
    setFortnightlyAnchorDate(toDateStr(startOfWeek(new Date())));
    setFortnightCount(MAX_FORTNIGHT_COUNT);
    setShowFortnightlyModal(false);
    setFortnightlySlots(new Set());
    setShowLeaveModal(false);
    setLeaveStart('');
    setLeaveEnd('');
    setShowOffWeekModal(false);
    setOffWeekLeaveTypeId('');
  }, [selectedStaffId]);

  const days = [];
  for (let i = 0; i < DAYS_SHOWN; i++) {
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const loadAvailability = useCallback(async () => {
    if (!departmentId || !selectedStaffId) return;

    setLoading(true);
    try {
      const results = await Promise.all(
        [0, 1, 2, 3].map(weekOffset => {
          const start = new Date(weekStartDate);
          start.setDate(start.getDate() + weekOffset * 7);
          return getStaffAvailability(departmentId, start);
        })
      );

      const map = {};
      const leaveMap = {};
      results.forEach(({ data, error: fetchError }) => {
        if (fetchError) throw fetchError;
        (data || []).forEach(record => {
          if (record.staff_id === selectedStaffId) {
            map[record.date] = record.available;
            if (record.leave_type_id) leaveMap[record.date] = record.leave_type_id;
          }
        });
      });

      setAvailabilityMap(map);
      setLeaveTypeMap(leaveMap);
      setError(null);
    } catch (err) {
      setError(`Failed to load availability: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [departmentId, selectedStaffId, weekStartDate]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  const handleDayClick = async (date) => {
    if (!selectedStaffId) return;
    const dateStr = toDateStr(date);
    const nextState = nextAvailabilityState(getAvailabilityState(availabilityMap, dateStr));
    const storedValue = stateToStoredValue(nextState);

    setSavingDate(dateStr);
    try {
      const { error: toggleError } = await toggleStaffAvailability(departmentId, selectedStaffId, date, storedValue);
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
      setSavingDate(null);
    }
  };

  const handleBulkAction = async (action) => {
    if (!selectedStaffId) return;

    let targets;
    let available;
    if (action === 'weekdays') {
      targets = days.filter(d => d.getDay() !== 0 && d.getDay() !== 6);
      available = true;
    } else {
      targets = days;
      available = true;
    }

    setLoading(true);
    try {
      for (const date of targets) {
        const { error: toggleError } = await toggleStaffAvailability(departmentId, selectedStaffId, date, available);
        if (toggleError) throw toggleError;
      }

      setAvailabilityMap(prev => {
        const next = { ...prev };
        targets.forEach(d => { next[toDateStr(d)] = available; });
        return next;
      });
      setError(null);
    } catch (err) {
      setError(`Failed to apply bulk update: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFteChange = async (newFte) => {
    if (!selectedStaffId) return;
    const fte = parseFloat(newFte);

    setSavingFte(true);
    try {
      const { error: fteError } = await updateStaffFTE(selectedStaffId, fte);
      if (fteError) throw fteError;

      setFteOverrides(prev => ({ ...prev, [selectedStaffId]: fte }));
      setError(null);
    } catch (err) {
      setError(`Failed to update FTE: ${err.message}`);
    } finally {
      setSavingFte(false);
    }
  };

  const handlePayrollNumberInput = (value) => {
    if (!selectedStaffId) return;
    setPayrollNumberOverrides(prev => ({ ...prev, [selectedStaffId]: value }));
  };

  const handleSavePayrollNumber = async () => {
    if (!selectedStaffId) return;
    const payrollNumber = payrollNumberOverrides[selectedStaffId] ?? selectedStaff?.payroll_number ?? '';

    setSavingPayrollNumber(true);
    try {
      const { error: payrollError } = await updateStaffPayrollNumber(selectedStaffId, payrollNumber.trim());
      if (payrollError) throw payrollError;

      if (onStaffChanged) await onStaffChanged();
      setError(null);
    } catch (err) {
      setError(`Failed to update payroll number: ${err.message}`);
    } finally {
      setSavingPayrollNumber(false);
    }
  };

  const handlePositionIdInput = (value) => {
    if (!selectedStaffId) return;
    setPositionIdOverrides(prev => ({ ...prev, [selectedStaffId]: value }));
  };

  const handleSavePositionId = async () => {
    if (!selectedStaffId) return;
    const positionId = positionIdOverrides[selectedStaffId] ?? selectedStaff?.position_id ?? '';

    setSavingPositionId(true);
    try {
      const { error: positionError } = await updateStaffPositionId(selectedStaffId, positionId.trim());
      if (positionError) throw positionError;

      if (onStaffChanged) await onStaffChanged();
      setError(null);
    } catch (err) {
      setError(`Failed to update position ID: ${err.message}`);
    } finally {
      setSavingPositionId(false);
    }
  };

  const handleCostCentreInput = (value) => {
    if (!selectedStaffId) return;
    setCostCentreOverrides(prev => ({ ...prev, [selectedStaffId]: value }));
  };

  const handleSaveCostCentre = async () => {
    if (!selectedStaffId) return;
    const costCentre = costCentreOverrides[selectedStaffId] ?? selectedStaff?.cost_centre ?? '';

    setSavingCostCentre(true);
    try {
      const { error: costCentreError } = await updateStaffCostCentre(selectedStaffId, costCentre.trim());
      if (costCentreError) throw costCentreError;

      if (onStaffChanged) await onStaffChanged();
      setError(null);
    } catch (err) {
      setError(`Failed to update cost centre: ${err.message}`);
    } finally {
      setSavingCostCentre(false);
    }
  };

  const handleCreateStaff = async () => {
    if (!departmentId || !newStaffName.trim()) return;

    setSavingStaff(true);
    try {
      const { data, error: createError } = await createStaff(departmentId, newStaffName.trim(), newStaffRank, newStaffPhone.trim());
      if (createError) throw createError;

      if (onStaffChanged) await onStaffChanged();
      if (data) setSelectedStaffId(data.staff_id);

      setShowAddStaff(false);
      setNewStaffName('');
      setNewStaffRank('consultant');
      setNewStaffPhone('');
      setError(null);
    } catch (err) {
      setError(`Failed to add staff: ${err.message}`);
    } finally {
      setSavingStaff(false);
    }
  };

  const handleDeactivateStaff = async () => {
    if (!selectedStaffId || !selectedStaff) return;
    if (!window.confirm(`Deactivate ${selectedStaff.name}? They won't be offered for new assignments, but everything they're already rostered on stays as-is.`)) {
      return;
    }

    setSavingStaff(true);
    try {
      const { error: deactivateError } = await deactivateStaff(selectedStaffId);
      if (deactivateError) throw deactivateError;

      if (onStaffChanged) await onStaffChanged();
      setError(null);
    } catch (err) {
      setError(`Failed to deactivate staff: ${err.message}`);
    } finally {
      setSavingStaff(false);
    }
  };

  const handleReactivateStaff = async () => {
    if (!selectedStaffId) return;

    setSavingStaff(true);
    try {
      const { error: reactivateError } = await reactivateStaff(selectedStaffId);
      if (reactivateError) throw reactivateError;

      if (onStaffChanged) await onStaffChanged();
      setError(null);
    } catch (err) {
      setError(`Failed to reactivate staff: ${err.message}`);
    } finally {
      setSavingStaff(false);
    }
  };

  const toggleRecurringDay = (dayOfWeek) => {
    setRecurringDays(prev => {
      const next = new Set(prev);
      if (next.has(dayOfWeek)) next.delete(dayOfWeek); else next.add(dayOfWeek);
      return next;
    });
  };

  const handleApplyRecurringDays = async () => {
    if (!selectedStaffId || recurringDays.size === 0) return;

    setApplyingRule(true);
    try {
      const { start, end } = getMaterializationWindow();
      let dates = [];
      recurringDays.forEach(dayOfWeek => {
        dates = dates.concat(getDatesForWeekday(start, end, dayOfWeek));
      });

      const { error: bulkError } = await bulkSetStaffAvailability(departmentId, selectedStaffId, dates, false);
      if (bulkError) throw bulkError;

      setRecurringDays(new Set());
      await loadAvailability();
      setError(null);
    } catch (err) {
      setError(`Failed to apply standing days off: ${err.message}`);
    } finally {
      setApplyingRule(false);
    }
  };

  const toggleFortnightlySlot = (weekIndex, dayOfWeek) => {
    const slot = `${weekIndex}-${dayOfWeek}`;
    setFortnightlySlots(prev => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot); else next.add(slot);
      return next;
    });
  };

  const handleApplyFortnightly = async () => {
    if (!selectedStaffId || !fortnightlyAnchorDate) return;

    setApplyingRule(true);
    try {
      const anchor = new Date(`${fortnightlyAnchorDate}T00:00:00`);
      const end = getFortnightlyEndDate(anchor, fortnightCount);
      const { availableDates, unavailableDates } = getDatesForFortnightlyTemplate(anchor, end, fortnightlySlots);

      const [availRes, unavailRes] = await Promise.all([
        bulkSetStaffAvailability(departmentId, selectedStaffId, availableDates, true),
        bulkSetStaffAvailability(departmentId, selectedStaffId, unavailableDates, false),
      ]);
      if (availRes.error) throw availRes.error;
      if (unavailRes.error) throw unavailRes.error;

      setShowFortnightlyModal(false);
      await loadAvailability();
      setError(null);
    } catch (err) {
      setError(`Failed to apply fortnightly pattern: ${err.message}`);
    } finally {
      setApplyingRule(false);
    }
  };

  const handleSubmitLeave = async () => {
    if (!selectedStaffId || !leaveStart || !leaveEnd) return;

    const start = new Date(`${leaveStart}T00:00:00`);
    const end = new Date(`${leaveEnd}T00:00:00`);
    if (end < start) {
      setError('Leave end date must be on or after the start date');
      return;
    }

    setApplyingRule(true);
    try {
      const dates = getDatesInRange(start, end);
      const { error: bulkError } = await bulkSetStaffAvailability(departmentId, selectedStaffId, dates, false);
      if (bulkError) throw bulkError;

      setShowLeaveModal(false);
      setLeaveStart('');
      setLeaveEnd('');
      await loadAvailability();
      setError(null);
    } catch (err) {
      setError(`Failed to add leave: ${err.message}`);
    } finally {
      setApplyingRule(false);
    }
  };

  // Monday-Sunday week options for the "Off This Week" modal — the current
  // week plus a run of upcoming ones, so an officer can book someone off
  // ahead of time instead of only acting on whichever week the grid above
  // happens to be scrolled to.
  const OFF_WEEK_OPTIONS_SHOWN = 12;
  const getUpcomingMondayWeeks = () => {
    const anchor = getMondayOfWeek(new Date());
    return Array.from({ length: OFF_WEEK_OPTIONS_SHOWN }, (_, i) => {
      const start = new Date(anchor);
      start.setDate(start.getDate() + i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { start, end };
    });
  };

  const handleApplyOffWeek = async (weekStart) => {
    if (!selectedStaffId) return;

    const dates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });

    setApplyingRule(true);
    try {
      const { error: bulkError } = await bulkSetStaffAvailability(departmentId, selectedStaffId, dates, false, offWeekLeaveTypeId || null);
      if (bulkError) throw bulkError;

      setShowOffWeekModal(false);
      setOffWeekLeaveTypeId('');
      await loadAvailability();
      setError(null);
    } catch (err) {
      setError(`Failed to mark week off: ${err.message}`);
    } finally {
      setApplyingRule(false);
    }
  };

  const handleClearFutureUnavailability = async () => {
    if (!selectedStaffId) return;
    if (!window.confirm(`Clear all standing days off, leave, and unavailable days for ${selectedStaff?.name || 'this staff member'} from today onward (next ${MATERIALIZATION_MONTHS_AHEAD} months)? Days they've explicitly marked available are left untouched.`)) {
      return;
    }

    setApplyingRule(true);
    try {
      const { start, end } = getMaterializationWindow();
      const { error: clearError } = await clearStaffUnavailabilityRange(selectedStaffId, start, end);
      if (clearError) throw clearError;

      await loadAvailability();
      setError(null);
    } catch (err) {
      setError(`Failed to clear unavailability: ${err.message}`);
    } finally {
      setApplyingRule(false);
    }
  };

  const goToPreviousMonth = () => {
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() - DAYS_SHOWN);
    setWeekStartDate(d);
  };

  const goToNextMonth = () => {
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() + DAYS_SHOWN);
    setWeekStartDate(d);
  };

  const selectedStaff = staffList.find(s => s.staff_id === selectedStaffId);
  const currentFte = fteOverrides[selectedStaffId] ?? selectedStaff?.fte ?? DEFAULT_FTE;
  const currentPayrollNumber = payrollNumberOverrides[selectedStaffId] ?? selectedStaff?.payroll_number ?? '';
  const currentPositionId = positionIdOverrides[selectedStaffId] ?? selectedStaff?.position_id ?? '';
  const currentCostCentre = costCentreOverrides[selectedStaffId] ?? selectedStaff?.cost_centre ?? '';
  const availableDaysCount = days.filter(d => getAvailabilityState(availabilityMap, toDateStr(d)) === 'available').length;
  const compliance = computeAvailabilityCompliance(availableDaysCount, days.length, currentFte);
  const complianceStyle = COMPLIANCE_STYLES[compliance.status];

  return (
    <>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-semibold text-gray-600 uppercase">Staff Member</label>
          <div className="flex gap-3">
            <button
              onClick={() => setShowAddStaff(!showAddStaff)}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800"
            >
              {showAddStaff ? 'Cancel' : '+ Add Staff'}
            </button>
            {selectedStaffId && (
              selectedStaff?.active === false ? (
                <button
                  onClick={handleReactivateStaff}
                  disabled={savingStaff}
                  className="text-xs font-semibold text-green-600 hover:text-green-800 disabled:opacity-50"
                >
                  Reactivate
                </button>
              ) : (
                <button
                  onClick={handleDeactivateStaff}
                  disabled={savingStaff}
                  className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  Deactivate
                </button>
              )
            )}
          </div>
        </div>

        {showAddStaff && (
          <div className="mb-3 p-3 bg-blue-50 rounded-lg space-y-2">
            <input
              type="text"
              placeholder="Full name"
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <select
              value={newStaffRank}
              onChange={(e) => setNewStaffRank(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {RANK_OPTIONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <input
              type="tel"
              placeholder="Phone (optional)"
              value={newStaffPhone}
              onChange={(e) => setNewStaffPhone(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <button
              onClick={handleCreateStaff}
              disabled={!newStaffName.trim() || savingStaff}
              className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
            >
              Add Staff Member
            </button>
          </div>
        )}

        <select
          value={selectedStaffId}
          onChange={(e) => setSelectedStaffId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {staffList.length === 0 && <option value="">No staff available</option>}
          {staffList.map(s => (
            <option key={s.staff_id} value={s.staff_id}>
              {s.name}{s.rank ? ` (${s.rank})` : ''}{s.active === false ? ' — inactive' : ''}
            </option>
          ))}
        </select>
      </div>

      {selectedStaffId && (
        <>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">FTE</label>
            <select
              value={currentFte}
              onChange={(e) => handleFteChange(e.target.value)}
              disabled={savingFte}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {FTE_OPTIONS.map(f => (
                <option key={f} value={f}>{formatFte(f)} FTE</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Payroll Number</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g., 123456"
                value={currentPayrollNumber}
                onChange={(e) => handlePayrollNumberInput(e.target.value)}
                disabled={savingPayrollNumber}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
              <button
                onClick={handleSavePayrollNumber}
                disabled={savingPayrollNumber}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
              >
                {savingPayrollNumber ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Position ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g., P-001"
                value={currentPositionId}
                onChange={(e) => handlePositionIdInput(e.target.value)}
                disabled={savingPositionId}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
              <button
                onClick={handleSavePositionId}
                disabled={savingPositionId}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
              >
                {savingPositionId ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Cost Centre</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g., CC-100"
                value={currentCostCentre}
                onChange={(e) => handleCostCentreInput(e.target.value)}
                disabled={savingCostCentre}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
              <button
                onClick={handleSaveCostCentre}
                disabled={savingCostCentre}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
              >
                {savingCostCentre ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {!loading && (
            <div className={`mb-4 p-3 rounded-lg border ${complianceStyle.bg} ${complianceStyle.border}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${complianceStyle.dot}`} />
                <p className={`text-sm font-semibold ${complianceStyle.text}`}>
                  {complianceStyle.label} — {availableDaysCount}/{days.length} days available ({Math.round(compliance.availabilityRatio * 100)}%)
                </p>
              </div>
              <p className={`text-xs mt-1 ${complianceStyle.text}`}>
                Required for {formatFte(currentFte)} FTE (5/7 days): ≥{Math.round(compliance.requiredRatio * 100)}% • Target for flexibility: ≥{Math.round(compliance.targetRatio * 100)}%
              </p>
            </div>
          )}

          {/* Standing days off (e.g. "never works Wednesdays") */}
          <div className="mb-4 p-3 border border-gray-200 rounded-lg">
            <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Standing Days Off</p>
            <div className="flex flex-wrap gap-1 mb-2">
              {DAY_LABELS.map((label, dayOfWeek) => (
                <button
                  key={label}
                  onClick={() => toggleRecurringDay(dayOfWeek)}
                  disabled={applyingRule}
                  className={`px-2.5 py-1.5 rounded text-xs font-semibold border transition disabled:opacity-50 ${
                    recurringDays.has(dayOfWeek)
                      ? 'bg-red-600 border-red-600 text-white'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={handleApplyRecurringDays}
              disabled={recurringDays.size === 0 || applyingRule}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition"
            >
              Apply to next {MATERIALIZATION_MONTHS_AHEAD} months
            </button>
          </div>

          {/* Fortnightly pattern (e.g. "only works every second week") */}
          <div className="mb-4 p-3 border border-gray-200 rounded-lg">
            <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Fortnightly Pattern</p>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <label className="text-xs text-gray-600">Starting date (First Week begins that Sunday):</label>
              <input
                type="date"
                value={fortnightlyAnchorDate}
                onChange={(e) => setFortnightlyAnchorDate(e.target.value)}
                disabled={applyingRule}
                className="px-2 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <label className="text-xs text-gray-600">Repeat for:</label>
              <select
                value={fortnightCount}
                onChange={(e) => setFortnightCount(Number(e.target.value))}
                disabled={applyingRule}
                className="px-2 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
              >
                {Array.from({ length: MAX_FORTNIGHT_COUNT - MIN_FORTNIGHT_COUNT + 1 }, (_, i) => MIN_FORTNIGHT_COUNT + i).map(n => (
                  <option key={n} value={n}>{n} fortnights ({n * 2} weeks)</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setShowFortnightlyModal(true)}
              disabled={!fortnightlyAnchorDate || applyingRule}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition"
            >
              Configure Fortnightly Pattern
            </button>
            <p className="text-xs text-gray-500 mt-2">
              Pick which days they regularly work across a 2-week cycle — useful for someone only here for a limited stretch (e.g. a 6-month locum: pick ~13 fortnights).
            </p>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => handleBulkAction('weekdays')}
              disabled={loading}
              className="px-3 py-2 bg-green-100 hover:bg-green-200 text-green-900 font-medium rounded-lg text-xs transition disabled:opacity-50"
            >
              Available Weekdays
            </button>
            <button
              onClick={() => setShowOffWeekModal(true)}
              disabled={loading}
              className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded-lg text-xs transition disabled:opacity-50"
            >
              Off This Week
            </button>
            <button
              onClick={() => handleBulkAction('allMonth')}
              disabled={loading}
              className="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded-lg text-xs transition disabled:opacity-50"
            >
              Available All Month
            </button>
            <button
              onClick={() => setShowLeaveModal(true)}
              disabled={applyingRule}
              className="px-3 py-2 bg-purple-100 hover:bg-purple-200 text-purple-900 font-medium rounded-lg text-xs transition disabled:opacity-50"
            >
              + Add Leave
            </button>
            <button
              onClick={handleClearFutureUnavailability}
              disabled={applyingRule}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg text-xs transition disabled:opacity-50"
            >
              Clear Future Unavailability
            </button>
          </div>

          <div className="flex items-center justify-between mb-3">
            <button onClick={goToPreviousMonth} className="p-2 hover:bg-gray-100 rounded-lg transition">
              <ChevronLeft size={18} />
            </button>
            <p className="text-sm font-semibold text-gray-700">
              {days[0].toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
              {' – '}
              {days[days.length - 1].toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
            <button onClick={goToNextMonth} className="p-2 hover:bg-gray-100 rounded-lg transition">
              <ChevronRight size={18} />
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <Loader size={24} className="text-blue-600 animate-spin mx-auto mb-2" />
              <p className="text-gray-600 text-sm">Loading availability...</p>
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {DAY_LABELS.map(label => (
                <div key={label} className="text-center text-xs font-bold text-gray-600 py-1">
                  {label}
                </div>
              ))}
              {days.map(date => {
                const dateStr = toDateStr(date);
                const state = getAvailabilityState(availabilityMap, dateStr);
                const style = DAY_STATE_STYLES[state];
                const saving = savingDate === dateStr;
                const leaveTypeName = leaveTypes.find(lt => lt.leave_type_id === leaveTypeMap[dateStr])?.name;
                return (
                  <button
                    key={dateStr}
                    onClick={() => handleDayClick(date)}
                    disabled={saving}
                    title={leaveTypeName ? `${style.title} — ${leaveTypeName}` : style.title}
                    className={`aspect-square p-1 rounded-lg font-semibold text-xs transition border-2 disabled:opacity-50 ${style.classes}`}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-xs text-gray-500 mt-3">
            Click a date to cycle {selectedStaff?.name || 'staff'}'s availability: grey = not set, green = available, red = unavailable.
          </p>
        </>
      )}

      {showFortnightlyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Fortnightly Pattern</h2>
                <p className="text-xs text-gray-600 mt-1">
                  Select days {selectedStaff?.name || 'this staff member'} is regularly available.
                </p>
              </div>
              <button onClick={() => setShowFortnightlyModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="overflow-x-auto mb-3">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-2 py-1"></th>
                    {DAY_LABELS.map(label => (
                      <th key={label} className="px-1 py-1 text-xs font-bold text-gray-600 text-center">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {['First Week', 'Second Week'].map((rowLabel, weekIndex) => (
                    <tr key={rowLabel}>
                      <td className="pr-2 py-1 text-xs font-semibold text-gray-700 whitespace-nowrap">{rowLabel}</td>
                      {DAY_LABELS.map((_, dayOfWeek) => {
                        const slot = `${weekIndex}-${dayOfWeek}`;
                        const selected = fortnightlySlots.has(slot);
                        return (
                          <td key={slot} className="p-1 text-center">
                            <button
                              onClick={() => toggleFortnightlySlot(weekIndex, dayOfWeek)}
                              title={selected ? 'Available — click to clear' : 'Not available — click to mark available'}
                              className={`w-9 h-9 rounded text-xs font-bold border-2 transition ${
                                selected ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-gray-300 text-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {selected ? '✓' : ''}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-gray-500 mb-4">
              Unselected days are marked unavailable. Applies from{' '}
              {fortnightlyAnchorDate
                ? new Date(`${fortnightlyAnchorDate}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—'}{' '}
              to{' '}
              {fortnightlyAnchorDate
                ? getFortnightlyEndDate(new Date(`${fortnightlyAnchorDate}T00:00:00`), fortnightCount).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—'}{' '}
              ({fortnightCount} fortnights, {fortnightCount * 2} weeks), repeating every 2 weeks.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setShowFortnightlyModal(false)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium py-2 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyFortnightly}
                disabled={applyingRule}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition"
              >
                Save &amp; Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {showOffWeekModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-gray-900">Off This Week</h2>
              <button onClick={() => setShowOffWeekModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <p className="text-xs text-gray-600 mb-4">
              Pick which Monday–Sunday week {selectedStaff?.name || 'this staff member'} is off — marks all 7 days unavailable.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Leave Type (optional)</label>
              <select
                value={offWeekLeaveTypeId}
                onChange={(e) => setOffWeekLeaveTypeId(e.target.value)}
                disabled={applyingRule}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50"
              >
                <option value="">No leave type — just unavailable</option>
                {leaveTypes.map(lt => (
                  <option key={lt.leave_type_id} value={lt.leave_type_id}>{lt.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto mb-2">
              {getUpcomingMondayWeeks().map(({ start, end }) => (
                <button
                  key={toDateStr(start)}
                  onClick={() => handleApplyOffWeek(start)}
                  disabled={applyingRule}
                  className="w-full text-left px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 transition"
                >
                  {start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  {' – '}
                  {end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </button>
              ))}
            </div>

            {applyingRule && <p className="text-xs text-gray-500">Applying…</p>}
          </div>
        </div>
      )}

      {showLeaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-gray-900">Add Leave</h2>
              <button onClick={() => setShowLeaveModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <p className="text-xs text-gray-600 mb-4">
              Marks {selectedStaff?.name || 'this staff member'} unavailable for every day in this range.
            </p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Start Date</label>
                <input
                  type="date"
                  value={leaveStart}
                  onChange={(e) => setLeaveStart(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">End Date</label>
                <input
                  type="date"
                  value={leaveEnd}
                  onChange={(e) => setLeaveEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowLeaveModal(false)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium py-2 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitLeave}
                disabled={!leaveStart || !leaveEnd || applyingRule}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition"
              >
                Add Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
