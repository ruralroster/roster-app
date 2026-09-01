import React, { useState, useEffect } from 'react';
import { X, Loader, AlertCircle } from 'lucide-react';
import { getStaffAssignmentsForWeek } from './supabaseClient';
import { toLocalDateStr } from './dateUtils';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getMondayOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

// Three weeks (the violation's week, plus one either side) of just this one
// person's own shifts — a quick "what's actually going on around this
// violation" view, without leaving the Rule Violations report and losing
// its date range/results (see officer-roster-view-supabase.jsx's
// ruleCheckState — that already survives navigation, this modal is the
// other half: investigate without navigating away at all, only jumping
// into Fortnight view once a specific day is actually picked).
export default function InvestigateViolationModal({ staffId, staffName, centerDate, onClose, onOpenDay }) {
  const [weeks, setWeeks] = useState(null); // [{ weekStart, byDate: Map(dateStr -> assignment[]) }]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const centerMonday = getMondayOfWeek(new Date(`${centerDate}T00:00:00`));
        const weekStarts = [-7, 0, 7].map(offset => {
          const d = new Date(centerMonday);
          d.setDate(d.getDate() + offset);
          return d;
        });

        const results = await Promise.all(weekStarts.map(ws => getStaffAssignmentsForWeek(staffId, ws)));
        const failed = results.find(r => r.error);
        if (failed) throw failed.error;

        setWeeks(weekStarts.map((weekStart, i) => {
          const byDate = new Map();
          results[i].data.forEach(a => {
            if (!byDate.has(a.date)) byDate.set(a.date, []);
            byDate.get(a.date).push(a);
          });
          return { weekStart, byDate };
        }));
      } catch (err) {
        setError(`Failed to load shifts: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [staffId, centerDate]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-3xl max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{staffName}</h2>
            <p className="text-sm text-gray-500">Week before, the violation's week, and the week after — click a day to open it</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="w-3 h-3 rounded border-2 border-green-300 bg-green-50" /> Working
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="w-3 h-3 rounded border-2 border-gray-200 bg-white" /> Not working
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="w-3 h-3 rounded border-2 border-gray-200 bg-white ring-2 ring-red-500 ring-offset-1" /> The violation
              </span>
            </div>
          </div>
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
        ) : weeks && (
          <div className="space-y-4">
            {weeks.map(({ weekStart, byDate }, weekIndex) => (
              <div key={weekIndex}>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">
                  {weekIndex === 0 ? 'Week before' : weekIndex === 1 ? 'Week of the violation' : 'Week after'}
                </p>
                <div className="grid grid-cols-7 gap-2">
                  {Array.from({ length: 7 }, (_, i) => {
                    const d = new Date(weekStart);
                    d.setDate(d.getDate() + i);
                    const dateStr = toLocalDateStr(d);
                    const isCenter = dateStr === centerDate;
                    const dayAssignments = byDate.get(dateStr) || [];
                    const isWorking = dayAssignments.length > 0;
                    return (
                      <button
                        key={dateStr}
                        onClick={() => onOpenDay(d)}
                        className={`p-2 rounded-lg border-2 text-left transition hover:opacity-80 ${
                          isWorking ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'
                        } ${isCenter ? 'ring-2 ring-red-500 ring-offset-1' : ''}`}
                      >
                        <p className="text-[10px] font-semibold text-gray-500 uppercase">{DAY_LABELS[i]} {d.getDate()}</p>
                        {dayAssignments.length === 0 ? (
                          <p className="text-xs text-gray-400 mt-1">—</p>
                        ) : (
                          dayAssignments.map(a => (
                            <p key={a.assignment_id} className="text-xs text-gray-800 mt-1 truncate" title={`${a.locations?.name} ${a.shifts?.start_time?.slice(0, 5)}-${a.shifts?.end_time?.slice(0, 5)}`}>
                              {a.locations?.name}
                            </p>
                          ))
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
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
