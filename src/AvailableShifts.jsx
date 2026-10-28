import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from './supabaseClient';
import { toLocalDateStr } from './dateUtils';
import { getMondayOfWeek } from './payrollExport';

// Variation → Available Shifts: a 4-week calendar of what you could pick up.
// Purple days have a shift offered for volunteering (the preferred way);
// amber days have a colleague's shift up for swap that you could take, by
// giving them one of yours on a day they said they can work. A day with
// both is purple with an amber dot. Tap a day to see its shifts; List shows
// them all as cards instead.
//
// Swaps here are only "internal" ones, at this department's own site
// (my_department_swaps, district-roster's migrations/
// 2026-11-07_department_swaps_for_rstar.sql); swaps across sites stay in
// DR Roster. Only DR Roster doctors get any; for anyone else, or until that
// migration is run, there are none and only volunteering shows.

const WEEKS = 4;
const DR_ROSTER_URL = 'https://ruralroster.github.io/district-roster/';

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
};
const dayLabel = (dateStr) =>
  new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
const hhmm = (t) => (t || '').slice(0, 5);
// The swap options' labels end "(Rstar)" for roster shifts: obvious here.
const plainLabel = (label) => (label || '').replace(/ \((Rstar|Rostar|roster-app)\)$/, '');

export default function AvailableShifts({ departmentId, opportunities, renderOpportunity, emptyMessage }) {
  const today = toLocalDateStr(new Date());
  const firstMonday = toLocalDateStr(getMondayOfWeek(new Date()));
  const [view, setView] = useState('calendar');
  const [start, setStart] = useState(firstMonday);
  const [selected, setSelected] = useState(null);
  const [swaps, setSwaps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadSwaps = useCallback(async () => {
    if (!departmentId) return;
    const { data, error: rpcError } = await supabase.rpc('my_department_swaps', { p_department_id: departmentId });
    // Missing until the migration is run: just no swaps.
    if (rpcError) console.error('my_department_swaps:', rpcError.message);
    setSwaps(rpcError ? [] : data || []);
  }, [departmentId]);

  useEffect(() => {
    loadSwaps();
  }, [loadSwaps]);

  async function run(name, args, done) {
    setBusy(true);
    setError('');
    setMessage('');
    const { error: rpcError } = await supabase.rpc(name, args);
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else setMessage(done);
    loadSwaps();
  }

  const byDate = useMemo(() => {
    const m = new Map();
    const day = (d) => m.get(d) || m.set(d, { volunteer: [], swaps: [] }).get(d);
    opportunities.forEach(o => day(o.date).volunteer.push(o));
    swaps.forEach(s => day(s.shift_date).swaps.push(s));
    return m;
  }, [opportunities, swaps]);

  // Open on the first day with something, so there's something to see.
  const datesWithShifts = [...byDate.keys()].sort();
  const shownDate = (selected && byDate.has(selected) ? selected : datesWithShifts[0]) || null;
  const shown = shownDate && byDate.get(shownDate);

  const days = Array.from({ length: WEEKS * 7 }, (_, i) => addDays(start, i));
  const rangeLabel = `${new Date(`${start}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${new Date(`${addDays(start, WEEKS * 7 - 1)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;

  const swapRow = (s) => (
    <SwapRow key={s.listing_id} swap={s} busy={busy} run={run} />
  );

  return (
    <>
      <div className="flex justify-end gap-1 mb-3">
        {['calendar', 'list'].map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1 text-sm font-medium rounded-lg border ${view === v ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {v === 'calendar' ? 'Calendar' : 'List'}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      {message && <p className="mb-3 text-sm text-green-700">{message}</p>}

      {view === 'calendar' ? (
        <>
          <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setStart(addDays(start, -WEEKS * 7))}
                disabled={start <= firstMonday}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                aria-label="Earlier weeks"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-sm font-semibold text-gray-900">{rangeLabel}</span>
              <button onClick={() => setStart(addDays(start, WEEKS * 7))} className="p-1 rounded hover:bg-gray-100" aria-label="Later weeks">
                <ChevronRight size={20} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <div key={i} className="text-xs font-semibold text-gray-500 pb-1">{d}</div>
              ))}
              {days.map(d => {
                const info = byDate.get(d);
                const hasVolunteer = !!info?.volunteer.length;
                const hasSwap = !!info?.swaps.length;
                const pending = info && (info.volunteer.some(o => o.already_volunteered) || info.swaps.some(s => s.my_offer_id));
                const past = d < today;
                const colour = hasVolunteer
                  ? 'bg-purple-100 border-purple-400 text-purple-900 font-semibold'
                  : hasSwap
                    ? 'bg-amber-100 border-amber-400 text-amber-900 font-semibold'
                    : 'bg-white border-gray-200 text-gray-700';
                return (
                  <button
                    key={d}
                    onClick={() => setSelected(d)}
                    disabled={past || !info}
                    className={`relative h-11 rounded-lg border text-sm ${colour} ${past ? 'opacity-40' : ''} ${d === shownDate ? 'ring-2 ring-blue-600' : ''}`}
                  >
                    {Number(d.slice(8))}
                    {hasVolunteer && hasSwap && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500" />}
                    {pending && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] leading-none">✓</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-gray-600">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-100 border border-purple-400" /> Volunteer</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-400" /> Swap you could take</span>
              <span>✓ You've asked</span>
            </div>
          </div>

          {!shown ? (
            <div className="bg-white rounded-lg shadow-sm p-6 text-center">
              <p className="text-gray-600">{emptyMessage}</p>
            </div>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">{dayLabel(shownDate)}</h3>
              <div className="space-y-4">
                {shown.volunteer.map(renderOpportunity)}
                {shown.swaps.length > 0 && (
                  <>
                    {shown.volunteer.length > 0 && (
                      <p className="text-xs text-gray-500">Volunteering is preferred, but you could also swap:</p>
                    )}
                    {shown.swaps.map(swapRow)}
                  </>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {opportunities.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-6 text-center">
              <p className="text-gray-600">{emptyMessage}</p>
            </div>
          ) : (
            <div className="space-y-4">{opportunities.map(renderOpportunity)}</div>
          )}
          {swaps.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-gray-700 mt-6 mb-2">Swaps you could take</h3>
              <div className="space-y-4">{swaps.map(swapRow)}</div>
            </>
          )}
        </>
      )}

      {swaps.length === 0 && (
        <p className="text-xs text-gray-500 mt-3">
          On DR Roster? Colleagues' shifts up for swap here show in amber; swaps at other sites are in{' '}
          <a href={DR_ROSTER_URL} target="_blank" rel="noreferrer" className="text-blue-700 underline">DR Roster</a>.
        </p>
      )}
    </>
  );
}

// A colleague's shift up for swap: pick one of yours (on a day they can
// work) to give them in return. The officer approves it in DR Roster.
function SwapRow({ swap: s, busy, run }) {
  const options = s.swap_options || [];
  const [offered, setOffered] = useState('');
  const value = (o) => (o.notice_id ? `n:${o.notice_id}` : `a:${o.assignment_id}`);

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-amber-500">
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm font-medium text-gray-900">{hhmm(s.start_time)} - {hhmm(s.end_time)}</p>
        <div className="px-3 py-1 bg-amber-100 text-amber-900 text-xs font-semibold rounded uppercase">Swap</div>
      </div>
      <h3 className="text-base font-bold text-gray-900 mb-1">{s.lister}'s shift</h3>
      <p className="text-sm text-gray-700 mb-1">{s.shift_label}</p>
      {s.note && <p className="text-sm text-gray-500 mb-1">"{s.note}"</p>}

      {s.my_offer_id ? (
        <>
          <p className="text-sm text-gray-700 mt-3">
            You've offered {s.my_offer_label ? <>your <span className="font-medium">{plainLabel(s.my_offer_label)}</span></> : 'a swap'} in
            return. Waiting for the officer.
          </p>
          <button
            disabled={busy}
            onClick={() => window.confirm('Withdraw your swap offer?')
              && run('withdraw_swap_offer', { p_offer_id: s.my_offer_id }, 'Swap offer withdrawn.')}
            className="w-full mt-2 text-sm text-gray-600 hover:text-red-700 disabled:opacity-50 font-medium py-1"
          >
            Withdraw offer
          </button>
        </>
      ) : (
        <>
          <label className="block text-xs font-semibold text-gray-600 uppercase mt-3 mb-1">You'd give them in return</label>
          <select
            value={offered}
            onChange={(e) => setOffered(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3"
          >
            <option value="">Pick one of your shifts…</option>
            {options.map(o => <option key={value(o)} value={value(o)}>{plainLabel(o.label)}</option>)}
          </select>
          <button
            disabled={busy || !offered}
            onClick={() => {
              const note = window.prompt(`Offer this swap to ${s.lister}? Add a note for the officer if you like.`, '');
              if (note === null) return;
              const [kind, id] = offered.split(':');
              run('offer_for_swap', {
                p_listing_id: s.listing_id,
                p_offered_notice_id: kind === 'n' ? id : null,
                p_offered_assignment_id: kind === 'a' ? id : null,
                p_note: note,
              }, 'Swap offered. The officer will approve or decline it.');
            }}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition"
          >
            Offer swap
          </button>
        </>
      )}
    </div>
  );
}
