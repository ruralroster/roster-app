import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Loader, Plus, Minus, X } from 'lucide-react';
import {
  getJobTypesAndPlaces,
  getPlannerRange,
  createPlannerCard,
  deleteTheatreActivity,
  bookPlannerPlace,
  deleteStaffAssignment,
  setPlannerVisitor,
  deletePlannerVisitor,
  updateDutyAssignment,
  applyWeekTemplate,
  saveWeekAsTemplate,
  getWeekTemplates,
} from './supabaseClient';
import { getMondayOfWeek } from './payrollExport';
import { toLocalDateStr } from './dateUtils';
import { DEFAULT_FTE } from './availabilityUtils';
import { jobCategoryFor, jobCardStyle, jobBoxStyle, holdsOnCallDuty } from './jobColours';
import {
  hhmm, addDays, firstName, jobForCard, isSenior, hasAnySkill, placeMismatch, layOutCard, dayConflict, daysWorked,
} from './plannerUtils';

// ============================================================
// PLANNER — Officer view tab
// ============================================================
//
// Two steps, one week (or more) at a time:
//   1. Lay out jobs — pick a job from the palette (Settings → Jobs), tap
//      the days it runs; or apply a saved week template.
//   2. Fill places — pick a person; the places they can fill light up
//      (grade, skills, not on leave, hours don't clash); tap to book.
// Writes the same theatre_activities / staff_assignments / duty_assignments
// rows the Day and Fortnight views use, so everything else keeps working.
// See migrations/2026-10-18_planner_jobs.sql.

const MAX_WEEKS = 4;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function PlannerTab({ departmentId, refData, onWeekTemplatesChange }) {
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [weeksShown, setWeeksShown] = useState(1);
  const [mode, setMode] = useState('layout'); // 'layout' | 'fill'
  const [jobsData, setJobsData] = useState({ jobTypes: [], places: [], missing: false, loaded: false });
  const [range, setRange] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [staffFilter, setStaffFilter] = useState('all'); // 'all' | 'senior' | 'junior' | rank name
  const [templateIdForWeek, setTemplateIdForWeek] = useState({});
  // Height of the officer view's bottom tab bar, so the people picker can
  // sit just above it.
  const [navHeight, setNavHeight] = useState(64);

  useEffect(() => {
    const nav = document.getElementById('officer-bottom-nav');
    if (!nav) return;
    const measure = () => setNavHeight(nav.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  const numDays = weeksShown * 7;
  const startStr = toLocalDateStr(weekStart);
  const endStr = addDays(startStr, numDays - 1);

  useEffect(() => {
    if (!departmentId) return;
    let cancelled = false;
    getJobTypesAndPlaces(departmentId).then(res => {
      if (cancelled) return;
      if (res.error) setError(`Failed to load jobs: ${res.error.message}`);
      setJobsData({ jobTypes: res.jobTypes, places: res.places, missing: res.missing, loaded: true });
    });
    return () => { cancelled = true; };
  }, [departmentId]);

  useEffect(() => {
    if (!departmentId) return;
    let cancelled = false;
    setLoading(true);
    getPlannerRange(departmentId, weekStart, numDays).then(res => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) { setError(`Failed to load the planner: ${res.error.message}`); return; }
      setRange(res.data);
    });
    return () => { cancelled = true; };
  }, [departmentId, weekStart, numDays, refreshKey]);

  const reload = () => setRefreshKey(k => k + 1);

  // Runs a write, then reloads the grid. Errors land in the banner.
  const run = useCallback(async (label, fn) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res?.error) throw res.error;
      setError(null);
    } catch (err) {
      setError(`${label}: ${err.message}`);
    } finally {
      setBusy(false);
      reload();
    }
  }, []);

  const { jobTypes, places } = jobsData;
  const activeJobs = jobTypes.filter(j => j.active !== false);
  const staffById = useMemo(() => new Map(refData.staff.map(s => [s.staff_id, s])), [refData.staff]);
  const locationName = (id) => refData.locations.find(l => l.location_id === id)?.name || '';
  const activityName = (id) => refData.activities.find(a => a.activity_id === id)?.name || '';
  const dutyTypes = refData.dutyTypes.filter(d => d.active !== false);
  const rankRows = refData.staffRanks;

  const days = Array.from({ length: numDays }, (_, i) => addDays(startStr, i));
  const weeks = Array.from({ length: weeksShown }, (_, w) => days.slice(w * 7, w * 7 + 7));

  const cards = range?.cards || [];
  const assignments = range?.assignments || [];
  const duties = range?.duties || [];
  const unavailable = range?.unavailable || [];
  const visitors = range?.visitors || [];

  const cardById = new Map(cards.map(c => [c.theatre_activity_id, c]));
  const cardTitle = (card, job) => job?.name || `${card.locations?.name || locationName(card.location_id)} · ${activityName(card.activity_id)}`;
  const assignmentLabel = (a) => {
    const card = cardById.get(a.theatre_activity_id);
    return card ? cardTitle(card, jobForCard(card, jobTypes)) : (a.shifts?.name || 'a shift');
  };

  const selectedStaff = selectedStaffId ? staffById.get(selectedStaffId) : null;
  const selectedJob = activeJobs.find(j => j.job_type_id === selectedJobId) || null;
  const roleFor = (staff) => (isSenior(staff, rankRows) ? 'consultant' : 'registrar');

  // ---------- writes ----------

  const addJobToDay = (dateStr) => {
    if (!selectedJob) return;
    run(`Couldn't add ${selectedJob.name}`, () => createPlannerCard(departmentId, dateStr, selectedJob));
  };

  const removeCard = (card, job, bookedCount) => {
    const when = new Date(`${card.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    const msg = bookedCount
      ? `Remove ${cardTitle(card, job)} on ${when}? The ${bookedCount} ${bookedCount === 1 ? 'person' : 'people'} booked on it will be taken off.`
      : `Remove ${cardTitle(card, job)} on ${when}?`;
    if (!window.confirm(msg)) return;
    run("Couldn't remove the job", () => deleteTheatreActivity(card.theatre_activity_id, departmentId, card.date, card.location_id));
  };

  const book = (card, job, placeId) => {
    if (!selectedStaff) return;
    run(`Couldn't book ${selectedStaff.name}`, () => bookPlannerPlace(departmentId, card, selectedStaff.staff_id, placeId, roleFor(selectedStaff), job?.name));
  };

  const unbook = (a, card, job) => {
    if (!window.confirm(`Take ${a.staff?.name || 'this person'} off ${cardTitle(card, job)}?`)) return;
    run("Couldn't remove the booking", () => deleteStaffAssignment(a.assignment_id));
  };

  const editVisitor = (card, place, slot, existing) => {
    const name = window.prompt(
      existing ? `Visitor for ${place.role} — change the name, or clear it to remove:` : `Visiting ${place.role}'s name:`,
      existing?.name || '',
    );
    if (name === null) return;
    if (!name.trim()) {
      if (existing) run("Couldn't remove the visitor", () => deletePlannerVisitor(existing.visitor_id));
      return;
    }
    run("Couldn't save the visitor", () => setPlannerVisitor(departmentId, card.theatre_activity_id, place.place_id, slot.index, name));
  };

  const setDuty = (dateStr, dutyType, holder) => {
    if (selectedStaff) {
      if (holder && holder.staff_id === selectedStaff.staff_id) return;
      if (holder && !window.confirm(`Replace ${holder.staff?.name} with ${selectedStaff.name} for ${dutyType.label}?`)) return;
      run(`Couldn't put ${selectedStaff.name} on ${dutyType.label}`, () => updateDutyAssignment(departmentId, new Date(`${dateStr}T00:00:00`), dutyType.key, selectedStaff.staff_id));
    } else if (holder) {
      if (!window.confirm(`Take ${holder.staff?.name} off ${dutyType.label}?`)) return;
      run("Couldn't clear the slot", () => updateDutyAssignment(departmentId, new Date(`${dateStr}T00:00:00`), dutyType.key, null));
    }
  };

  const applyTemplate = (weekDays) => {
    const templateId = templateIdForWeek[weekDays[0]];
    if (!templateId) return;
    run("Couldn't apply the template", () => applyWeekTemplate(departmentId, new Date(`${weekDays[0]}T00:00:00`), templateId));
  };

  const saveTemplate = async (weekDays) => {
    const weekCards = cards.filter(c => c.date >= weekDays[0] && c.date <= weekDays[6]);
    if (weekCards.length === 0) { setError('That week has no jobs to save.'); return; }
    const name = window.prompt('Name for the new week template:');
    if (!name || !name.trim()) return;
    await run("Couldn't save the template", async () => {
      const res = await saveWeekAsTemplate(departmentId, name, new Date(`${weekDays[0]}T00:00:00`),
        weekCards.map(c => ({ ...c, jobTypeId: jobForCard(c, jobTypes)?.job_type_id || null })));
      if (!res.error) {
        const list = await getWeekTemplates(departmentId);
        if (!list.error) onWeekTemplatesChange?.(list.data);
      }
      return res;
    });
  };

  // ---------- render helpers ----------

  const conflictFor = (staffId, card) => dayConflict({
    staffId, dateStr: card.date, startTime: card.start_time, endTime: card.end_time,
    cardId: card.theatre_activity_id, assignments, unavailable, cardLabel: assignmentLabel,
  });

  const dutyKeysFor = (staffId, dateStr) => duties.filter(d => d.staff_id === staffId && d.date === dateStr).map(d => d.duty_type);

  const namePill = (staffId, name, category, dateStr, extraClass = '') => (
    <span
      className={`inline-block max-w-full truncate px-1.5 py-0.5 rounded text-xs font-medium ${extraClass}`}
      style={jobBoxStyle(category, holdsOnCallDuty(dutyKeysFor(staffId, dateStr), refData.dutyTypes))}
    >
      {firstName(name)}
    </span>
  );

  const renderSlot = (card, job, category, { place, slot }) => {
    const key = `${place.place_id}-${slot.index}`;
    if (slot.assignment) {
      const a = slot.assignment;
      return (
        <button
          key={key}
          disabled={mode !== 'fill' || busy}
          onClick={() => unbook(a, card, job)}
          className={`block w-full text-left ${selectedStaffId === a.staff_id ? 'ring-2 ring-gray-900 rounded' : ''}`}
          title={mode === 'fill' ? `${a.staff?.name} — tap to remove` : a.staff?.name}
        >
          {namePill(a.staff_id, a.staff?.name, category, card.date)}
        </button>
      );
    }
    if (slot.visitor) {
      return (
        <button
          key={key}
          disabled={mode !== 'fill' || busy}
          onClick={() => editVisitor(card, place, slot, slot.visitor)}
          className="block w-full text-left text-xs italic text-gray-700 truncate"
          title="Visitor — tap to change"
        >
          {slot.visitor.name}
        </button>
      );
    }

    // Empty place.
    const base = 'block w-full text-left px-1.5 py-0.5 rounded border border-dashed text-xs truncate transition';
    if (mode !== 'fill') {
      return <span key={key} className={`${base} border-gray-400 text-gray-500`}>{place.role}</span>;
    }
    if (selectedStaff) {
      const reason = placeMismatch(place, selectedStaff, rankRows) || conflictFor(selectedStaff.staff_id, card);
      if (!reason) {
        return (
          <button
            key={key}
            disabled={busy}
            onClick={() => book(card, job, place.place_id)}
            className={`${base} border-green-600 bg-green-100 text-green-900 font-semibold hover:bg-green-200`}
            title={`Book ${selectedStaff.name} as ${place.role}`}
          >
            + {place.role}
          </button>
        );
      }
      if (place.kind === 'staff') {
        return <span key={key} className={`${base} border-gray-300 text-gray-400`} title={reason}>{place.role}</span>;
      }
    }
    if (place.kind !== 'staff') {
      return (
        <button
          key={key}
          disabled={busy}
          onClick={() => editVisitor(card, place, slot, null)}
          className={`${base} border-amber-500 text-amber-800 hover:bg-amber-50`}
          title="Tap to type a visitor's name"
        >
          {place.role}{place.kind === 'visitor' ? ' (visitor)' : ''}
        </button>
      );
    }
    return <span key={key} className={`${base} border-gray-400 text-gray-500`} title="Pick a person below first">{place.role}</span>;
  };

  const renderCard = (card) => {
    const job = jobForCard(card, jobTypes);
    const category = jobCategoryFor(card.locations?.name || locationName(card.location_id), activityName(card.activity_id));
    const cardAssignments = assignments.filter(a => a.theatre_activity_id === card.theatre_activity_id);
    const layout = layOutCard(card, job, places, cardAssignments, visitors.filter(v => v.theatre_activity_id === card.theatre_activity_id), staffById, rankRows);
    const short = layout.needed > 0 && layout.filled < layout.needed;
    const canAddExtra = mode === 'fill' && selectedStaff && !conflictFor(selectedStaff.staff_id, card);

    return (
      <div key={card.theatre_activity_id} className="rounded-lg border p-1.5 space-y-1" style={jobCardStyle(category)}>
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <p className="text-xs font-bold text-gray-900 truncate" title={cardTitle(card, job)}>{cardTitle(card, job)}</p>
            <p className="text-[10px] text-gray-600">
              {hhmm(card.start_time)}–{hhmm(card.end_time)}
              {layout.needed > 0 && (
                <span className={`ml-1 font-semibold ${short ? 'text-red-700' : 'text-green-700'}`}>{layout.filled}/{layout.needed}</span>
              )}
              {!job && <span className="ml-1 italic">not a job</span>}
            </p>
          </div>
          {mode === 'layout' && (
            <button
              onClick={() => removeCard(card, job, cardAssignments.length)}
              disabled={busy}
              className="p-0.5 text-gray-500 hover:text-red-600 flex-shrink-0"
              aria-label={`Remove ${cardTitle(card, job)}`}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {layout.places.map(p => (
          <div key={p.place.place_id} className="space-y-0.5">
            {p.slots.map(slot => renderSlot(card, job, category, { place: p.place, slot }))}
          </div>
        ))}
        {layout.extras.length > 0 && (
          <div className="flex flex-wrap gap-0.5 pt-0.5 border-t border-black/10">
            {layout.extras.map(a => (
              <button
                key={a.assignment_id}
                disabled={mode !== 'fill' || busy}
                onClick={() => unbook(a, card, job)}
                className={selectedStaffId === a.staff_id ? 'ring-2 ring-gray-900 rounded' : ''}
                title={`${a.staff?.name}${job ? ' (extra)' : ''}${mode === 'fill' ? ' — tap to remove' : ''}`}
              >
                {namePill(a.staff_id, a.staff?.name, category, card.date)}
              </button>
            ))}
          </div>
        )}
        {canAddExtra && (
          <button
            onClick={() => book(card, job, null)}
            disabled={busy}
            className="w-full text-[10px] text-green-800 border border-green-500 rounded hover:bg-green-50"
            title={`Add ${selectedStaff.name} on top of the places`}
          >
            + extra
          </button>
        )}
      </div>
    );
  };

  const renderDuties = (dateStr) => {
    if (dutyTypes.length === 0) return null;
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-1.5 space-y-0.5">
        {dutyTypes.map(dt => {
          const holder = duties.find(d => d.date === dateStr && d.duty_type === dt.key);
          const label = dt.abbreviation || dt.label;
          let eligible = false;
          let reason = null;
          if (mode === 'fill' && selectedStaff) {
            if (unavailable.some(u => u.staff_id === selectedStaff.staff_id && u.date === dateStr)) reason = 'Unavailable';
            else if (!hasAnySkill(selectedStaff, dt.required_advanced_skills)) reason = 'Missing the skill';
            else if (holder?.staff_id === selectedStaff.staff_id) reason = 'Already on it';
            eligible = !reason;
          }
          const clickable = mode === 'fill' && (eligible || (!selectedStaff && holder));
          return (
            <button
              key={dt.key}
              disabled={!clickable || busy}
              onClick={() => setDuty(dateStr, dt, holder)}
              title={reason || dt.label}
              className={`w-full flex items-center justify-between gap-1 text-left text-[11px] rounded px-1 ${eligible ? 'bg-fuchsia-100 ring-1 ring-fuchsia-500' : ''}`}
            >
              <span className={`truncate ${dt.counts_as_on_call ? 'text-fuchsia-800 font-semibold' : 'text-gray-600'}`}>{label}</span>
              {holder
                ? <span className={`truncate font-medium text-gray-900 ${selectedStaffId === holder.staff_id ? 'underline' : ''}`}>{firstName(holder.staff?.name)}</span>
                : <span className="text-gray-400">{eligible ? '+ book' : '—'}</span>}
            </button>
          );
        })}
      </div>
    );
  };

  // ---------- page ----------

  if (jobsData.loaded && jobsData.missing) {
    return (
      <div className="p-4 pb-24 max-w-3xl mx-auto">
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900">
          The Planner needs the database update in <code>migrations/2026-10-18_planner_jobs.sql</code>. Run it in the Supabase SQL Editor, then reload the app.
        </div>
      </div>
    );
  }

  const activeStaff = refData.staff.filter(s => s.active !== false);
  const filteredStaff = activeStaff.filter(s => {
    if (staffFilter === 'all') return true;
    if (staffFilter === 'senior') return isSenior(s, rankRows);
    if (staffFilter === 'junior') return !isSenior(s, rankRows);
    return s.rank === staffFilter;
  });
  const targetDays = (s) => (s.fte ?? DEFAULT_FTE) * 5 * weeksShown;

  return (
    <div className={`p-4 ${mode === 'fill' ? 'pb-72' : 'pb-24'}`}>
      {/* Header: dates, weeks shown, step */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Previous week">
            <ChevronLeft size={22} />
          </button>
          <div className="text-center">
            <p className="text-base font-bold text-gray-900">
              {new Date(`${startStr}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
              {' – '}
              {new Date(`${endStr}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
            <input
              type="date"
              value={startStr}
              onChange={(e) => e.target.value && setWeekStart(getMondayOfWeek(new Date(`${e.target.value}T00:00:00`)))}
              className="mt-0.5 px-2 py-0.5 border border-gray-200 rounded text-xs text-gray-600"
              title="Jumps to the Monday of that week"
            />
          </div>
          <button onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Next week">
            <ChevronRight size={22} />
          </button>
          <div className="flex items-center gap-1 ml-2">
            <button onClick={() => setWeeksShown(n => Math.max(1, n - 1))} disabled={weeksShown === 1} className="p-1.5 border border-gray-300 rounded-lg disabled:opacity-40" aria-label="Show one week fewer">
              <Minus size={14} />
            </button>
            <span className="text-xs text-gray-700 w-14 text-center">{weeksShown} week{weeksShown === 1 ? '' : 's'}</span>
            <button onClick={() => setWeeksShown(n => Math.min(MAX_WEEKS, n + 1))} disabled={weeksShown === MAX_WEEKS} className="p-1.5 border border-gray-300 rounded-lg disabled:opacity-40" aria-label="Add a week">
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm font-semibold">
          <button onClick={() => setMode('layout')} className={`px-4 py-2 ${mode === 'layout' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}>
            1 · Lay out jobs
          </button>
          <button onClick={() => setMode('fill')} className={`px-4 py-2 ${mode === 'fill' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}>
            2 · Fill places
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-600" aria-label="Dismiss"><X size={16} /></button>
        </div>
      )}

      {/* Step 1 palette */}
      {mode === 'layout' && (
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          {activeJobs.length === 0 ? (
            <p className="text-sm text-gray-600">No jobs yet — add them in Settings → Locations &amp; Activities → Jobs (Planner).</p>
          ) : (
            <>
              <p className="text-xs text-gray-600 mb-2">Pick a job, then tap <span className="font-semibold">+</span> on each day it runs.</p>
              <div className="flex flex-wrap gap-1.5">
                {activeJobs.map(job => {
                  const on = job.job_type_id === selectedJobId;
                  const category = jobCategoryFor(locationName(job.location_id), activityName(job.activity_id));
                  return (
                    <button
                      key={job.job_type_id}
                      onClick={() => setSelectedJobId(on ? null : job.job_type_id)}
                      aria-pressed={on}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition ${on ? 'ring-2 ring-blue-600 font-semibold' : ''}`}
                      style={jobCardStyle(category)}
                    >
                      {job.name}
                      <span className="ml-1 text-xs text-gray-600">{hhmm(job.start_time)}–{hhmm(job.end_time)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {loading && !range ? (
        <div className="text-center py-10"><Loader size={24} className="animate-spin mx-auto text-gray-400" /></div>
      ) : (
        weeks.map(weekDays => (
          <div key={weekDays[0]} className="bg-white rounded-lg shadow-sm p-3 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="text-sm font-semibold text-gray-800">
                Week of {new Date(`${weekDays[0]}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                {(loading || busy) && <Loader size={14} className="inline ml-2 animate-spin text-gray-400" />}
              </p>
              {mode === 'layout' && (
                <div className="flex flex-wrap items-center gap-2">
                  {refData.weekTemplates.length > 0 && (
                    <>
                      <select
                        value={templateIdForWeek[weekDays[0]] || ''}
                        onChange={(e) => setTemplateIdForWeek(prev => ({ ...prev, [weekDays[0]]: e.target.value }))}
                        className="px-2 py-1 border border-gray-300 rounded text-xs"
                        aria-label="Week template"
                      >
                        <option value="">Template…</option>
                        {refData.weekTemplates.map(t => <option key={t.week_template_id} value={t.week_template_id}>{t.name}</option>)}
                      </select>
                      <button
                        onClick={() => applyTemplate(weekDays)}
                        disabled={busy || !templateIdForWeek[weekDays[0]]}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded text-xs font-medium"
                      >
                        Apply
                      </button>
                    </>
                  )}
                  <button onClick={() => saveTemplate(weekDays)} disabled={busy} className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded text-xs font-medium">
                    Save week as template
                  </button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <div className="grid grid-cols-7 gap-1.5" style={{ minWidth: '74rem' }}>
                {weekDays.map((dateStr, i) => {
                  const dayCards = cards
                    .filter(c => c.date === dateStr)
                    .sort((a, b) => hhmm(a.start_time).localeCompare(hhmm(b.start_time)) || cardTitle(a, jobForCard(a, jobTypes)).localeCompare(cardTitle(b, jobForCard(b, jobTypes))));
                  const isToday = dateStr === toLocalDateStr(new Date());
                  const offToday = selectedStaff && unavailable.some(u => u.staff_id === selectedStaff.staff_id && u.date === dateStr);
                  return (
                    <div key={dateStr} className={`space-y-1.5 min-w-0 ${offToday ? 'opacity-50' : ''}`}>
                      <p className={`text-xs font-semibold text-center py-1 rounded ${isToday ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
                        {DAY_NAMES[i]} {new Date(`${dateStr}T00:00:00`).getDate()}
                        {offToday && ' · away'}
                      </p>
                      {mode === 'layout' && selectedJob && (
                        <button
                          onClick={() => addJobToDay(dateStr)}
                          disabled={busy}
                          className="w-full py-1 border-2 border-dashed border-blue-400 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-50 truncate"
                        >
                          + {selectedJob.name}
                        </button>
                      )}
                      {dayCards.map(renderCard)}
                      {renderDuties(dateStr)}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))
      )}

      {/* Step 2 people picker — pinned above the bottom tabs so it stays in
          reach while scrolling the grid (iPad). */}
      {mode === 'fill' && (
        <div style={{ bottom: navHeight }} className="fixed left-0 right-0 z-30 bg-white border-t border-gray-300 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] p-3">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs" aria-label="Show">
              <option value="all">Everyone</option>
              <option value="senior">Seniors</option>
              <option value="junior">Juniors</option>
              {rankRows.map(r => <option key={r.rule_id} value={r.rank}>{r.rank}</option>)}
            </select>
            <p className="text-xs text-gray-600">
              {selectedStaff
                ? <>Booking <span className="font-semibold text-gray-900">{selectedStaff.name}</span> — green places are theirs to take. Tap their name again to stop.</>
                : 'Pick a person. With nobody picked, tap a name on the grid to remove it, or an amber place to type a visitor.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {filteredStaff.map(s => {
              const worked = daysWorked(s.staff_id, startStr, endStr, assignments, duties);
              const target = targetDays(s);
              const on = s.staff_id === selectedStaffId;
              return (
                <button
                  key={s.staff_id}
                  onClick={() => setSelectedStaffId(on ? null : s.staff_id)}
                  aria-pressed={on}
                  className={`px-2.5 py-1 rounded-full border text-xs transition ${on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-800 hover:border-gray-500'}`}
                  title={`${s.name} (${s.rank || 'no rank'}) — ${worked} of ${target.toFixed(1)} days`}
                >
                  {s.name}
                  <span className={`ml-1 ${on ? 'text-gray-300' : worked > target ? 'text-orange-600 font-semibold' : 'text-gray-500'}`}>
                    {worked}/{Number.isInteger(target) ? target : target.toFixed(1)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
