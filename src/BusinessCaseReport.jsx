import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader } from 'lucide-react';
import { supabase } from './supabaseClient';
import { toLocalDateStr } from './dateUtils';
import ExportCsvButton from './ExportCsvButton';

// Reports > Business case: totals per pay fortnight for the case to take
// to other districts (migrations/2026-11-19c_business_case.sql). No names.
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
const range = (min, max) => (min === null || max === null ? '—' : min === max ? String(min) : `${min}–${max}`);

const COLUMNS = [
  { header: 'Pay fortnight from', value: r => r.fortnight_from },
  { header: 'Pay fortnight to', value: r => r.fortnight_to },
  { header: 'Officer rostering hours', value: r => r.officer_rostering_hours },
  { header: 'Administrator rostering hours', value: r => r.admin_rostering_hours },
  { header: 'Staff using the app', value: r => r.active_staff_users },
  { header: 'Shifts rostered', value: r => r.shifts_rostered },
  { header: 'Under 10 hours rest', value: r => r.rest_breaches },
  { header: 'Weekend shifts per person (min)', value: r => r.weekend_shifts_min },
  { header: 'Weekend shifts per person (max)', value: r => r.weekend_shifts_max },
  { header: 'Night shifts per person (min)', value: r => r.night_shifts_min },
  { header: 'Night shifts per person (max)', value: r => r.night_shifts_max },
  { header: 'Overtime logged', value: r => r.overtime_logged },
  { header: 'Callbacks logged', value: r => r.callbacks_logged },
];

export default function BusinessCaseReport({ departmentId, departmentName }) {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 13 * 7);
    return toLocalDateStr(d);
  });
  const [toDate, setToDate] = useState(() => toLocalDateStr(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!departmentId || !fromDate || !toDate) return;
    let cancelled = false;
    setLoading(true);
    supabase.rpc('business_case_report', { p_department_id: departmentId, p_from: fromDate, p_to: toDate })
      .then(({ data, error: rpcError }) => {
        if (cancelled) return;
        setError(rpcError ? rpcError.message : null);
        setRows(data || []);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [departmentId, fromDate, toDate]);

  const total = (key) => rows.reduce((sum, r) => sum + Number(r[key] || 0), 0);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-gray-600">
        Totals per pay fortnight, with no names, for the business case. Rostering hours count only while an officer is actively on the Calendar, Day, Fortnight, Planner or Import screens (not a screen left open); administrators' time is shown separately. "Under 10 hours rest" counts worked shifts that start less than 10 hours after the person's last one (on call and leave left out). The weekend and night ranges are across staff with an FTE: a narrow range means the load is shared evenly.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-600">From
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="block mt-1 px-2 py-1 border border-gray-300 rounded" />
        </label>
        <label className="text-xs text-gray-600">To
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="block mt-1 px-2 py-1 border border-gray-300 rounded" />
        </label>
        <ExportCsvButton filename={`business-case-${(departmentName || 'department').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${fromDate}-to-${toDate}.csv`} columns={COLUMNS} rows={rows} />
        {loading && <Loader size={16} className="animate-spin text-gray-500" />}
      </div>
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2 text-red-800 text-xs">
          <AlertCircle size={16} className="flex-shrink-0" /> {error}
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left">
                {['Pay fortnight', 'Officer hours', 'Staff using it', 'Shifts', 'Under 10 h rest', 'Weekends each', 'Nights each', 'Overtime', 'Callbacks'].map(h => (
                  <th key={h} className="px-2 py-1.5 border border-gray-200 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.fortnight_from}>
                  <td className="px-2 py-1 border border-gray-200 whitespace-nowrap">{fmtDate(r.fortnight_from)}–{fmtDate(r.fortnight_to)}</td>
                  <td className="px-2 py-1 border border-gray-200" title={`Administrators: ${r.admin_rostering_hours} h`}>{r.officer_rostering_hours}</td>
                  <td className="px-2 py-1 border border-gray-200">{r.active_staff_users}</td>
                  <td className="px-2 py-1 border border-gray-200">{r.shifts_rostered}</td>
                  <td className={`px-2 py-1 border border-gray-200 ${r.rest_breaches > 0 ? 'text-red-700 font-semibold' : ''}`}>{r.rest_breaches}</td>
                  <td className="px-2 py-1 border border-gray-200">{range(r.weekend_shifts_min, r.weekend_shifts_max)}</td>
                  <td className="px-2 py-1 border border-gray-200">{range(r.night_shifts_min, r.night_shifts_max)}</td>
                  <td className="px-2 py-1 border border-gray-200">{r.overtime_logged}</td>
                  <td className="px-2 py-1 border border-gray-200">{r.callbacks_logged}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-semibold">
                <td className="px-2 py-1 border border-gray-200">Total</td>
                <td className="px-2 py-1 border border-gray-200">{Math.round(total('officer_rostering_hours') * 10) / 10}</td>
                <td className="px-2 py-1 border border-gray-200">—</td>
                <td className="px-2 py-1 border border-gray-200">{total('shifts_rostered')}</td>
                <td className="px-2 py-1 border border-gray-200">{total('rest_breaches')}</td>
                <td className="px-2 py-1 border border-gray-200">—</td>
                <td className="px-2 py-1 border border-gray-200">—</td>
                <td className="px-2 py-1 border border-gray-200">{total('overtime_logged')}</td>
                <td className="px-2 py-1 border border-gray-200">{total('callbacks_logged')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
