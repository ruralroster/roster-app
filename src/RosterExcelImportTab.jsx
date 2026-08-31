import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertCircle, Loader, Upload } from 'lucide-react';
import { importRosterWeek, createStaff, updateStaffFTE } from './supabaseClient';
import { getWeekDateRanges, parseRosterWeek } from './rosterExcelImport';
import { getEdSheetNames, getEdWeekDateRanges, parseEdWeek, getEdStaffRoster } from './edRosterExcelImport';

const FORMATS = [
  { value: 'classic', label: 'Consultant / Registrar / Intern (longhand shift text)' },
  { value: 'ed', label: 'Shift-code (e.g. Emergency Department: "0730B", "2200A")' },
];

// Officer-facing tool for importing a week of the department's Excel
// roster (exelRosters/*.xlsx). Two layouts are supported so far — see
// rosterExcelImport.js and edRosterExcelImport.js for what each covers.
// A future department with yet another layout needs its own parser module
// added here the same way, not a rewrite of this component.
//
// Always runs a dry run first — nothing is written to Supabase until the
// officer reviews that report and explicitly confirms. Re-running is
// safe: assignStaffFortnight (which the real write goes through) already
// joins an existing card instead of duplicating it, and a leave day just
// re-marks the same availability row.
export default function RosterExcelImportTab({ departmentId, staffList, locations, activities, leaveTypes, staffRanks = [], onStaffChanged }) {
  const [format, setFormat] = useState('classic');
  const [workbook, setWorkbook] = useState(null);
  const [fileName, setFileName] = useState('');
  const [sheetNames, setSheetNames] = useState([]);
  const [sheetName, setSheetName] = useState('');
  const [weekRanges, setWeekRanges] = useState([]);
  const [weekIndex, setWeekIndex] = useState(0);
  const [results, setResults] = useState(null); // dry-run or real results, from importRosterWeek
  const [wasDryRun, setWasDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ED-only: people the sheet mentions who have no matching staff record
  // yet — a brand-new department has none at all. Reviewed and created
  // here rather than silently auto-created by the importer itself, same
  // "never silently create/guess" rule as everything else in this import.
  const [missingStaff, setMissingStaff] = useState(null); // [{ name, fte, suggestedRank, rank, create }]
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [creatingProgress, setCreatingProgress] = useState(null); // { current, total }
  const [importProgress, setImportProgress] = useState(null); // { current, total }

  const loadEdSheet = (wb, name) => {
    setSheetName(name);
    setWeekRanges(getEdWeekDateRanges(wb, name));
    setWeekIndex(0);
    setMissingStaff(null);
    setResults(null);
  };

  const handleFormatChange = (nextFormat) => {
    setFormat(nextFormat);
    setResults(null);
    setMissingStaff(null);
    if (workbook && nextFormat === 'ed') {
      const names = getEdSheetNames(workbook);
      setSheetNames(names);
      loadEdSheet(workbook, names[0]);
    } else if (workbook && nextFormat === 'classic') {
      setWeekRanges(getWeekDateRanges(workbook));
      setWeekIndex(0);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setMissingStaff(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      setWorkbook(wb);
      setFileName(file.name);
      if (format === 'ed') {
        const names = getEdSheetNames(wb);
        setSheetNames(names);
        loadEdSheet(wb, names[0]);
      } else {
        setWeekRanges(getWeekDateRanges(wb));
        setWeekIndex(0);
      }
    } catch (err) {
      setError(`Failed to read file: ${err.message}`);
      setWorkbook(null);
    } finally {
      setLoading(false);
    }
  };

  const checkMissingStaff = () => {
    if (!workbook) return;
    const roster = getEdStaffRoster(workbook);
    const existingNames = new Set(staffList.map(s => s.name.trim().toLowerCase()));
    const missing = roster
      .filter(p => !existingNames.has(p.name.toLowerCase()))
      .map(p => ({
        name: p.name,
        fte: p.fte,
        suggestedRank: p.suggestedRank,
        rank: staffRanks.some(r => r.rank === p.suggestedRank) ? p.suggestedRank : '',
        create: true,
      }));
    setMissingStaff(missing);
  };

  const updateMissingStaffField = (index, field, value) => {
    setMissingStaff(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const handleCreateMissingStaff = async () => {
    const toCreate = missingStaff.filter(p => p.create);
    if (toCreate.length === 0) return;
    if (toCreate.some(p => !p.rank)) {
      setError('Every staff member being created needs a rank picked first.');
      return;
    }

    setCreatingStaff(true);
    setCreatingProgress({ current: 0, total: toCreate.length });
    setError(null);
    try {
      for (let i = 0; i < toCreate.length; i++) {
        const person = toCreate[i];
        const { data, error: createError } = await createStaff(departmentId, person.name, person.rank, '');
        if (createError) throw new Error(`${person.name}: ${createError.message}`);
        if (person.fte !== 1 && data) {
          const { error: fteError } = await updateStaffFTE(data.staff_id, person.fte);
          if (fteError) throw new Error(`${person.name}: created, but failed to set FTE: ${fteError.message}`);
        }
        setCreatingProgress({ current: i + 1, total: toCreate.length });
      }
      if (onStaffChanged) await onStaffChanged();
      checkMissingStaff();
    } catch (err) {
      setError(`Failed to create staff: ${err.message}`);
    } finally {
      setCreatingStaff(false);
      setCreatingProgress(null);
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
      const people = format === 'ed' ? parseEdWeek(workbook, sheetName, weekIndex) : parseRosterWeek(workbook, weekIndex);
      setImportProgress({ current: 0, total: people.length });
      const { data, error: importError } = await importRosterWeek(
        departmentId, people,
        { staffList, locations, activities, leaveTypes },
        { dryRun, onProgress: (current, total) => setImportProgress({ current, total }) }
      );
      if (importError) throw importError;
      setResults(data);
      setWasDryRun(dryRun);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    } finally {
      setLoading(false);
      setImportProgress(null);
    }
  };

  const okCount = results?.filter(r => r.ok).length ?? 0;
  const errorCount = results?.filter(r => !r.ok).length ?? 0;

  return (
    <div>
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Roster format</label>
        <select
          value={format}
          onChange={(e) => handleFormatChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          {FORMATS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

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

      {workbook && format === 'ed' && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Sheet</label>
          <select
            value={sheetName}
            onChange={(e) => loadEdSheet(workbook, e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {sheetNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      )}

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

      {workbook && format === 'ed' && (
        <div className="mb-4">
          <button
            onClick={checkMissingStaff}
            className="w-full px-4 py-2 bg-purple-100 hover:bg-purple-200 text-purple-900 font-medium rounded-lg transition text-sm"
          >
            Check for Missing Staff
          </button>

          {missingStaff && (
            missingStaff.length === 0 ? (
              <p className="text-xs text-gray-500 mt-2">Everyone in this file already has a staff record.</p>
            ) : (
              <div className="mt-3 p-3 border border-purple-200 bg-purple-50 rounded-lg space-y-2">
                <p className="text-xs font-semibold text-purple-900">
                  {missingStaff.length} {missingStaff.length === 1 ? 'person' : 'people'} in this file have no staff record yet:
                </p>
                {missingStaff.map((p, i) => (
                  <div key={p.name} className="flex flex-wrap items-center gap-2 bg-white p-2 rounded border border-gray-200">
                    <input
                      type="checkbox"
                      checked={p.create}
                      onChange={(e) => updateMissingStaffField(i, 'create', e.target.checked)}
                    />
                    <span className="text-sm font-medium text-gray-900 flex-1 min-w-[8rem]">{p.name}</span>
                    <span className="text-xs text-gray-500">FTE {p.fte}</span>
                    <select
                      value={p.rank}
                      onChange={(e) => updateMissingStaffField(i, 'rank', e.target.value)}
                      disabled={!p.create}
                      className="px-2 py-1 border border-gray-300 rounded text-xs disabled:opacity-50"
                    >
                      <option value="">— Select a rank —</option>
                      {staffRanks.map(r => (
                        <option key={r.rule_id} value={r.rank}>{r.rank}</option>
                      ))}
                    </select>
                    {p.suggestedRank && !staffRanks.some(r => r.rank === p.suggestedRank) && (
                      <span className="text-xs text-amber-700 basis-full">
                        Suggested rank "{p.suggestedRank}" doesn't exist yet — add it in Settings → Ranks, or pick a different one.
                      </span>
                    )}
                  </div>
                ))}
                <button
                  onClick={handleCreateMissingStaff}
                  disabled={creatingStaff || missingStaff.every(p => !p.create)}
                  className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm flex items-center justify-center gap-2"
                >
                  {creatingStaff && <Loader size={16} className="animate-spin" />}
                  Create Selected Staff
                </button>
                {creatingProgress && <ProgressBar current={creatingProgress.current} total={creatingProgress.total} />}
              </div>
            )
          )}
        </div>
      )}

      {workbook && (
        <div className="mb-4">
          <div className="flex gap-2">
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
          {importProgress && <ProgressBar current={importProgress.current} total={importProgress.total} label={`${importProgress.current} of ${importProgress.total} people`} />}
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

// Both the staff-creation loop and the actual import loop write one row/
// person at a time via sequential awaited Supabase calls (see
// handleCreateMissingStaff and importRosterWeek's onProgress) — a big
// roster genuinely takes a while, so this exists to show it's moving
// rather than leaving the officer looking at a spinner with no sense of
// whether it's stuck.
function ProgressBar({ current, total, label }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="mt-2">
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-500 mt-1 text-center">{label || `${current} of ${total}`} ({pct}%)</p>
    </div>
  );
}
