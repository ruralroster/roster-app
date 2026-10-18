// Pure helpers for the Officer view's Planner tab (PlannerTab.jsx) — jobs,
// their places, and who can fill them. See
// migrations/2026-10-18_planner_jobs.sql for the model. Kept free of
// Supabase/React so they can be unit tested.

export const hhmm = (t) => (t || '').slice(0, 5);

const toMinutes = (t) => {
  const [h, m] = hhmm(t).split(':').map(Number);
  return h * 60 + (m || 0);
};

// [start, end) in minutes from midnight at the start of `dateStr`, for a
// start/end time pair on that date — an end at or before the start runs
// overnight into the next day.
export function intervalOn(dateStr, startTime, endTime) {
  const base = Math.round(new Date(`${dateStr}T00:00:00`).getTime() / 60000);
  const start = base + toMinutes(startTime);
  let end = base + toMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return { start, end };
}

export const intervalsOverlap = (a, b) => a.start < b.end && b.start < a.end;

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '?';

// Which job a card is: its stored job_type_id (cards the Planner made),
// otherwise a job with the same location, activity and hours (cards from
// before the Planner existed).
export function jobForCard(card, jobTypes) {
  if (card.job_type_id) {
    const stored = jobTypes.find(j => j.job_type_id === card.job_type_id);
    if (stored) return stored;
  }
  return jobTypes.find(j => j.active !== false
    && j.location_id === card.location_id
    && j.activity_id === card.activity_id
    && hhmm(j.start_time) === hhmm(card.start_time)
    && hhmm(j.end_time) === hhmm(card.end_time)) || null;
}

// The job a newly made card belongs to: an exact match (jobForCard), or
// else the job at the same location and activity whose hours overlap the
// card's the most — so a card made for one person's own hours (an ED
// early 07:00–17:00) still lands in its job (ED Day 08:00–18:00). null
// when nothing at that location and activity overlaps at all.
export function bestJobForNewCard(card, jobTypes) {
  const exact = jobForCard({ ...card, job_type_id: null }, jobTypes);
  if (exact) return exact;
  const day = '2000-01-03';
  const want = intervalOn(day, card.start_time, card.end_time);
  let best = null;
  let bestOverlap = 0;
  for (const j of jobTypes) {
    if (j.active === false || j.location_id !== card.location_id || j.activity_id !== card.activity_id) continue;
    const have = intervalOn(day, j.start_time, j.end_time);
    // A night job started the evening before can cover an early card too.
    const overlap = Math.max(
      Math.min(want.end, have.end) - Math.max(want.start, have.start),
      Math.min(want.end, have.end - 1440) - Math.max(want.start, have.start - 1440),
    );
    if (overlap > bestOverlap) { best = j; bestOverlap = overlap; }
  }
  return best;
}

// rankRows: rank_supervision_rules. An unknown rank counts as junior —
// same safe default as the rest of the app.
export function isSenior(staff, rankRows) {
  const row = rankRows.find(r => r.rank === staff?.rank);
  return row ? row.requires_supervision === false : false;
}

export function hasAnySkill(staff, requiredSkillIds) {
  if (!requiredSkillIds || requiredSkillIds.length === 0) return true;
  const held = staff?.advanced_skills || [];
  return requiredSkillIds.some(id => held.includes(id));
}

// Why `staff` can't fill `place` on grade/skill grounds, or null if they
// can. Says nothing about their day (leave, clashes) — see dayConflict.
export function placeMismatch(place, staff, rankRows) {
  if (place.kind === 'visitor') return 'Visitors only';
  if (place.grade === 'senior' && !isSenior(staff, rankRows)) return 'Needs a senior';
  if (place.grade === 'junior' && isSenior(staff, rankRows)) return 'Junior place';
  if (!hasAnySkill(staff, place.required_advanced_skills)) return 'Missing the skill';
  return null;
}

// Lays a card's bookings and visitor names into its job's places. Bookings
// with a place_id go in that place; bookings from before the Planner (no
// place_id) are fitted into the first empty place they qualify for, so an
// already-staffed day reads as covered; anyone left over is an extra.
//
// Returns { places: [{ place, slots: [{ index, assignment, visitor }] }],
// extras: [assignment], filled, needed }.
export function layOutCard(card, job, allPlaces, cardAssignments, cardVisitors, staffById, rankRows) {
  const jobPlaces = job
    ? allPlaces.filter(p => p.job_type_id === job.job_type_id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    : [];
  const places = jobPlaces.map(place => ({
    place,
    slots: Array.from({ length: place.min_count || 1 }, (_, index) => ({ index, assignment: null, visitor: null })),
  }));
  const extras = [];

  for (const v of cardVisitors) {
    const p = places.find(x => x.place.place_id === v.place_id);
    const slot = p?.slots[v.slot];
    if (slot && !slot.visitor) slot.visitor = v;
  }

  const emptySlot = (p) => p.slots.find(s => !s.assignment && !s.visitor);
  const unplaced = [];
  for (const a of cardAssignments) {
    const p = a.place_id && places.find(x => x.place.place_id === a.place_id);
    const slot = p && emptySlot(p);
    if (slot) slot.assignment = a;
    else if (a.place_id && p) extras.push(a);
    else unplaced.push(a);
  }
  for (const a of unplaced) {
    const staff = staffById.get(a.staff_id);
    const p = places.find(x => emptySlot(x) && !placeMismatch(x.place, staff, rankRows));
    if (p) emptySlot(p).assignment = a;
    else extras.push(a);
  }

  const allSlots = places.flatMap(p => p.slots);
  return {
    places,
    extras,
    filled: allSlots.filter(s => s.assignment || s.visitor).length,
    needed: allSlots.length,
  };
}

// Why staffId can't take a booking for [startTime, endTime) on dateStr,
// or null if they're free. On-call slots (duty_assignments) never clash —
// someone can be on call while working a job.
//
// assignments: staff_assignments rows with shifts(start_time, end_time),
// the day before included so last night's shift is seen.
export function dayConflict({ staffId, dateStr, startTime, endTime, cardId, assignments, unavailable, cardLabel }) {
  if (unavailable.some(u => u.staff_id === staffId && u.date === dateStr)) return 'Unavailable';
  const mine = assignments.filter(a => a.staff_id === staffId && !a.on_call);
  if (cardId && mine.some(a => a.theatre_activity_id === cardId)) return 'Already on this job';
  const want = intervalOn(dateStr, startTime, endTime);
  for (const a of mine) {
    if (a.date !== dateStr && a.date !== addDays(dateStr, -1) && a.date !== addDays(dateStr, 1)) continue;
    const st = a.shifts?.start_time;
    const en = a.shifts?.end_time;
    if (!st || !en) continue;
    if (intervalsOverlap(want, intervalOn(a.date, st, en))) {
      return `Busy: ${cardLabel ? cardLabel(a) : 'another job'} ${hhmm(st)}–${hhmm(en)}`;
    }
  }
  return null;
}

// How many distinct days staffId works in [fromStr, toStr]: any booking or
// on-call slot counts that day once.
export function daysWorked(staffId, fromStr, toStr, assignments, duties) {
  const dates = new Set();
  for (const a of assignments) if (a.staff_id === staffId && a.date >= fromStr && a.date <= toStr) dates.add(a.date);
  for (const d of duties) if (d.staff_id === staffId && d.date >= fromStr && d.date <= toStr) dates.add(d.date);
  return dates.size;
}

// ------------------------------------------------------------
// Converting older cards to jobs (Settings → Jobs → Convert)
// ------------------------------------------------------------

// Rough part of the day, for a suggested job name.
export function periodFor(startTime, endTime) {
  const s = toMinutes(startTime);
  const e = toMinutes(endTime);
  if (e <= s || s >= 17 * 60) return 'Night';
  if (e <= 13 * 60) return 'AM';
  if (s >= 12 * 60) return 'PM';
  return 'Day';
}

// Every card and template entry with no job stored on it, grouped by
// location + activity + exact hours — one group per job-to-be. A group
// whose hours already match an existing job is pointed at that job, so
// stamping it changes nothing on screen but makes the link explicit.
//
// Returns [{ key, location_id, activity_id, start_time, end_time,
// cardIds, entryIds, firstDate, lastDate, matchJobId, suggestedName }],
// biggest first.
export function groupUnconverted(cards, entries, jobTypes, locations, activities) {
  const groups = new Map();
  const add = (row, kind) => {
    if (row.job_type_id || !row.location_id || !row.activity_id || !row.start_time || !row.end_time) return;
    const key = [row.location_id, row.activity_id, hhmm(row.start_time), hhmm(row.end_time)].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        key, location_id: row.location_id, activity_id: row.activity_id,
        start_time: hhmm(row.start_time), end_time: hhmm(row.end_time),
        cardIds: [], entryIds: [], firstDate: null, lastDate: null,
      });
    }
    const g = groups.get(key);
    if (kind === 'card') {
      g.cardIds.push(row.theatre_activity_id);
      if (!g.firstDate || row.date < g.firstDate) g.firstDate = row.date;
      if (!g.lastDate || row.date > g.lastDate) g.lastDate = row.date;
    } else {
      g.entryIds.push(row.week_template_entry_id);
    }
  };
  cards.forEach(c => add(c, 'card'));
  entries.forEach(e => add(e, 'entry'));

  const list = [...groups.values()];
  const locName = (id) => locations.find(l => l.location_id === id)?.name || 'Unknown';
  const act = (id) => activities.find(a => a.activity_id === id);
  // Name by activity; add the location when the same activity runs at
  // more than one place.
  const locationsPerActivity = new Map();
  list.forEach(g => locationsPerActivity.set(g.activity_id, new Set([...(locationsPerActivity.get(g.activity_id) || []), g.location_id])));

  const taken = new Set(jobTypes.map(j => j.name.toLowerCase()));
  list.sort((a, b) => (b.cardIds.length + b.entryIds.length) - (a.cardIds.length + a.entryIds.length));
  for (const g of list) {
    const match = jobForCard(g, jobTypes);
    g.matchJobId = match?.job_type_id || null;
    const a = act(g.activity_id);
    const actLabel = a?.abbreviation || a?.name || 'Activity';
    const base = `${locationsPerActivity.get(g.activity_id).size > 1 ? `${locName(g.location_id)} ` : ''}${actLabel} ${periodFor(g.start_time, g.end_time)}`;
    let name = base;
    if (taken.has(name.toLowerCase())) name = `${base} ${g.start_time}–${g.end_time}`;
    let n = 2;
    while (taken.has(name.toLowerCase())) name = `${base} ${g.start_time}–${g.end_time} (${n++})`;
    if (!g.matchJobId) taken.add(name.toLowerCase());
    g.suggestedName = name;
  }
  return list;
}
