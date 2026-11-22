// The staff app's "All my sites": one calendar for someone rostered at more
// than one Rstar site (my_rostered_days, migrations/2026-11-21_multi_site.sql).
// Pure, so it can be unit tested.

import { MIN_REST_HOURS } from './plannerUtils';

const toMs = (dateStr, timeStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = (timeStr || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
};

// A row's real start and end (an end at or before the start is the next
// day).
export function rowInterval(row) {
  const start = toMs(row.date, row.start_time);
  let end = toMs(row.date, row.end_time);
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return { start, end };
}

const works = (r) => r.kind === 'shift' && !r.on_call && r.start_time && r.end_time;

// Shifts at two different sites that overlap or leave under 10 hours off
// between them: [{ first, second, overlap }]. A site's own checks already
// cover shifts at the same site.
export function crossSiteProblems(rows) {
  const shifts = rows.filter(works).map(r => ({ ...r, ...rowInterval(r) })).sort((a, b) => a.start - b.start);
  const problems = [];
  for (let i = 0; i < shifts.length; i++) {
    for (let j = i + 1; j < shifts.length; j++) {
      const a = shifts[i];
      const b = shifts[j];
      if (b.start - a.end >= MIN_REST_HOURS * 3600 * 1000) break;
      if (a.department_id === b.department_id) continue;
      problems.push({ first: a, second: b, overlap: b.start < a.end });
    }
  }
  return problems;
}

// A colour per site, the same each time: a hue from the site's name.
export function siteHue(name) {
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// my_rostered_days rows -> what buildAssignmentsIcs expects, with the site
// in each event's location.
export function rowsForIcs(rows) {
  return rows.filter(r => r.kind !== 'leave' && r.start_time && r.end_time).map(r => (r.kind === 'duty'
    ? { kind: 'duty', date: r.date, duty_type: r.ref_id, start_time: r.start_time, end_time: r.end_time, label: `${r.duty_label} (${r.department_name})` }
    : {
      assignment_id: r.ref_id,
      date: r.date,
      role: r.role,
      activity_name: r.activity_name,
      shifts: { start_time: r.start_time, end_time: r.end_time, name: r.shift_name },
      locations: { name: `${r.department_name}${r.location_name ? ` — ${r.location_name}` : ''}` },
    }));
}
