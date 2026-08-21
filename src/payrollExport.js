import * as XLSX from 'xlsx';
import { toLocalDateStr } from './dateUtils';

const DAY_HEADERS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

// Monday of the week containing `date` (local calendar days, Mon-Sun roster
// week — distinct from the Sun-Sat week used elsewhere in the app for the
// calendar grid).
export function getMondayOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// 'HH:MM:SS' -> 'HHMM'. Falls back to empty string for missing/malformed times.
function toHHMM(timeStr) {
  if (!timeStr || timeStr.length < 5) return '';
  return timeStr.slice(0, 5).replace(':', '');
}

function formatShiftCell(assignmentsForCell) {
  if (assignmentsForCell.length === 0) return '';

  return assignmentsForCell
    .map(a => {
      if (a.leave_code) return a.leave_code;
      const start = toHHMM(a.shifts?.start_time);
      const end = toHHMM(a.shifts?.end_time);
      if (!start || !end) return '';
      return `${start}-${end}`;
    })
    .filter(Boolean)
    .join('; ');
}

// Builds the sheet as an array-of-arrays matching the required layout:
//   Row 1: Pay Centre | Department Name | Fortnight Starting {date}
//   Row 2: Staff Name | Payroll Number | Position ID | Cost Centre | MON dd/mm .. SUN dd/mm (x2 weeks)
//   Row 3+: one row per staff member in the department — active AND
//           inactive, so nobody who worked that fortnight is missing just
//           because they've since left — in name order, blank cells where
//           there's no assignment or leave entry that day.
// `numDays` defaults to 14 (a Mon-Sun/Mon-Sun payroll fortnight) but any
// length works — day columns are labelled with the date, not just the day
// name, so a 14-day range doesn't produce two ambiguous "MON" columns.
export function buildPayrollSheetRows({ payCentreNumber, departmentName, periodStart, numDays = 14, staffList, assignments }) {
  const days = Array.from({ length: numDays }, (_, i) => addDays(periodStart, i));
  const dayStrs = days.map(toLocalDateStr);
  const dayColumnHeaders = days.map((d, i) => `${DAY_HEADERS[i % 7]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);

  const periodEnd = addDays(periodStart, numDays - 1);
  const headerRow1 = [
    'Pay Centre:', payCentreNumber || '', '',
    'Department:', departmentName || '', '',
    'Fortnight:', `${toLocalDateStr(periodStart)} to ${toLocalDateStr(periodEnd)}`, '', '', '',
  ];
  const headerRow2 = ['Staff Name', 'Payroll Number', 'Position ID', 'Cost Centre', ...dayColumnHeaders];

  const sortedStaff = [...staffList].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const dataRows = sortedStaff.map(staff => {
    const cells = dayStrs.map(dateStr => {
      const forCell = assignments.filter(a => a.staff_id === staff.staff_id && a.date === dateStr);
      return formatShiftCell(forCell);
    });
    return [staff.name, staff.payroll_number || '', staff.position_id || '', staff.cost_centre || '', ...cells];
  });

  return [headerRow1, headerRow2, ...dataRows];
}

export function getPayrollExportFilename(departmentName, periodStartDateStr, periodEndDateStr) {
  const safeName = (departmentName || 'Department').trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `PayrollExport_${safeName}_${periodStartDateStr}_to_${periodEndDateStr}.xlsx`;
}

// Builds the workbook and triggers a browser download.
export function downloadPayrollExcel({ departmentName, payCentreNumber, periodStart, numDays = 14, staffList, assignments }) {
  const rows = buildPayrollSheetRows({ payCentreNumber, departmentName, periodStart, numDays, staffList, assignments });

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Payroll');

  const periodEnd = addDays(periodStart, numDays - 1);
  const filename = getPayrollExportFilename(departmentName, toLocalDateStr(periodStart), toLocalDateStr(periodEnd));

  XLSX.writeFile(workbook, filename);
}
