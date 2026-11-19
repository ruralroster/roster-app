// Tully's baseline for the business case: per fortnight tab of the 2026
// Medical Officer Roster, how many shifts were rostered, how many were
// unfilled ("Locum Needed", "NO RMO" rows), and their hours, by SMO / RMO;
// and how many were worked by someone with no payroll number on the sheet
// (most likely an agency locum).
// Totals only: no names are printed or written.
//
//   node scripts/business-case/tully_baseline.js <roster.xlsx> [out.csv]
//
// Uses the same parser as the Import tab (src/tullyRosterExcelImport.js),
// built on the fly with esbuild, and the sheet's own hours (not the
// standard shifts) for the hours columns.

const path = require('path');
const fs = require('fs');
const os = require('os');
const XLSX = require('xlsx');

const [file, outFile] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/business-case/tully_baseline.js <roster.xlsx> [out.csv]');
  process.exit(1);
}

const bundle = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tully-')), 'tully.cjs');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, '../../src/tullyRosterExcelImport.js')],
  bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
});
const t = require(bundle);

const hoursOf = (seg) => {
  const [a, b] = (seg.sheetHours || `${seg.start}–${seg.end}`).split('–');
  const mins = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  let d = mins(b) - mins(a);
  if (d <= 0) d += 24 * 60;
  return d / 60;
};

const wb = XLSX.readFile(file);
const rows = [];
for (const { sheetName, monday } of t.getTullySheets(wb)) {
  const r = { fortnight: monday, tab: sheetName };
  for (const grade of ['smo', 'rmo']) {
    Object.assign(r, { [`${grade}_shifts`]: 0, [`${grade}_hours`]: 0, [`${grade}_unfilled`]: 0, [`${grade}_unfilled_hours`]: 0, [`${grade}_no_payroll_shifts`]: 0, [`${grade}_leave_days`]: 0 });
  }
  r.sboc_days = 0;
  for (const p of t.parseTullyRange(wb, sheetName, 0)) {
    const g = p.section === 'consultant' ? 'smo' : 'rmo';
    for (const d of p.days) {
      if (d.onCallDuties) r.sboc_days += 1;
      const s = d.resolvedShift;
      if (s?.leaveCode && !p.unnamed) r[`${g}_leave_days`] += 1;
      for (const seg of s?.segments || []) {
        if (seg.location === 'Non-clinical') continue;
        const h = hoursOf(seg);
        if (p.unnamed) {
          r[`${g}_unfilled`] += 1;
          r[`${g}_unfilled_hours`] += h;
        } else {
          r[`${g}_shifts`] += 1;
          r[`${g}_hours`] += h;
          // No payroll number on the sheet: most likely an agency locum.
          if (!p.payroll) r[`${g}_no_payroll_shifts`] += 1;
        }
      }
    }
  }
  rows.push(r);
}

const cols = Object.keys(rows[0]);
const csv = [cols.join(','), ...rows.map(r => cols.map(c => (typeof r[c] === 'number' ? Math.round(r[c] * 10) / 10 : r[c])).join(','))].join('\n');
if (outFile) fs.writeFileSync(outFile, `${csv}\n`);
console.log(csv);

const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
console.log('\nWhole year:');
for (const g of ['smo', 'rmo']) {
  const filled = sum(`${g}_shifts`);
  const gap = sum(`${g}_unfilled`);
  console.log(`  ${g.toUpperCase()}: ${filled} shifts rostered, ${gap} unfilled (${Math.round(sum(`${g}_unfilled_hours`))} h), ${pct(gap, filled + gap)} of clinical shifts had nobody; ${sum(`${g}_no_payroll_shifts`)} worked by someone with no payroll number (likely agency)`);
}
console.log(`  Fortnights with at least one unfilled shift: ${rows.filter(r => r.smo_unfilled + r.rmo_unfilled > 0).length} of ${rows.length}`);
