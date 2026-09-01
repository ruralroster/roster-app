// Builds an RFC 5545 .ics calendar file from a staff member's weekly
// assignments. DTSTART/DTEND are written as floating local time (no Z, no
// TZID) built directly from the stored date/time strings — deliberately
// avoiding any Date object -> toISOString() round-trip, since that shifts
// by a day for any user east of UTC (see availability materialization
// logic elsewhere in this app for the same caveat).

function pad(n) {
  return String(n).padStart(2, '0');
}

function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// date: 'YYYY-MM-DD', time: 'HH:MM:SS' -> 'YYYYMMDDTHHMMSS'
function toIcsDateTime(dateStr, timeStr) {
  return `${dateStr.replace(/-/g, '')}T${timeStr.replace(/:/g, '')}`;
}

function addDaysToDateStr(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// DTSTAMP is defined by RFC 5545 as an absolute creation timestamp, so (unlike
// DTSTART/DTEND above) a real UTC instant is exactly what's wanted here.
function nowAsIcsUtcStamp() {
  return `${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

export function buildAssignmentsIcs(assignments) {
  const dtstamp = nowAsIcsUtcStamp();

  const events = assignments.map(a => {
    const startTime = a.shifts?.start_time || '00:00:00';
    const endTime = a.shifts?.end_time || '00:00:00';
    // Overnight shifts (e.g. Night: 22:00-08:00) end the following day.
    const endDate = endTime <= startTime ? addDaysToDateStr(a.date, 1) : a.date;

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
      `DTSTART:${toIcsDateTime(a.date, startTime)}`,
      `DTEND:${toIcsDateTime(endDate, endTime)}`,
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
