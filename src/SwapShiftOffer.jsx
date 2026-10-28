import React, { useCallback, useEffect, useState } from 'react';
import CollapsibleSection from './CollapsibleSection';
import { supabase } from './supabaseClient';
import { toLocalDateStr } from './dateUtils';

// Variation → "Swap a shift (DR Roster)": put one of your upcoming roster
// shifts on DR Roster's swap marketplace. Only for people who are DR
// Roster doctors in the district of a site linked to this department —
// for anyone else my_roster_swap_shifts returns nothing and this shows
// nothing. The marketplace itself (finding a pairing, the officer's
// approval) is in DR Roster; until a swap is approved, you still work the
// shift. See district-roster's migrations/2026-10-31_swaps.sql.

const DR_ROSTER_URL = 'https://ruralroster.github.io/district-roster/';
const WEEKS_AHEAD = 8;

// Pay fortnights start on Mondays two weeks apart from Mon 25 May 2026
// (district_fortnight_start).
const ANCHOR = new Date(2026, 4, 25);
function fortnightDays(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const offset = Math.floor(Math.round((d - ANCHOR) / 86400000) / 14) * 14;
  return Array.from({ length: 14 }, (_, i) => {
    const day = new Date(ANCHOR);
    day.setDate(day.getDate() + offset + i);
    return toLocalDateStr(day);
  });
}

const dayLabel = (dateStr) =>
  new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
const hhmm = (t) => (t || '').slice(0, 5);

export default function SwapShiftOffer() {
  const [shifts, setShifts] = useState([]);
  const [listing, setListing] = useState(null); // assignment_id being listed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + WEEKS_AHEAD * 7);
    const { data, error } = await supabase.rpc('my_roster_swap_shifts', { p_from: toLocalDateStr(from), p_to: toLocalDateStr(to) });
    // Missing until the DR Roster swaps migration is run: just show nothing.
    if (!error) setShifts(data || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(name, args, done) {
    setBusy(true);
    setError('');
    setMessage('');
    const { error } = await supabase.rpc(name, args);
    setBusy(false);
    if (error) setError(error.message);
    else setMessage(done);
    load();
    return !error;
  }

  if (shifts.length === 0) return null;

  return (
    // Collapsed by default: it sits last on the Variations tab.
    <CollapsibleSection title="Swap a shift (DR Roster)">
      <p className="text-sm text-gray-500 mb-3">
        Can't do a shift? Put it on DR Roster's swap marketplace. A doctor there swaps one of theirs for it, on a day you can
        work, and your officer approves the swap. You still work it unless a swap is approved.{' '}
        <a href={DR_ROSTER_URL} target="_blank" rel="noreferrer" className="text-blue-700 underline">Open DR Roster</a>
      </p>
      {error && <p className="text-sm text-red-700 mb-2">{error}</p>}
      {message && <p className="text-sm text-green-700 mb-2">{message}</p>}
      <ul className="divide-y divide-gray-100">
        {shifts.map(s => (
          <li key={s.assignment_id} className="py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm">
                <span className="font-semibold text-gray-900">{dayLabel(s.date)}</span>{' '}
                <span className="text-gray-700">{s.label} {hhmm(s.start_time)}-{hhmm(s.end_time)}</span>
                {s.listing_id && (
                  <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-900 text-xs font-semibold rounded-full">
                    Up for swap{s.pending_offers > 0 ? ` · ${s.pending_offers} offer${s.pending_offers === 1 ? '' : 's'} with the officer` : ''}
                  </span>
                )}
              </div>
              {s.listing_id ? (
                <button
                  disabled={busy}
                  onClick={() => window.confirm('Take this shift off the swap marketplace?')
                    && run('withdraw_swap_listing', { p_listing_id: s.listing_id }, 'Taken off the marketplace.')}
                  className="text-xs text-gray-600 hover:text-red-700 font-medium flex-shrink-0"
                >
                  Withdraw
                </button>
              ) : listing !== s.assignment_id && (
                <button
                  onClick={() => setListing(s.assignment_id)}
                  className="px-3 py-1 text-xs font-medium rounded border border-blue-600 text-blue-700 hover:bg-blue-50 flex-shrink-0"
                >
                  Offer for swap
                </button>
              )}
            </div>
            {listing === s.assignment_id && !s.listing_id && (
              <ListForm
                shift={s}
                busy={busy}
                onCancel={() => setListing(null)}
                onSubmit={async (args) => {
                  if (await run('list_roster_shift_for_swap', { p_assignment_id: s.assignment_id, ...args },
                    "It's on DR Roster's swap marketplace. You'll hear when someone offers and your officer decides.")) {
                    setListing(null);
                  }
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}

// The days/nights of the shift's pay fortnight you could work in return (at least one: a swap never changes anyone's number
// of shifts).
function ListForm({ shift, busy, onCancel, onSubmit }) {
  const [slots, setSlots] = useState([]);
  const [note, setNote] = useState('');
  const [otherSites, setOtherSites] = useState(false);
  const toggle = (slot) => setSlots(prev => (prev.includes(slot) ? prev.filter(x => x !== slot) : [...prev, slot]));

  return (
    <form
      className="mt-2 p-3 bg-gray-50 rounded-lg space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ p_service_disruption: false, p_slots: [...slots].sort(), p_note: note, p_other_sites: otherSites });
      }}
    >
      <div>
        <p className="text-gray-700">
          Days or nights you could work in return (this pay fortnight): tick at least one. Whoever takes your shift gives you one of
          theirs on one of them, so neither of you ends up with fewer shifts.
        </p>
        <div className="grid gap-x-3 gap-y-1 mt-2 items-center" style={{ gridTemplateColumns: 'auto 3rem 3rem', maxWidth: '20rem' }}>
          <span />
          <span className="text-xs text-gray-500 text-center">Day</span>
          <span className="text-xs text-gray-500 text-center">Night</span>
          {fortnightDays(shift.date).map(d => (
            <React.Fragment key={d}>
              <span className={d === shift.date ? 'font-bold' : ''}>{dayLabel(d)}{d === shift.date && ' (this shift)'}</span>
              {['day', 'night'].map(kind => (
                <input
                  key={kind}
                  type="checkbox"
                  className="justify-self-center"
                  checked={slots.includes(`${d}:${kind}`)}
                  onChange={() => toggle(`${d}:${kind}`)}
                  aria-label={`${dayLabel(d)} ${kind}`}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={otherSites} onChange={(e) => setOtherSites(e.target.checked)} className="mt-1" />
        <span>I'd take a shift in return at another site I'd work at (not just this one)</span>
      </label>
      <label className="block">
        <span className="text-gray-700">Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Family wedding" className="mt-1 w-full px-2 py-1 border border-gray-300 rounded" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || slots.length === 0} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded disabled:opacity-50">
          Offer for swap
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 border border-gray-300 rounded text-gray-700">Cancel</button>
      </div>
    </form>
  );
}
