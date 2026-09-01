import React, { useState } from 'react';
import { AlertCircle, Loader, X } from 'lucide-react';
import { getEdRuleCheckData } from './supabaseClient';
import { checkEdRuleViolations } from './edRuleChecks';
import { toLocalDateStr } from './dateUtils';

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

export default function RuleViolationsReport({ departmentId }) {
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [violationsByStaff, setViolationsByStaff] = useState(null); // Map staff_id -> violations[]
  const [staffById, setStaffById] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedStaffId, setSelectedStaffId] = useState(null);

  const runCheck = async () => {
    if (!departmentId || !startDate || !endDate) return;

    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await getEdRuleCheckData(departmentId, startDate, endDate);
      if (fetchError) throw fetchError;

      const byId = new Map(data.staff.map(s => [s.staff_id, s]));
      setStaffById(byId);
      setViolationsByStaff(checkEdRuleViolations(data.assignments, byId));
    } catch (err) {
      setError(`Failed to check rules: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const staffList = Array.from(staffById.values()).sort((a, b) => a.name.localeCompare(b.name));
  const selectedStaff = selectedStaffId ? staffById.get(selectedStaffId) : null;
  const selectedViolations = selectedStaffId ? violationsByStaff?.get(selectedStaffId) || [] : [];

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

      {violationsByStaff && staffList.length === 0 && (
        <p className="text-sm text-gray-500">No shifts found in that range.</p>
      )}

      {violationsByStaff && staffList.length > 0 && (
        <>
          <p className="text-xs text-gray-500 mb-2">
            {violationsByStaff.size === 0 ? 'No violations found in this range.' : `${violationsByStaff.size} of ${staffList.length} people have at least one violation.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {staffList.map(person => {
              const count = violationsByStaff.get(person.staff_id)?.length || 0;
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
              {selectedViolations.map((v, i) => (
                <div key={i} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs font-semibold text-red-800 uppercase">{v.rule}</p>
                  <p className="text-sm text-gray-800 mt-0.5">{v.message}</p>
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
