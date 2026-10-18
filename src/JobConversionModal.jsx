import React, { useCallback, useEffect, useState } from 'react';
import { X, AlertCircle, Loader, CheckCircle } from 'lucide-react';
import { getCardsWithoutJob, stampJobOnCards, createJobType } from './supabaseClient';
import { groupUnconverted, hhmm } from './plannerUtils';

// ============================================================
// CONVERT TO JOBS — Settings → Jobs (Planner) → "Convert existing…"
// ============================================================
//
// Finds every card (theatre_activities, all dates) and week template
// entry with no job stored, groups them by location + activity + exact
// hours, and lets the officer turn each group into a new job, fold it
// into an existing job at the same location and activity (e.g. odd
// 08:00–18:30 cards into ED Day), or leave it. Converting only sets
// job_type_id — bookings, hours and everything else stay as they are, so
// nobody is lost. Once nothing is left, no card shows "not a job".

const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function JobConversionModal({ departmentId, jobTypes, locations, activities, onJobsChange, onClose }) {
  const [groups, setGroups] = useState(null);
  // key -> { action: 'new' | 'skip' | job_type_id, name }
  const [choices, setChoices] = useState({});
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [doneSummary, setDoneSummary] = useState(null);

  const scan = useCallback(async (currentJobs) => {
    setGroups(null);
    const { data, error: scanError } = await getCardsWithoutJob(departmentId);
    if (scanError) { setError(`Couldn't read the existing cards: ${scanError.message}`); setGroups([]); return; }
    const found = groupUnconverted(data.cards, data.entries, currentJobs, locations, activities);
    setGroups(found);
    setChoices(Object.fromEntries(found.map(g => [g.key, { action: g.matchJobId || 'new', name: g.suggestedName }])));
  }, [departmentId, locations, activities]);

  useEffect(() => { scan(jobTypes); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- scan once on open; re-scanned explicitly after converting

  const locName = (id) => locations.find(l => l.location_id === id)?.name || 'Unknown location';
  const actName = (id) => activities.find(a => a.activity_id === id)?.name || 'Unknown activity';
  const setChoice = (key, patch) => setChoices(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const toConvert = (groups || []).filter(g => choices[g.key]?.action !== 'skip');
  const cardsToConvert = toConvert.reduce((n, g) => n + g.cardIds.length, 0);

  const problem = (() => {
    const names = new Set(jobTypes.map(j => j.name.trim().toLowerCase()));
    for (const g of toConvert) {
      const c = choices[g.key];
      if (c.action !== 'new') continue;
      const name = (c.name || '').trim().toLowerCase();
      if (!name) return `Give every new job a name (${locName(g.location_id)} · ${actName(g.activity_id)} ${g.start_time}–${g.end_time}).`;
      if (names.has(name)) return `Two jobs would be called "${c.name.trim()}" — job names must be different.`;
      names.add(name);
    }
    return null;
  })();

  const handleConvert = async () => {
    if (problem) { setError(problem); return; }
    setRunning(true);
    setError(null);
    let jobs = [...jobTypes];
    let nextOrder = jobs.reduce((m, j) => Math.max(m, j.sort_order ?? 0), -1) + 1;
    let newJobs = 0;
    let cards = 0;
    try {
      for (let i = 0; i < toConvert.length; i++) {
        const g = toConvert[i];
        const c = choices[g.key];
        setProgress(`${i + 1} of ${toConvert.length}: ${locName(g.location_id)} · ${actName(g.activity_id)} ${g.start_time}–${g.end_time}`);
        let jobTypeId = c.action;
        if (c.action === 'new') {
          const { data, error: createError } = await createJobType(departmentId, {
            name: c.name.trim(), location_id: g.location_id, activity_id: g.activity_id,
            start_time: g.start_time, end_time: g.end_time, sort_order: nextOrder++,
          });
          if (createError) throw new Error(`creating "${c.name.trim()}": ${createError.message}`);
          jobs = [...jobs, data];
          jobTypeId = data.job_type_id;
          newJobs++;
        }
        const { error: stampError } = await stampJobOnCards(jobTypeId, g.cardIds, g.entryIds);
        if (stampError) throw new Error(`linking cards: ${stampError.message}`);
        cards += g.cardIds.length;
      }
    } catch (err) {
      setError(`Stopped partway — ${err.message}. Everything before this point was converted; scan again to carry on.`);
    }
    onJobsChange(jobs);
    setDoneSummary({ newJobs, cards });
    setProgress('');
    setRunning(false);
    scan(jobs);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Convert existing activities to jobs</h2>
            <p className="text-sm text-gray-600">
              Every card that isn't linked to a job yet, grouped by place, activity and hours — past, present and future, plus week templates. Converting only links the card to a job; who's booked and their hours don't change.
            </p>
          </div>
          <button onClick={onClose} disabled={running} className="p-1 hover:bg-gray-100 rounded-lg" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
            <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {doneSummary && (
          <div className="mb-4 p-3 bg-green-50 border border-green-300 rounded-lg text-sm text-green-900">
            Linked {doneSummary.cards} card{doneSummary.cards === 1 ? '' : 's'}{doneSummary.newJobs ? ` and created ${doneSummary.newJobs} new job${doneSummary.newJobs === 1 ? '' : 's'}` : ''}. New jobs have no places yet — add them with each job's Places button.
          </div>
        )}

        {groups === null ? (
          <div className="py-10 text-center text-sm text-gray-500">
            <Loader size={22} className="animate-spin mx-auto mb-2" />
            {progress || 'Reading every card…'}
          </div>
        ) : groups.length === 0 ? (
          <div className="py-8 text-center">
            <CheckCircle size={40} className="mx-auto text-green-600 mb-2" />
            <p className="font-semibold text-gray-900">Every card is a job.</p>
            <p className="text-sm text-gray-600">Nothing in the roster or the week templates shows as "not a job" any more.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-700 mb-3">
              {groups.reduce((n, g) => n + g.cardIds.length, 0)} cards and {groups.reduce((n, g) => n + g.entryIds.length, 0)} template entries in {groups.length} group{groups.length === 1 ? '' : 's'}.
              {' '}Odd hours that are really an existing job (say 08:00–18:30 for ED Day) can go into that job instead — the cards keep their own hours.
            </p>
            <div className="space-y-2">
              {groups.map(g => {
                const c = choices[g.key] || { action: 'new', name: g.suggestedName };
                const sameKindJobs = jobTypes.filter(j => j.location_id === g.location_id && j.activity_id === g.activity_id);
                return (
                  <div key={g.key} className={`p-3 border rounded-lg flex flex-wrap items-center gap-3 ${c.action === 'skip' ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-300'}`}>
                    <div className="flex-1 min-w-[14rem]">
                      <p className="text-sm font-semibold text-gray-900">
                        {locName(g.location_id)} · {actName(g.activity_id)} <span className="font-normal text-gray-600">{g.start_time}–{g.end_time}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {g.cardIds.length > 0 && <>{g.cardIds.length} card{g.cardIds.length === 1 ? '' : 's'}, {fmtDate(g.firstDate)}{g.firstDate !== g.lastDate && ` – ${fmtDate(g.lastDate)}`}</>}
                        {g.cardIds.length > 0 && g.entryIds.length > 0 && ' · '}
                        {g.entryIds.length > 0 && <>{g.entryIds.length} template entr{g.entryIds.length === 1 ? 'y' : 'ies'}</>}
                      </p>
                    </div>
                    <select
                      value={c.action}
                      onChange={(e) => setChoice(g.key, { action: e.target.value })}
                      disabled={running}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                      aria-label="What to do"
                    >
                      <option value="new">New job</option>
                      {sameKindJobs.map(j => (
                        <option key={j.job_type_id} value={j.job_type_id}>
                          Into {j.name} ({hhmm(j.start_time)}–{hhmm(j.end_time)}){j.job_type_id === g.matchJobId ? ' — same hours' : ''}
                        </option>
                      ))}
                      <option value="skip">Leave as is</option>
                    </select>
                    {c.action === 'new' && (
                      <input
                        type="text"
                        value={c.name}
                        onChange={(e) => setChoice(g.key, { name: e.target.value })}
                        disabled={running}
                        className="w-48 px-2 py-1 border border-gray-300 rounded text-sm"
                        aria-label="New job name"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              {running && <span className="text-xs text-gray-600"><Loader size={14} className="inline animate-spin mr-1" />{progress}</span>}
              <button onClick={onClose} disabled={running} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-lg text-sm">
                Close
              </button>
              <button
                onClick={handleConvert}
                disabled={running || toConvert.length === 0}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm"
              >
                Convert {toConvert.length} group{toConvert.length === 1 ? '' : 's'} ({cardsToConvert} card{cardsToConvert === 1 ? '' : 's'})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
