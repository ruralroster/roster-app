// Builds an RFC 5545 .ics calendar file from a staff member's weekly
// assignments. Shift dates/times are stored as plain date/time-of-day
// strings with no timezone of their own — they mean "this wall-clock time,
// wherever the department actually is" — so DTSTART/DTEND are resolved
// against the *exporting device's* current timezone (Date's multi-arg
// constructor always treats numeric y/m/d/h/m/s as local time, whatever
// that is) and written out as absolute UTC instants. That's deliberate:
// an earlier version wrote these as floating local time (no Z, no TZID),
// which some importers — Google Calendar among them — read back as UTC
// rather than "whatever zone you're in", shifting every shift by the
// local UTC offset once imported.
//
// A plain 'YYYY-MM-DDTHH:mm:ss' string is *not* used to build these Date
// objects, and a date-only 'YYYY-MM-DD' string doubly isn't — both parse
// via Date.parse, whose date-only form is spec'd to UTC, silently shifting
// the day for anyone east of UTC. The multi-arg constructor sidesteps that
// entirely.

function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// date: 'YYYY-MM-DD', time: 'HH:MM:SS' -> Date, interpreted in whatever
// timezone this code is currently running in.
function toLocalDate(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute, second] = timeStr.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, second || 0);
}

function toIcsUtcDateTime(date) {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

export function buildAssignmentsIcs(assignments) {
  const dtstamp = toIcsUtcDateTime(new Date());

  const events = assignments.map(a => {
    const startTime = a.shifts?.start_time || '00:00:00';
    const endTime = a.shifts?.end_time || '00:00:00';
    const startDate = toLocalDate(a.date, startTime);
    const endDate = toLocalDate(a.date, endTime);
    // Overnight shifts (e.g. Night: 22:00-08:00) end the following day.
    if (endTime <= startTime) endDate.setDate(endDate.getDate() + 1);

    const location = a.locations?.name || 'Unknown location';
    const role = a.role ? a.role.charAt(0).toUpperCase() + a.role.slice(1) : '';
    const summary = a.activity_name
      ? `${a.activity_name} — ${location} (${role})`
      : `${location} (${role})`;

    const descriptionLines = [
      a.shifts?.name ? `Shift: ${a.shifts.name}` : null,
      role ? `Role: ${role}` : null,
    ].filter(Boolean);

    return [
      'BEGIN:VEVENT',
      `UID:${a.assignment_id}@roster-app`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${toIcsUtcDateTime(startDate)}`,
      `DTEND:${toIcsUtcDateTime(endDate)}`,
      `SUMMARY:${icsEscape(summary)}`,
      `LOCATION:${icsEscape(location)}`,
      descriptionLines.length ? `DESCRIPTION:${icsEscape(descriptionLines.join('\n'))}` : null,
      'END:VEVENT',
    ].filter(Boolean).join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Roster App//Staff Roster Export//EN',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

export function getIcsExportFilename(staffName, startDateStr, endDateStr) {
  const safeName = (staffName || 'Staff').trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safeName}_Roster_${startDateStr}to${endDateStr}.ics`;
}

// Builds a CSV string from an array of column defs ({ header, value(row) })
// and an array of row objects — handles quoting per RFC 4180 (only wraps a
// field in quotes when it actually needs it, doubling any embedded quotes).
export function buildCsv(columns, rows) {
  const escapeCell = (value) => {
    const str = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [
    columns.map(c => escapeCell(c.header)).join(','),
    ...rows.map(row => columns.map(c => escapeCell(c.value(row))).join(',')),
  ];
  return lines.join('\r\n');
}

// Triggers a browser download of the given text content as a file.
export function downloadTextFile(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
