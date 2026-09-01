import React, { useState } from 'react';
import { AlertCircle, Loader, X } from 'lucide-react';
import { getEdRuleCheckData, getRuleViolationDismissals, dismissRuleViolation } from './supabaseClient';
import { checkEdRuleViolations, checkEdStaffingLevels } from './edRuleChecks';
import { toLocalDateStr } from './dateUtils';
import ExportCsvButton from './ExportCsvButton';

const CSV_COLUMNS = [
  { header: 'Staff Name', value: r => r.staffName },
  { header: 'Rule', value: r => r.rule },
  { header: 'Message', value: r => r.message },
  { header: 'Dates', value: r => (r.dates || []).join('; ') },
];

// ED-specific hard-rule violation checker (see edRuleChecks.js for exactly
// which rules and why only these ones — the softer "aim for"/"try to"
// goals are deliberately not checked here). Unlike Case Mix/Fairness,
// which have a fixed trailing-12-months window, these rules are about
// shift *sequencing* (night blocks, days off after, spacing between
// blocks) so the officer picks an explicit date range to check — no
// sensible universal default exists.
function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() - 28);
  return toLocalDateStr(d);
}

function defaultEnd() {
  const d = new Date();
  d.setDate(d.getDate() + 28);
  return toLocalDateStr(d);
}

// The officer's own workflow here is "run the check, click Investigate on
// one violation, look at it in Fortnight/Day view, come back and check the
// next one" — so the dates and results need to survive that round trip,
// not just this component's own lifetime. Settings tabs unmount when the
// officer switches to Fortnight/Day view (confirmed 2026-09-01: this is
// nested under activeTab === 'settings', which stops rendering entirely
// on any other tab), so a plain useState here would silently reset every
// time. The officer-roster-view-supabase.jsx parent owns this state
// instead and just passes it straight through.
export function createDefaultRuleCheckState() {
  return {
    startDate: defaultStart(),
    endDate: defaultEnd(),
    violationsByStaff: null, // Map staff_id -> violations[]
    staffingViolations: [], // [{ date, rule, message, key }]
    dismissed: new Set(), // "staffId|violationKey" ('null' for staffing-level)
    staffById: new Map(),
  };
}

// onInvestigate(staffId, dates): open the 3-week investigate modal for that
// person, centered on dates[0]'s week, with every date in `dates`
// highlighted as part of the violation. onInvestigateDate
// (dateStr): jump to Day view for that date — used for staffing-level
// shortfalls, which have no single person to select. `state`/`setState`
// come from the parent — see createDefaultRuleCheckState above.
export default function RuleViolationsReport({ departmentId, state, setState, onInvestigate, onInvestigateDate }) {
  const { startDate, endDate, violationsByStaff, staffingViolations, dismissed, staffById } = state;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [dismissingKey, setDismissingKey] = useState(null);

  const setStartDate = (value) => setState(prev => ({ ...prev, startDate: value }));
  const setEndDate = (value) => setState(prev => ({ ...prev, endDate: value }));

  const runCheck = async () => {
    if (!departmentId || !startDate || !endDate) return;

    setLoading(true);
    setError(null);
    try {
      const [{ data, error: fetchError }, { data: dismissedSet, error: dismissError }] = await Promise.all([
        getEdRuleCheckData(departmentId, startDate, endDate),
        getRuleViolationDismissals(departmentId),
      ]);
      if (fetchError) throw fetchError;
      if (dismissError) throw dismissError;

      const byId = new Map(data.staff.map(s => [s.staff_id, s]));
      setState(prev => ({
        ...prev,
        staffById: byId,
        dismissed: dismissedSet,
        violationsByStaff: checkEdRuleViolations(data.assignments, byId),
        staffingViolations: checkEdStaffingLevels(data.assignments),
      }));
    } catch (err) {
      setError(`Failed to check rules: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const isDismissed = (staffId, key) => dismissed.has(`${staffId || 'null'}|${key}`);

  const handleDismiss = async (staffId, key) => {
    setDismissingKey(key);
    try {
      const { error: dismissError } = await dismissRuleViolation(departmentId, staffId, key);
      if (dismissError) throw dismissError;
      setState(prev => ({ ...prev, dismissed: new Set(prev.dismissed).add(`${staffId || 'null'}|${key}`) }));
      setError(null);
    } catch (err) {
      setError(`Failed to accept violation: ${err.message}`);
    } finally {
      setDismissingKey(null);
    }
  };

  const staffList = Array.from(staffById.values()).sort((a, b) => a.name.localeCompare(b.name));
  const selectedStaff = selectedStaffId ? staffById.get(selectedStaffId) : null;
  const selectedViolations = (selectedStaffId ? violationsByStaff?.get(selectedStaffId) || [] : [])
    .filter(v => !isDismissed(selectedStaffId, v.key));
  const visibleStaffingViolations = staffingViolations.filter(v => !isDismissed(null, v.key));

  // Recount per-person after dismissals, so a fully-dismissed person's name
  // goes back to the neutral/non-clickable state.
  const visibleCountFor = (staffId) => (violationsByStaff?.get(staffId) || []).filter(v => !isDismissed(staffId, v.key)).length;
  const peopleWithViolations = staffList.filter(p => visibleCountFor(p.staff_id) > 0).length;

  const csvRows = violationsByStaff ? [
    ...visibleStaffingViolations.map(v => ({ staffName: '—', rule: v.rule, message: v.message, dates: [v.date] })),
    ...staffList.flatMap(person =>
      (violationsByStaff.get(person.staff_id) || [])
        .filter(v => !isDismissed(person.staff_id, v.key))
        .map(v => ({ staffName: person.name, rule: v.rule, message: v.message, dates: v.dates }))
    ),
  ] : [];

  return (
    <>
      <p className="text-xs text-gray-600 mb-4">
        Checks this department's hard scheduling rules (night-block shape, rest after nights, weekly/fortnightly shift-type caps and minimums) over a date range — not the softer "aim for" goals like weekend pairing, which aren't flagged here. A name in red has at least one violation in the range checked; click it for details.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">From</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">To</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <button
          onClick={runCheck}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm flex items-center gap-2"
        >
          {loading && <Loader size={16} className="animate-spin" />}
          Check Roster
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {violationsByStaff && staffList.length > 0 && (
        <div className="flex justify-end mb-2">
          <ExportCsvButton filename="rule_violations.csv" columns={CSV_COLUMNS} rows={csvRows} />
        </div>
      )}

      {violationsByStaff && staffList.length === 0 && (
        <p className="text-sm text-gray-500">No shifts found in that range.</p>
      )}

      {violationsByStaff && visibleStaffingViolations.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Staffing shortfalls</p>
          <div className="space-y-1">
            {visibleStaffingViolations.map((v) => (
              <div key={v.key} className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-sm flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-amber-900">{v.date}</span>
                  <span className="text-gray-700"> — {v.rule}: {v.message}</span>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  {onInvestigateDate && (
                    <button
                      onClick={() => onInvestigateDate(v.date)}
                      className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 text-xs font-medium rounded transition"
                    >
                      Investigate
                    </button>
                  )}
                  <button
                    onClick={() => handleDismiss(null, v.key)}
                    disabled={dismissingKey === v.key}
                    className="px-2 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-xs font-medium rounded transition"
                  >
                    Accept
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {violationsByStaff && staffList.length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Individual rule violations</p>
          <p className="text-xs text-gray-500 mb-2">
            {peopleWithViolations === 0 ? 'No violations found in this range.' : `${peopleWithViolations} of ${staffList.length} people have at least one violation.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {staffList.map(person => {
              const count = visibleCountFor(person.staff_id);
              return (
                <button
                  key={person.staff_id}
                  onClick={() => count > 0 && setSelectedStaffId(person.staff_id)}
                  disabled={count === 0}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                    count > 0
                      ? 'bg-red-50 border-red-300 text-red-800 hover:bg-red-100 cursor-pointer'
                      : 'bg-gray-50 border-gray-200 text-gray-500 cursor-default'
                  }`}
                >
                  {person.name}{count > 0 ? ` (${count})` : ''}
                </button>
              );
            })}
          </div>
        </>
      )}

      {selectedStaff && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-gray-900">{selectedStaff.name}</h2>
              <button onClick={() => setSelectedStaffId(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              {selectedViolations.length === 0 && (
                <p className="text-sm text-gray-500">All violations for this person have been accepted.</p>
              )}
              {selectedViolations.map((v) => (
                <div key={v.key} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs font-semibold text-red-800 uppercase">{v.rule}</p>
                  <p className="text-sm text-gray-800 mt-0.5">{v.message}</p>
                  <div className="flex gap-1.5 mt-2">
                    {onInvestigate && v.dates?.length > 0 && (
                      <button
                        onClick={() => onInvestigate(selectedStaffId, v.dates)}
                        className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 text-xs font-medium rounded transition"
                      >
                        Investigate
                      </button>
                    )}
                    <button
                      onClick={() => handleDismiss(selectedStaffId, v.key)}
                      disabled={dismissingKey === v.key}
                      className="px-2 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-xs font-medium rounded transition"
                    >
                      Accept
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setSelectedStaffId(null)}
              className="w-full mt-6 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium py-2 rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
