import React, { useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Download, Loader } from 'lucide-react';
import { supabase } from './supabaseClient';
import { toLocalDateStr } from './dateUtils';
import { getMondayOfWeek } from './payrollExport';
import { buildAssignmentsIcs, downloadTextFile } from './icsExport';
import { crossSiteProblems, rowsForIcs, siteHue } from './mySites';

// The staff app's "All my sites" (Week tab): a fortnight of someone's
// shifts, leave and on call at every Rstar site they're staff at, each in
// its site's colour, with a warning for under 10 hours' rest between
// sites, and a calendar export of all of it (my_rostered_days,
// migrations/2026-11-21_multi_site.sql).
const hhmm = (t) => (t || '').slice(0, 5);
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
};
const dayLabel = (dateStr) => new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
const EXPORT_WEEKS = 12;

const pillStyle = (name) => {
  const h = siteHue(name);
  return { background: `hsl(${h} 70% 94%)`, borderColor: `hsl(${h} 55% 60%)`, color: `hsl(${h} 60% 22%)` };
};

export default function MySitesCalendar({ sites, staffName }) {
  const [from, setFrom] = useState(() => toLocalDateStr(getMondayOfWeek(new Date())));
  const to = addDays(from, 13);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // A day before, for a night that runs into the first morning.
    supabase.rpc('my_rostered_days', { p_from: addDays(from, -1), p_to: to }).then(({ data, error: rpcError }) => {
      if (cancelled) return;
      setError(rpcError ? rpcError.message : null);
      setRows(data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [from, to]);

  const problems = crossSiteProblems(rows).filter(p => p.second.date >= from);
  const days = Array.from({ length: 14 }, (_, i) => addDays(from, i));

  const exportAll = async () => {
    setExporting(true);
    const today = toLocalDateStr(new Date());
    const { data, error: rpcError } = await supabase.rpc('my_rostered_days', { p_from: today, p_to: addDays(today, EXPORT_WEEKS * 7) });
    setExporting(false);
    if (rpcError) { window.alert(`Couldn't export: ${rpcError.message}`); return; }
    const events = rowsForIcs(data || []);
    if (!events.length) { window.alert('Nothing rostered in the next 12 weeks to export.'); return; }
    const name = (staffName || 'my').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadTextFile(`${name}-all-sites-${today}.ics`, 'text/calendar;charset=utf-8', buildAssignmentsIcs(events));
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900">All my sites</h2>
          <p className="text-xs text-gray-500">{dayLabel(from)} – {dayLabel(to)}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {sites.map(s => (
              <span key={s.department_id} className="text-[11px] px-1.5 py-0.5 rounded border" style={pillStyle(s.department_name)}>{s.department_name}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setFrom(addDays(from, -14))} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Previous fortnight"><ChevronLeft size={22} /></button>
          <button onClick={() => setFrom(addDays(from, 14))} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Next fortnight"><ChevronRight size={22} /></button>
        </div>
      </div>

      <button onClick={exportAll} disabled={exporting} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
        {exporting ? <Loader size={16} className="animate-spin" /> : <Download size={16} />}
        Export every site to my calendar (next 12 weeks)
      </button>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2 text-sm text-red-800"><AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{error}</div>
      )}

      {problems.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900 space-y-1">
          <p className="font-semibold flex items-center gap-1"><AlertCircle size={16} /> Under 10 hours' rest between sites</p>
          {problems.map((p, i) => (
            <p key={i} className="text-xs">
              {dayLabel(p.first.date)} {p.first.department_name} {hhmm(p.first.start_time)}–{hhmm(p.first.end_time)}, then {dayLabel(p.second.date)} {p.second.department_name} {hhmm(p.second.start_time)}–{hhmm(p.second.end_time)}{p.overlap ? ' (they overlap)' : ''}. Let both rostering officers know.
            </p>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader className="animate-spin text-gray-400" /></div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm divide-y divide-gray-100">
          {days.map(date => {
            const items = rows.filter(r => r.date === date);
            return (
              <div key={date} className="p-3 flex gap-3">
                <p className="w-24 flex-shrink-0 text-sm font-semibold text-gray-700">{dayLabel(date)}</p>
                <div className="flex-1 space-y-1">
                  {items.length === 0 && <p className="text-sm text-gray-400">—</p>}
                  {items.map(r => (
                    <div key={`${r.kind}-${r.ref_id}`} className="text-sm px-2 py-1 rounded border" style={pillStyle(r.department_name)}>
                      <span className="font-semibold">{r.department_name}</span>
                      {r.kind === 'leave' && <> · {r.leave_code}</>}
                      {r.kind === 'duty' && <> · {r.duty_label}{r.start_time && <> {hhmm(r.start_time)}–{hhmm(r.end_time)}</>}</>}
                      {r.kind === 'shift' && (
                        <> · {hhmm(r.start_time)}–{hhmm(r.end_time)}{r.location_name && <> · {r.location_name}</>}{r.activity_name && <> ({r.activity_name})</>}{r.on_call && ' · on call'}</>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
