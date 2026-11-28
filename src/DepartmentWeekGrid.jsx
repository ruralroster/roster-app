import React, { useEffect, useState } from 'react';
import { Loader } from 'lucide-react';
import { getDepartmentWeek } from './supabaseClient';
import { toLocalDateStr } from './dateUtils';
import { JOB_COLOURS, jobCategoryFor } from './jobColours';
import { siteHue } from './mySites';

// Each location's colour: the roster's own colour for its kind (Emergency
// green, Ward blue, Theatre/Endoscopy cyan, Maternity red, Admin yellow),
// as on the cards; any other location a soft colour of its own, the same
// every week.
function locationColours(name) {
  const c = JOB_COLOURS[jobCategoryFor(name, null)];
  if (c) return { cell: c.card, head: c.box, border: c.border };
  const h = siteHue(name);
  return { cell: `hsl(${h} 70% 96%)`, head: `hsl(${h} 60% 85%)`, border: `hsl(${h} 45% 60%)` };
}

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

// staffRanks: the department's rank rules, to put seniors (a rank that
// needs no supervision) above the dotted line in each cell and juniors
// below.
export default function DepartmentWeekGrid({ departmentId, weekStartStr, dutyTypes = [], myStaffId, staffRanks = [] }) {
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
  // Whoever's on call that day: their name in the on-call colour.
  const onCallOn = (id, date) => data.duties.some(x => x.staff_id === id && x.date === date
    && (dutyTypes.find(d => d.key === x.duty_type)?.counts_as_on_call ?? true));
  const nameCls = (id, date) => `whitespace-nowrap ${mine(id) ? 'font-bold' : ''} ${onCallOn(id, date) ? 'text-fuchsia-700 font-semibold' : mine(id) ? 'text-blue-800' : 'text-gray-800'}`;
  const isSeniorRank = (rank) => staffRanks.find(r => r.rank === rank)?.requires_supervision === false;

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
          {locations.map(([locId, locName]) => {
            const colour = locationColours(locName);
            return (
            <tr key={locId}>
              <td className="sticky left-0 px-2 py-1 border font-semibold whitespace-nowrap align-top" style={{ backgroundColor: colour.head, borderColor: colour.border }}>{locName}</td>
              {days.map(d => {
                const here = cell(worked.filter(b => b.location_id === locId && b.date === d));
                const seniors = here.filter(b => isSeniorRank(b.staff?.rank));
                const juniors = here.filter(b => !isSeniorRank(b.staff?.rank));
                const line = (b) => (
                  <div key={b.assignment_id} className={nameCls(b.staff_id, d)}>
                    {firstName(b.staff?.name)} {brief(b.shifts?.start_time)}–{brief(b.shifts?.end_time)}
                  </div>
                );
                return (
                  <td key={d} className="px-1.5 py-1 border align-top" style={{ backgroundColor: colour.cell, borderColor: colour.border }}>
                    {seniors.map(line)}
                    {seniors.length > 0 && juniors.length > 0 && <div className="my-0.5 border-t border-dashed border-gray-500" />}
                    {juniors.map(line)}
                  </td>
                );
              })}
            </tr>
            );
          })}
          {data.duties.length > 0 && (
            <tr>
              <td className="sticky left-0 bg-fuchsia-50 px-2 py-1 border border-gray-200 font-semibold">On call</td>
              {days.map(d => (
                <td key={d} className="px-1.5 py-1 border border-gray-200 align-top bg-fuchsia-50/40">
                  {data.duties.filter(x => x.date === d).map(x => (
                    <div key={x.duty_id} className={nameCls(x.staff_id, d)}>{dutyLabel(x.duty_type)}: {firstName(x.staff?.name)}</div>
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
