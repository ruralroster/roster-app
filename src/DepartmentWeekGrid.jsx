import React, { useEffect, useState } from 'react';
import { Loader } from 'lucide-react';
import { getDepartmentWeek } from './supabaseClient';
import { toLocalDateStr } from './dateUtils';

// The staff app's Week tab, Whole department: one week, every location
// down the side and every day across, each cell the people there with
// their hours as briefly as possible ("Sam 0800–1700"). Scrolls sideways
// on a phone; on call and leave get their own rows at the bottom.
const brief = (t) => (t || '').slice(0, 5).replace(':', '');
const firstName = (name) => (name || '?').split(' ')[0];
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
};

export default function DepartmentWeekGrid({ departmentId, weekStartStr, dutyTypes = [], myStaffId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    getDepartmentWeek(departmentId, weekStartStr).then(({ data: d, error: e }) => {
      if (cancelled) return;
      setError(e?.message || null);
      setData(d);
    });
    return () => { cancelled = true; };
  }, [departmentId, weekStartStr]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <div className="flex justify-center py-8"><Loader className="animate-spin text-gray-400" /></div>;

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStartStr, i));
  const worked = data.bookings.filter(b => !b.on_call && !b.leave_code);
  const locations = [...new Map(worked.map(b => [b.location_id, b.locations?.name || 'Other'])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  // One line per person per cell, earliest first, the same person once.
  const cell = (rows) => {
    const seen = new Set();
    return rows
      .sort((a, b) => (a.shifts?.start_time || '').localeCompare(b.shifts?.start_time || ''))
      .filter(r => { const k = `${r.staff_id}|${r.shifts?.start_time}`; if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const dutyLabel = (key) => dutyTypes.find(d => d.key === key)?.abbreviation || dutyTypes.find(d => d.key === key)?.label || key;
  const leave = data.bookings.filter(b => b.leave_code);
  const mine = (id) => id === myStaffId;
  const nameCls = (id) => `whitespace-nowrap ${mine(id) ? 'font-bold text-blue-800' : 'text-gray-800'}`;

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
      <table className="text-[11px] border-collapse min-w-max">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 bg-gray-50 px-2 py-1 border border-gray-200 text-left">Where</th>
            {days.map(d => (
              <th key={d} className="px-2 py-1 border border-gray-200 whitespace-nowrap">
                {new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {locations.map(([locId, locName]) => (
            <tr key={locId}>
              <td className="sticky left-0 bg-white px-2 py-1 border border-gray-200 font-semibold whitespace-nowrap align-top">{locName}</td>
              {days.map(d => (
                <td key={d} className="px-1.5 py-1 border border-gray-200 align-top">
                  {cell(worked.filter(b => b.location_id === locId && b.date === d)).map(b => (
                    <div key={b.assignment_id} className={nameCls(b.staff_id)}>
                      {firstName(b.staff?.name)} {brief(b.shifts?.start_time)}–{brief(b.shifts?.end_time)}
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
          {data.duties.length > 0 && (
            <tr>
              <td className="sticky left-0 bg-fuchsia-50 px-2 py-1 border border-gray-200 font-semibold">On call</td>
              {days.map(d => (
                <td key={d} className="px-1.5 py-1 border border-gray-200 align-top bg-fuchsia-50/40">
                  {data.duties.filter(x => x.date === d).map(x => (
                    <div key={x.duty_id} className={nameCls(x.staff_id)}>{dutyLabel(x.duty_type)}: {firstName(x.staff?.name)}</div>
                  ))}
                </td>
              ))}
            </tr>
          )}
          {leave.length > 0 && (
            <tr>
              <td className="sticky left-0 bg-gray-50 px-2 py-1 border border-gray-200 font-semibold">Leave</td>
              {days.map(d => (
                <td key={d} className="px-1.5 py-1 border border-gray-200 align-top text-gray-600">
                  {cell(leave.filter(b => b.date === d)).map(b => (
                    <div key={b.assignment_id} className="whitespace-nowrap">{firstName(b.staff?.name)} {b.leave_code}</div>
                  ))}
                </td>
              ))}
            </tr>
          )}
          {locations.length === 0 && (
            <tr><td colSpan={8} className="px-2 py-4 text-center text-gray-500">Nobody rostered this week.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
