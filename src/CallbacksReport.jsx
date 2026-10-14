import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader } from 'lucide-react';
import { getDepartmentCallbacks, getDutyTypes } from './supabaseClient';
import { formatClock, formatCallDate, formatDuration, variationFor, VARIATION_KIND_LABEL } from './callbackUtils';
import { toLocalDateStr } from './dateUtils';
import ExportCsvButton from './ExportCsvButton';

const durationMs = c => new Date(c.ended_at) - new Date(c.started_at);

const CSV_COLUMNS = [
  { header: 'Staff Name', value: c => c.staff?.name || '' },
  { header: 'Date', value: c => formatCallDate(c.started_at) },
  { header: 'Type', value: c => VARIATION_KIND_LABEL[c.kind] || 'Callback' },
  { header: 'For', value: c => c.label },
  { header: 'Started', value: c => formatClock(c.started_at) },
  { header: 'Finished', value: c => formatClock(c.ended_at) },
  { header: 'Duration (min)', value: c => Math.round(durationMs(c) / 60000) },
  { header: 'Times Edited', value: c => (c.edited_at ? 'Yes' : '') },
];

// Officer view of every pay variation staff have recorded — callbacks while
// on call and overtime past a rostered shift (times only — patient details
// are never stored; see migrations/2026-10-14_callbacks.sql). A staff member
// deleting their own record after submitting it to payroll also removes it
// from here.
export default function CallbacksReport({ departmentId, refreshKey }) {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 27);
    return toLocalDateStr(d);
  });
  const [toDate, setToDate] = useState(() => toLocalDateStr(new Date()));
  const [rows, setRows] = useState([]);
  const [kindFilter, setKindFilter] = useState('all'); // 'all' | 'callback' | 'overtime'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!departmentId || !fromDate || !toDate) return;
    const load = async () => {
      setLoading(true);
      const [{ data, error: err }, { data: dutyTypes }] = await Promise.all([
        getDepartmentCallbacks(departmentId, new Date(`${fromDate}T00:00:00`), new Date(`${toDate}T00:00:00`)),
        getDutyTypes(departmentId),
      ]);
      setError(err ? `Failed to load callbacks: ${err.message}` : null);
      setRows(data.map(c => ({ ...c, label: variationFor(c, dutyTypes) })));
      setLoading(false);
    };
    load();
  }, [departmentId, fromDate, toDate, refreshKey]);

  const shownRows = kindFilter === 'all' ? rows : rows.filter(c => (c.kind || 'callback') === kindFilter);

  return (
    <>
      <p className="text-xs text-gray-600 mb-4">
        Callbacks (called in while on call) and overtime (stayed back past a rostered shift) recorded by staff from their Variation tab. Times only — patient details are never stored by the app.
      </p>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-xs text-gray-600">
          From
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="block mt-1 px-2 py-1 border border-gray-300 rounded" />
        </label>
        <label className="text-xs text-gray-600">
          To
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="block mt-1 px-2 py-1 border border-gray-300 rounded" />
        </label>
        <label className="text-xs text-gray-600">
          Type
          <select value={kindFilter} onChange={e => setKindFilter(e.target.value)} className="block mt-1 px-2 py-1 border border-gray-300 rounded">
            <option value="all">All</option>
            <option value="callback">Callback</option>
            <option value="overtime">Overtime</option>
          </select>
        </label>
        <div className="ml-auto">
          <ExportCsvButton filename={`pay_variations_${fromDate}_${toDate}.csv`} columns={CSV_COLUMNS} rows={shownRows} />
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-4"><Loader size={20} className="animate-spin mx-auto" /></div>
      ) : shownRows.length === 0 ? (
        <p className="text-sm text-gray-500">No variations recorded in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Staff Name</th>
                <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Date</th>
                <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Type</th>
                <th className="text-left px-3 py-2 border border-gray-300 font-semibold">For</th>
                <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Time</th>
                <th className="text-right px-3 py-2 border border-gray-300 font-semibold">Duration</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map(c => (
                <tr key={c.callback_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 border border-gray-300 font-medium">{c.staff?.name}</td>
                  <td className="px-3 py-2 border border-gray-300">{formatCallDate(c.started_at)}</td>
                  <td className="px-3 py-2 border border-gray-300">{VARIATION_KIND_LABEL[c.kind] || 'Callback'}</td>
                  <td className="px-3 py-2 border border-gray-300">{c.label}</td>
                  <td className="px-3 py-2 border border-gray-300">
                    {formatClock(c.started_at)}–{formatClock(c.ended_at)}
                    {c.edited_at && <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-800 text-xs rounded" title="Times corrected by the staff member after recording">edited</span>}
                  </td>
                  <td className="px-3 py-2 border border-gray-300 text-right">{formatDuration(durationMs(c))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
