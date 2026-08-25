import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertCircle, Loader, Upload } from 'lucide-react';
import { importRosterWeek } from './supabaseClient';
import { getWeekDateRanges, parseRosterWeek } from './rosterExcelImport';

// Officer-facing tool for importing a week of the department's Excel
// roster (exelRosters/*.xlsx). Covers the SMO/Consultant, Registrar/RMO
// and Intern sections only — see rosterExcelImport.js for why Locums and
// the Standby/AF summary aren't included.
//
// Always runs a dry run first — nothing is written to Supabase until the
// officer reviews that report and explicitly confirms. Re-running is
// safe: assignStaffFortnight (which the real write goes through) already
// joins an existing card instead of duplicating it, and a leave day just
// re-marks the same availability row.
export default function RosterExcelImportTab({ departmentId, staffList, locations, activities, leaveTypes }) {
  const [workbook, setWorkbook] = useState(null);
  const [fileName, setFileName] = useState('');
  const [weekRanges, setWeekRanges] = useState([]);
  const [weekIndex, setWeekIndex] = useState(0);
  const [results, setResults] = useState(null); // dry-run or real results, from importRosterWeek
  const [wasDryRun, setWasDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      setWorkbook(wb);
      setFileName(file.name);
      setWeekRanges(getWeekDateRanges(wb));
      setWeekIndex(0);
    } catch (err) {
      setError(`Failed to read file: ${err.message}`);
      setWorkbook(null);
    } finally {
      setLoading(false);
    }
  };

  const runImport = async (dryRun) => {
    if (!workbook) return;
    if (!dryRun && !window.confirm('Write this week to the roster now? Review the dry run above first if you haven\'t already.')) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const people = parseRosterWeek(workbook, weekIndex);
      const { data, error: importError } = await importRosterWeek(
        departmentId, people,
        { staffList, locations, activities, leaveTypes },
        { dryRun }
      );
      if (importError) throw importError;
      setResults(data);
      setWasDryRun(dryRun);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const okCount = results?.filter(r => r.ok).length ?? 0;
  const errorCount = results?.filter(r => !r.ok).length ?? 0;

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Imports the SMO/Consultant, Registrar/RMO and Intern sections of an Excel roster, one week at a time. Locums and the Standby/AF summary aren't covered.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <label className="flex items-center justify-center gap-2 w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-blue-400 hover:bg-blue-50 cursor-pointer transition mb-4">
        <Upload size={18} />
        {fileName || 'Choose an Excel roster file (.xlsx)'}
        <input type="file" accept=".xlsx" onChange={handleFileChange} className="hidden" />
      </label>

      {workbook && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Week to import</label>
          <select
            value={weekIndex}
            onChange={(e) => { setWeekIndex(parseInt(e.target.value, 10)); setResults(null); }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {weekRanges.map((range, i) => (
              <option key={i} value={i}>Week {i + 1} ({range.start}–{range.end})</option>
            ))}
          </select>
        </div>
      )}

      {workbook && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => runImport(true)}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            {loading && <Loader size={16} className="animate-spin" />}
            Dry Run
          </button>
          <button
            onClick={() => runImport(false)}
            disabled={loading || !results}
            title={!results ? 'Run a dry run first' : undefined}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
          >
            Write to Roster
          </button>
        </div>
      )}

      {results && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-gray-900">
              {wasDryRun ? 'Dry run result' : 'Import result'} — {okCount} would {wasDryRun ? '' : 'did '}succeed, {errorCount} error{errorCount === 1 ? '' : 's'}
            </p>
          </div>
          <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
            {results.map((r, i) => (
              <div key={i} className={`p-2 text-xs ${r.ok ? 'bg-white' : 'bg-red-50'}`}>
                <span className="font-semibold text-gray-900">{r.staffName || r.rawLabel}</span>
                {r.date && <span className="text-gray-500"> · {r.date}</span>}
                {r.ok ? (
                  <span className="text-gray-700">
                    {' — '}
                    {r.action === 'mark unavailable'
                      ? `Leave (${r.leaveCode})`
                      : `${r.location} / ${r.activity} ${r.start}–${r.end}`}
                  </span>
                ) : (
                  <span className="text-red-700"> — {r.reason || r.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
