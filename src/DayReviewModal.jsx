import React, { useState, useEffect } from 'react';
import { X, Loader, AlertCircle } from 'lucide-react';
import { getStaffAssignmentsForDate, getDutyAssignmentsForDate, getDutyTypes, deleteStaffAssignment, updateDutyAssignment } from './supabaseClient';
import { getSessionGroups, getDepartmentSessionBoundaries } from './shiftSessionUtils';
import { toLocalDateStr } from './dateUtils';

const SESSION_LABEL = { morning: 'AM', afternoon: 'PM', night: 'Night' };

// A read-only-except-Remove view of one day's whole roster — everyone
// working, grouped by location, plus who's on call — without switching to
// Day or Fortnight view to see it. Built for the Rule Violations
// "investigate" flow (see InvestigateViolationModal.jsx): the officer
// wanted exactly the "who's here, remove if needed" panel Fortnight's own
// day modal shows, but WITHOUT the tab switch or the assignment wizard
// that comes with it — this is a lighter, purpose-built standalone
// version rather than reusing that tab-scoped modal.
export default function DayReviewModal({ departmentId, department, date, onClose }) {
  const [assignments, setAssignments] = useState([]);
  const [dutyAssignments, setDutyAssignments] = useState([]);
  const [dutyTypes, setDutyTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  const dateStr = toLocalDateStr(date);
  const sessionBoundaries = getDepartmentSessionBoundaries(department);
  const sessionLabelsForTimes = (shiftLike) => getSessionGroups(shiftLike, sessionBoundaries).map(g => SESSION_LABEL[g]).join('/') || '';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [assignRes, dutyRes, dutyTypesRes] = await Promise.all([
        getStaffAssignmentsForDate(departmentId, date),
        getDutyAssignmentsForDate(departmentId, date),
        getDutyTypes(departmentId),
      ]);
      if (assignRes.error) throw assignRes.error;
      if (dutyRes.error) throw dutyRes.error;
      if (dutyTypesRes.error) throw dutyTypesRes.error;

      setAssignments(assignRes.data || []);
      setDutyAssignments(dutyRes.data || []);
      setDutyTypes(dutyTypesRes.data || []);
    } catch (err) {
      setError(`Failed to load this day: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, dateStr]);

  const handleRemoveAssignment = async (assignmentId) => {
    setRemovingId(assignmentId);
    try {
      const { error: removeError } = await deleteStaffAssignment(assignmentId);
      if (removeError) throw removeError;
      setAssignments(prev => prev.filter(a => a.assignment_id !== assignmentId));
    } catch (err) {
      setError(`Failed to remove: ${err.message}`);
    } finally {
      setRemovingId(null);
    }
  };

  const handleRemoveDuty = async (dutyType) => {
    setRemovingId(dutyType);
    try {
      const { error: removeError } = await updateDutyAssignment(departmentId, date, dutyType, null);
      if (removeError) throw removeError;
      setDutyAssignments(prev => prev.filter(d => d.duty_type !== dutyType));
    } catch (err) {
      setError(`Failed to remove: ${err.message}`);
    } finally {
      setRemovingId(null);
    }
  };

  const byLocation = new Map(); // location name -> assignment[]
  assignments.forEach(a => {
    const locationName = a.locations?.name || 'Unknown location';
    if (!byLocation.has(locationName)) byLocation.set(locationName, []);
    byLocation.get(locationName).push(a);
  });

  const dutyTypeLabel = (key) => dutyTypes.find(dt => dt.key === key)?.label || key;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold text-gray-900">
            {date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
            <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">
            <Loader size={32} className="text-blue-600 animate-spin mx-auto" />
          </div>
        ) : (
          <div className="space-y-4">
            {byLocation.size === 0 && dutyAssignments.length === 0 && (
              <p className="text-sm text-gray-500">Nobody's rostered this day.</p>
            )}

            {Array.from(byLocation.entries()).map(([locationName, people]) => (
              <div key={locationName}>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{locationName}</p>
                <div className="space-y-1">
                  {people.map(a => (
                    <div key={a.assignment_id} className="flex items-center justify-between gap-2 p-2 bg-gray-50 border border-gray-200 rounded-lg">
                      <div className="text-sm">
                        <span className="font-medium text-gray-900">{a.staff?.name}</span>
                        <span className="text-gray-500 capitalize"> · {a.role}</span>
                        <span className="text-gray-400"> · {sessionLabelsForTimes(a.shifts)}</span>
                        {a.on_call && <span className="text-amber-600"> · on call</span>}
                      </div>
                      <button
                        onClick={() => handleRemoveAssignment(a.assignment_id)}
                        disabled={removingId === a.assignment_id}
                        className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 disabled:opacity-50 text-red-800 font-medium rounded transition flex-shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {dutyAssignments.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">On Call</p>
                <div className="space-y-1">
                  {dutyAssignments.map(d => (
                    <div key={d.duty_type} className="flex items-center justify-between gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="text-sm">
                        <span className="font-medium text-gray-900">{d.staff?.name}</span>
                        <span className="text-gray-500"> · {dutyTypeLabel(d.duty_type)}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveDuty(d.duty_type)}
                        disabled={removingId === d.duty_type}
                        className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 disabled:opacity-50 text-red-800 font-medium rounded transition flex-shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full mt-6 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium py-2 rounded-lg"
        >
          Close
        </button>
      </div>
    </div>
  );
}
