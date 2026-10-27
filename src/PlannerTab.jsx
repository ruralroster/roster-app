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
  renamePlannerVisitor,
  deletePlannerVisitor,
  updateDutyAssignment,
  applyWeekTemplate,
  saveWeekAsTemplate,
  getWeekTemplates,
  getVolunteerOffersForActivities,
  getVolunteerRequestsForActivities,
  createVolunteerOffer,
  setOfferServiceDisruption,
  removeVolunteerOffer,
} from './supabaseClient';
import { offerIsFilled } from './offerEligibility';
import { getMondayOfWeek } from './payrollExport';
import { toLocalDateStr } from './dateUtils';
import { DEFAULT_FTE } from './availabilityUtils';
import { JOB_COLOURS, jobCategoryFor, jobCategoryRank, jobCardStyle, jobBoxStyle, holdsOnCallDuty } from './jobColours';
import {
  hhmm, addDays, firstName, jobForCard, isAdminJob, isSenior, hasAnySkill, placeMismatch, layOutCard, dayConflict, daysWorked,
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
// A short job from today on can be offered for volunteering straight from
// its card (Offer senior / Offer any grade) — the same volunteer_offers
// the Calendar's Volunteering panel shows — and its volunteers accepted
// from the card too.
//
// With singleDate set it's the officer's Day tab: one day, laid out wide,
// stepping a day at a time (onSingleDateChange), no templates.
// See migrations/2026-10-18_planner_jobs.sql.

const MAX_WEEKS = 4;
// A senior place is offered as a consultant shift; a junior or any-grade
// place as a registrar one, which seniors can take too.
const OFFER_LABEL = { consultant: 'senior', registrar: 'any grade' };
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function PlannerTab({ departmentId, refData, onWeekTemplatesChange, singleDate = null, onSingleDateChange }) {
  const singleDay = !!singleDate;
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [weeksShown, setWeeksShown] = useState(1);
  const [mode, setMode] = useState('layout'); // 'layout' | 'fill'
  const [jobsData, setJobsData] = useState({ jobTypes: [], places: [], missing: false, loaded: false });
  const [range, setRange] = useState(null);
  const [offers, setOffers] = useState([]); // volunteer_offers on the cards shown
  const [volunteers, setVolunteers] = useState([]); // volunteer_requests on those cards
  // The offer whose volunteers are being chosen from: { card, job, role, layout }.
  const [volunteerPick, setVolunteerPick] = useState(null);
  const [offerPick, setOfferPick] = useState(null); // the offer dialog: { card, job, role, heldCount, disruption }
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [staffFilter, setStaffFilter] = useState('all'); // 'all' | 'senior' | 'junior' | rank name
  const [staffOnly, setStaffOnly] = useState(true); // hide people with 0 FTE (locums, casuals)
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

  const numDays = singleDay ? 1 : weeksShown * 7;
  const rangeStart = singleDay ? singleDate : weekStart;
  const startStr = toLocalDateStr(rangeStart);
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
    getPlannerRange(departmentId, new Date(`${startStr}T00:00:00`), numDays).then(res => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) { setError(`Failed to load the planner: ${res.error.message}`); return; }
      setRange(res.data);
      const cardIds = (res.data?.cards || []).map(c => c.theatre_activity_id);
      Promise.all([getVolunteerOffersForActivities(cardIds), getVolunteerRequestsForActivities(cardIds)]).then(([offersRes, requestsRes]) => {
        if (cancelled) return;
        const failed = offersRes.error || requestsRes.error;
        if (failed) setError(`Failed to load offers: ${failed.message}`);
        setOffers(offersRes.data || []);
        setVolunteers(requestsRes.data || []);
      });
    });
    return () => { cancelled = true; };
  }, [departmentId, startStr, numDays, refreshKey]);

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
  const todayStr = toLocalDateStr(new Date());
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

  // place is null for a visitor DR Roster added with no place of their own.
  const editVisitor = (card, place, slot, existing) => {
    const label = place?.role || 'extra';
    const name = window.prompt(
      existing ? `Visitor for ${label} — change the name, or clear it to remove:` : `Visiting ${label}'s name:`,
      existing?.name || '',
    );
    if (name === null) return;
    if (!name.trim()) {
      if (existing) run("Couldn't remove the visitor", () => deletePlannerVisitor(existing.visitor_id));
      return;
    }
    if (existing) run("Couldn't save the visitor", () => renamePlannerVisitor(existing.visitor_id, name));
    else run("Couldn't save the visitor", () => setPlannerVisitor(departmentId, card.theatre_activity_id, place.place_id, slot.index, name));
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

  // Opens the offer dialog (offerPick), where the officer can also mark the
  // shift as a service disruption before staff are told about it.
  const offerShift = (card, job, role, heldCount) => setOfferPick({ card, job, role, heldCount, disruption: false });

  const confirmOffer = () => {
    const { card, role, heldCount, disruption } = offerPick;
    setOfferPick(null);
    run("Couldn't offer the shift", () => createVolunteerOffer(departmentId, card.theatre_activity_id, role, heldCount, disruption));
  };

  const toggleDisruption = (card, role, disruption) => {
    run("Couldn't change the offer", () => setOfferServiceDisruption(card.theatre_activity_id, role, disruption));
  };

  const withdrawOffer = (card, job, role) => {
    if (!window.confirm(`Take ${cardTitle(card, job)} (${OFFER_LABEL[role]}) off the volunteering list? Anyone who's volunteered for it will be dropped.`)) return;
    run("Couldn't remove the offer", () => removeVolunteerOffer(card.theatre_activity_id, role));
  };

  // Books the chosen volunteer into an empty place they can fill (else on
  // top as an extra), then takes the offer and its other volunteers off
  // the list — the same as accepting from the old Day view.
  const acceptVolunteer = (request) => {
    const { card, job, role, layout } = volunteerPick;
    const staff = staffById.get(request.staff_id);
    if (!staff) { setError(`${request.staff?.name || 'That volunteer'} isn't an active staff member any more.`); return; }
    const clash = conflictFor(staff.staff_id, card);
    if (clash && !window.confirm(`${staff.name}: ${clash}. Book them on ${cardTitle(card, job)} anyway?`)) return;
    const slotPlace = layout.places.find(({ place, slots }) =>
      place.kind !== 'visitor'
      && (place.grade === 'senior' ? 'consultant' : 'registrar') === role
      && !placeMismatch(place, staff, rankRows)
      && slots.some(slot => !slot.assignment && !slot.visitor));
    setVolunteerPick(null);
    run(`Couldn't book ${staff.name}`, async () => {
      const booked = await bookPlannerPlace(departmentId, card, staff.staff_id, slotPlace?.place.place_id || null, role, job?.name);
      if (booked.error) return booked;
      return removeVolunteerOffer(card.theatre_activity_id, role);
    });
  };

  // ---------- render helpers ----------

  const isAdminCard = (card) => isAdminJob(jobForCard(card, jobTypes)?.name, card.locations?.name || locationName(card.location_id), activityName(card.activity_id));
  const conflictFor = (staffId, card) => dayConflict({
    staffId, dateStr: card.date, startTime: card.start_time, endTime: card.end_time,
    cardId: card.theatre_activity_id, assignments, unavailable, cardLabel: assignmentLabel,
    clashFree: isAdminCard(card),
    isClashFree: (a) => { const c = cardById.get(a.theatre_activity_id); return !!c && isAdminCard(c); },
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
          title={`${slot.visitor.source === 'dr_roster' ? 'From DR Roster' : 'Visitor'} — tap to change`}
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

  const cardCategory = (card) => jobCategoryFor(card.locations?.name || locationName(card.location_id), activityName(card.activity_id));
  const jobCategory = (job) => jobCategoryFor(locationName(job.location_id), activityName(job.activity_id));

  const renderCard = (card) => {
    const job = jobForCard(card, jobTypes);
    const category = cardCategory(card);
    const cardAssignments = assignments.filter(a => a.theatre_activity_id === card.theatre_activity_id);
    const layout = layOutCard(card, job, places, cardAssignments, visitors.filter(v => v.theatre_activity_id === card.theatre_activity_id), staffById, rankRows);
    const short = layout.needed > 0 && layout.filled < layout.needed;
    // Why the picked person can't go on this card at all (busy, away,
    // already on it) — shown in place of "+ extra" so it never just
    // silently disappears.
    const extraBlockedReason = mode === 'fill' && selectedStaff ? conflictFor(selectedStaff.staff_id, card) : null;
    const canAddExtra = mode === 'fill' && selectedStaff && !extraBlockedReason;

    // Offering: empty staff places by the role they'd be offered as, and
    // which roles are already on offer (and not yet taken up).
    const emptyByRole = { consultant: 0, registrar: 0 };
    layout.places.forEach(({ place, slots }) => {
      if (place.kind === 'visitor') return;
      const role = place.grade === 'senior' ? 'consultant' : 'registrar';
      slots.forEach(slot => { if (!slot.assignment && !slot.visitor) emptyByRole[role] += 1; });
    });
    const heldCount = (role) => cardAssignments.filter(a => a.role === role).length;
    const openOffer = (role) => offers.find(o =>
      o.theatre_activity_id === card.theatre_activity_id && o.role === role && !offerIsFilled(o, heldCount(role)));
    const offerRoles = !selectedStaff && card.date >= todayStr
      ? ['consultant', 'registrar'].filter(role => emptyByRole[role] > 0 || openOffer(role))
      : [];

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
        {(layout.extras.length > 0 || layout.extraVisitors.length > 0) && (
          <div className="flex flex-wrap gap-0.5 pt-0.5 border-t border-black/10">
            {layout.extraVisitors.map(v => (
              <button
                key={v.visitor_id}
                disabled={mode !== 'fill' || busy}
                onClick={() => editVisitor(card, null, null, v)}
                className="text-xs italic text-gray-700 truncate"
                title={`${v.source === 'dr_roster' ? 'From DR Roster' : 'Visitor'} (extra)${mode === 'fill' ? ' — tap to change' : ''}`}
              >
                {v.name}
              </button>
            ))}
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
        {extraBlockedReason && (
          <p className="text-[10px] text-gray-500 italic truncate" title={extraBlockedReason}>{extraBlockedReason}</p>
        )}
        {offerRoles.map(role => (openOffer(role) ? (() => {
          const count = volunteers.filter(v => v.theatre_activity_id === card.theatre_activity_id && v.role === role).length;
          return (
            <button
              key={role}
              onClick={() => setVolunteerPick({ card, job, role, layout })}
              disabled={busy}
              className={`w-full text-[10px] font-semibold rounded border ${count > 0 ? 'text-white bg-blue-600 border-blue-700 hover:bg-blue-700' : 'text-blue-900 bg-blue-100 border-blue-400 hover:bg-blue-200'}`}
              title={count > 0 ? 'Tap to pick a volunteer' : 'On the volunteering list — tap to take it off'}
            >
              Offered · {OFFER_LABEL[role]}{openOffer(role).service_disruption ? ' · disruption' : ''}{count > 0 ? ` · ${count} volunteer${count === 1 ? '' : 's'}` : ''}
            </button>
          );
        })() : (
          <button
            key={role}
            onClick={() => offerShift(card, job, role, heldCount(role))}
            disabled={busy}
            className="w-full text-[10px] text-blue-800 border border-blue-500 rounded hover:bg-blue-50"
            title="Put this on the volunteering list and tell staff who can do it"
          >
            Offer {OFFER_LABEL[role]}
          </button>
        )))}
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
    if (staffOnly && !((s.fte ?? DEFAULT_FTE) > 0)) return false;
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
        {singleDay ? (
          <div className="flex items-center gap-2">
            <button onClick={() => onSingleDateChange(new Date(`${addDays(startStr, -1)}T00:00:00`))} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Previous day">
              <ChevronLeft size={22} />
            </button>
            <div className="text-center">
              <p className="text-base font-bold text-gray-900">
                {new Date(`${startStr}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                {(loading || busy) && <Loader size={14} className="inline ml-2 animate-spin text-gray-400" />}
              </p>
              <input
                type="date"
                value={startStr}
                onChange={(e) => e.target.value && onSingleDateChange(new Date(`${e.target.value}T00:00:00`))}
                className="mt-0.5 px-2 py-0.5 border border-gray-200 rounded text-xs text-gray-600"
              />
            </div>
            <button onClick={() => onSingleDateChange(new Date(`${addDays(startStr, 1)}T00:00:00`))} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Next day">
              <ChevronRight size={22} />
            </button>
            {startStr !== todayStr && (
              <button onClick={() => onSingleDateChange(new Date())} className="ml-1 px-2 py-1 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50">
                Today
              </button>
            )}
          </div>
        ) : (
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
        )}
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
              <p className="text-xs text-gray-600 mb-2">
                {singleDay
                  ? <>Pick a job, then tap <span className="font-semibold">+</span> to add it to this day. Whole weeks and templates are on the Planner tab.</>
                  : <>Pick a job, then tap <span className="font-semibold">+</span> on each day it runs.</>}
              </p>
              {/* One row per colour (Emergency, Ward, Theatre, Maternity,
                  then uncoloured), same order as the day columns below. */}
              <div className="space-y-1.5">
                {[...new Set(activeJobs.map(jobCategory))]
                  .sort((a, b) => jobCategoryRank(a) - jobCategoryRank(b))
                  .map(category => (
                  <div key={category || 'other'} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-20 text-[11px] font-semibold text-gray-500 uppercase">{JOB_COLOURS[category]?.label || 'Other'}</span>
                    {activeJobs.filter(job => jobCategory(job) === category).map(job => {
                      const on = job.job_type_id === selectedJobId;
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
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {loading && !range ? (
        <div className="text-center py-10"><Loader size={24} className="animate-spin mx-auto text-gray-400" /></div>
      ) : singleDay ? (
        // One day, wide: on-call first, then the day's jobs in colour order
        // and start time, as many across as fit.
        <div className={`space-y-3 ${selectedStaff && unavailable.some(u => u.staff_id === selectedStaff.staff_id && u.date === startStr) ? 'opacity-50' : ''}`}>
          {mode === 'layout' && selectedJob && (
            <button
              onClick={() => addJobToDay(startStr)}
              disabled={busy}
              className="w-full py-2 border-2 border-dashed border-blue-400 text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-50"
            >
              + {selectedJob.name}
            </button>
          )}
          {dutyTypes.length > 0 && (
            <div className="max-w-sm">{renderDuties(startStr)}</div>
          )}
          {cards.filter(c => c.date === startStr).length === 0 ? (
            <p className="text-sm text-gray-500 italic bg-white rounded-lg shadow-sm p-4">No jobs on this day. Use 1 · Lay out jobs to add some.</p>
          ) : (
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cards
                .filter(c => c.date === startStr)
                .sort((a, b) => jobCategoryRank(cardCategory(a)) - jobCategoryRank(cardCategory(b))
                  || hhmm(a.start_time).localeCompare(hhmm(b.start_time))
                  || cardTitle(a, jobForCard(a, jobTypes)).localeCompare(cardTitle(b, jobForCard(b, jobTypes))))
                .map(renderCard)}
            </div>
          )}
        </div>
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
                    // Grouped by colour, then by start time within each colour.
                    .sort((a, b) => jobCategoryRank(cardCategory(a)) - jobCategoryRank(cardCategory(b))
                      || hhmm(a.start_time).localeCompare(hhmm(b.start_time))
                      || cardTitle(a, jobForCard(a, jobTypes)).localeCompare(cardTitle(b, jobForCard(b, jobTypes))));
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
            <label className="flex items-center gap-1 text-xs text-gray-700 whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
              Staff only
            </label>
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
                  {!singleDay && (
                    <span className={`ml-1 ${on ? 'text-gray-300' : worked > target ? 'text-orange-600 font-semibold' : 'text-gray-500'}`}>
                      {worked}/{Number.isInteger(target) ? target : target.toFixed(1)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {offerPick && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-5 w-full max-w-md">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Offer {cardTitle(offerPick.card, offerPick.job)}</h2>
                <p className="text-sm text-gray-600">
                  {new Date(`${offerPick.card.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {' · '}{OFFER_LABEL[offerPick.role]}
                </p>
              </div>
              <button onClick={() => setOfferPick(null)} className="p-1 hover:bg-gray-100 rounded-lg" aria-label="Close"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-700 mb-3">Staff who can do it and are available that day will be emailed and notified.</p>
            <label className="flex items-start gap-2 text-sm text-gray-800 mb-4">
              <input
                type="checkbox"
                checked={offerPick.disruption}
                onChange={(e) => setOfferPick(p => ({ ...p, disruption: e.target.checked }))}
                className="mt-1"
              />
              <span><span className="font-semibold">Service disruption:</span> if nobody takes this shift, the service closes (for example, obstetrics goes on bypass)</span>
            </label>
            <div className="flex gap-2">
              <button onClick={() => setOfferPick(null)} className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium rounded-lg">Cancel</button>
              <button onClick={confirmOffer} disabled={busy} className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">Offer</button>
            </div>
          </div>
        </div>
      )}

      {volunteerPick && (() => {
        const { card, job, role } = volunteerPick;
        const list = volunteers.filter(v => v.theatre_activity_id === card.theatre_activity_id && v.role === role);
        const offer = offers.find(o => o.theatre_activity_id === card.theatre_activity_id && o.role === role);
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-lg p-5 w-full max-w-md max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{cardTitle(card, job)}</h2>
                  <p className="text-sm text-gray-600">
                    {new Date(`${card.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {' · '}{hhmm(card.start_time)}–{hhmm(card.end_time)} · offered {OFFER_LABEL[role]}
                  </p>
                </div>
                <button onClick={() => setVolunteerPick(null)} className="p-1 hover:bg-gray-100 rounded-lg" aria-label="Close"><X size={20} /></button>
              </div>
              {list.length === 0 ? (
                <p className="text-sm text-gray-500 italic mb-4">Nobody has volunteered yet.</p>
              ) : (
                <ul className="space-y-2 mb-4">
                  {list.map(v => (
                    <li key={v.staff_id} className="flex items-center justify-between gap-2 p-2 border border-gray-200 rounded-lg">
                      <span className="text-sm text-gray-900">
                        <span className="font-medium">{v.staff?.name || 'Unknown'}</span>
                        {v.staff?.rank && <span className="text-gray-500"> · {v.staff.rank}</span>}
                      </span>
                      <button
                        onClick={() => acceptVolunteer(v)}
                        disabled={busy}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg"
                      >
                        Accept
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {offer && (
                <label className="flex items-start gap-2 text-sm text-gray-800 mb-3">
                  <input
                    type="checkbox"
                    checked={!!offer.service_disruption}
                    onChange={(e) => toggleDisruption(card, role, e.target.checked)}
                    disabled={busy}
                    className="mt-1"
                  />
                  <span><span className="font-semibold">Service disruption:</span> if nobody takes this shift, the service closes</span>
                </label>
              )}
              <button
                onClick={() => { setVolunteerPick(null); withdrawOffer(card, job, role); }}
                disabled={busy}
                className="w-full px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium rounded-lg"
              >
                Take it off the volunteering list
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
