// Staff & Availability > Review leave: a person's leave days grouped into
// blocks, one per run of consecutive days with the same leave type. Pure.

const nextDay = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// days: staff_availability rows ({ date, leave_type_id, leave_hours }).
// Returns [{ start, end, leaveTypeId, days, hours }]; a day with no hours
// of its own (a usual shift) adds nothing to hours, and the block says so
// with someUsualShift.
export function leaveBlocks(days) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const blocks = [];
  for (const d of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && last.leaveTypeId === d.leave_type_id && nextDay(last.end) === d.date) {
      last.end = d.date;
      last.days += 1;
    } else {
      blocks.push({ start: d.date, end: d.date, leaveTypeId: d.leave_type_id, days: 1, hours: 0, someUsualShift: false });
    }
    const block = blocks[blocks.length - 1];
    if (d.leave_hours != null) block.hours += Number(d.leave_hours);
    else block.someUsualShift = true;
  }
  return blocks.map(b => ({ ...b, hours: Math.round(b.hours * 10) / 10 }));
}
