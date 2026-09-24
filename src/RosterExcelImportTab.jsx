import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { AlertCircle, Loader, Upload, X } from 'lucide-react';
import { importRosterWeek, createStaff, updateStaffFTE, updateDepartmentRosterImportFormat, getRosterImportMappings, saveRosterImportMapping, deleteRosterImportMapping } from './supabaseClient';
import { getWeekDateRanges, parseRosterWeek, applyCodeMappings, resolveShiftCode, resolveRmoShiftCode, resolveInternShiftCode, getClassicStaffRoster, matchStaffName, cleanStaffLabel, staffLabelKey } from './rosterExcelImport';
import { getEdSheetNames, getEdWeekDateRanges, parseEdWeek, getEdStaffRoster, resolveEdShiftCode } from './edRosterExcelImport';

// The classic format has a separate code table per section (consultant /
// RMO / intern) — the known half of a split code could be from any of
// them, so try each in turn. Used by applyCodeMappings.
const resolveClassicAnySection = (code) => {
  for (const resolve of [resolveShiftCode, resolveRmoShiftCode, resolveInternShiftCode]) {
    const resolved = resolve(code);
    if (resolved && !resolved.unmapped) return resolved;
  }
  return { unmapped: code };
};

const MAPPING_KIND_LABEL = { code: 'Code', location: 'Location name', activity: 'Activity name', staff: 'Staff name' };

// A 'staff' mapping's source: the raw label with its spacing tidied but
// its case kept (for display); looked up case-insensitively via
// staffLabelKey.
const staffMappingSource = (rawLabel) => (rawLabel || '').replace(/\s+/g, ' ').trim();

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
// Which format applies is a per-department setting (departments.
// roster_import_format — migrations/2026-09-01_department_roster_import_
// format.sql), not a free choice every officer sees: a department only
// ever uses its own layout, so the picker is hidden for everyone except a
// super-admin, who sets it once when onboarding a department.
//
// Always runs a dry run first — nothing is written to Supabase until the
// officer reviews that report and explicitly confirms. Re-running is
// safe: assignStaffFortnight (which the real write goes through) already
// joins an existing card instead of duplicating it, and a leave day just
// re-marks the same availability row.
export default function RosterExcelImportTab({ departmentId, department, staffList, locations, activities, leaveTypes, staffRanks = [], onStaffChanged, isSuperAdmin = false, onDepartmentChanged }) {
  const [format, setFormat] = useState(() => department?.roster_import_format || 'classic');
  const [savingFormat, setSavingFormat] = useState(false);

  // Keeps format in sync if `department` loads/changes after this
  // component's first render (e.g. Settings opened before initializeDepartment
  // finishes) — a super-admin's own in-progress dropdown pick still wins
  // once it round-trips back through onDepartmentChanged, since that
  // updates department.roster_import_format to the same value.
  useEffect(() => {
    if (department?.roster_import_format) setFormat(department.roster_import_format);
  }, [department?.roster_import_format]);

  const handleSuperAdminFormatChange = async (nextFormat) => {
    handleFormatChange(nextFormat);
    setSavingFormat(true);
    try {
      const { error: saveError } = await updateDepartmentRosterImportFormat(departmentId, nextFormat);
      if (saveError) throw saveError;
      if (onDepartmentChanged) onDepartmentChanged({ roster_import_format: nextFormat });
    } catch (err) {
      setError(`Failed to save this department's roster format: ${err.message}`);
    } finally {
      setSavingFormat(false);
    }
  };
  const [workbook, setWorkbook] = useState(null);
  const [fileName, setFileName] = useState('');
  const [sheetNames, setSheetNames] = useState([]);
  const [sheetName, setSheetName] = useState('');
  const [weekRanges, setWeekRanges] = useState([]);
  const [weekIndex, setWeekIndex] = useState(0);
  const [results, setResults] = useState(null); // dry-run or real results, from importRosterWeek
  // What importRosterWeek found (dry run) or removed (real run) already on
  // file for the exact dates being imported, before writing the new ones —
  // see that function's header for why a re-import replaces rather than
  // merges. Cleared alongside `results` everywhere below.
  const [deletionSummary, setDeletionSummary] = useState(null);
  const [wasDryRun, setWasDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ED-only: people the sheet mentions who have no matching staff record
  // yet — a brand-new department has none at all. Reviewed and created
  // here rather than silently auto-created by the importer itself, same
  // "never silently create/guess" rule as everything else in this import.
  // FTE starts at 0 for every unmatched person (the officer's call, not
  // the sheet's) and is set per person before creating.
  const [missingStaff, setMissingStaff] = useState(null); // [{ rawLabel, name, fte, suggestedRank, rank, create }]
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [creatingProgress, setCreatingProgress] = useState(null); // { current, total }
  const [importProgress, setImportProgress] = useState(null); // { current, total }

  // Saved fixes for import errors (roster_import_mappings) — applied to
  // every dry run / write, and editable from the results list's Map…
  // button. mappingDraft is the open Map… form, if any.
  const [mappings, setMappings] = useState([]);
  const [mappingDraft, setMappingDraft] = useState(null); // { kind, source, mode, location_id, activity_id, leave_type_id, start_time, end_time } — plus, for kind 'staff': staff_id, new_name, new_rank, new_fte
  const [savingMapping, setSavingMapping] = useState(false);

  const loadMappings = async () => {
    const { data, error: loadError } = await getRosterImportMappings(departmentId);
    if (loadError) {
      setError(`Failed to load saved mappings: ${loadError.message}`);
      return mappings;
    }
    setMappings(data);
    return data;
  };

  useEffect(() => {
    if (departmentId) loadMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  // Saved mappings -> the two shapes the import needs: codeMap for
  // applyCodeMappings, nameMappings for importRosterWeek. A mapping whose
  // target has since been deleted is just skipped.
  const buildMappingLookups = (list) => {
    const codeMap = {};
    const nameMappings = { location: {}, activity: {}, staff: {} };
    for (const m of list) {
      if (m.kind === 'code') {
        if (m.leave_type_id) {
          const leaveType = leaveTypes.find(lt => lt.leave_type_id === m.leave_type_id);
          if (leaveType) codeMap[m.source] = { leaveCode: leaveType.code };
        } else {
          const location = locations.find(l => l.location_id === m.location_id);
          const activity = activities.find(a => a.activity_id === m.activity_id);
          if (location && activity && m.start_time && m.end_time) {
            codeMap[m.source] = { segments: [{ location: location.name, activity: activity.name, start: m.start_time.slice(0, 5), end: m.end_time.slice(0, 5) }] };
          }
        }
      } else if (m.kind === 'location' && m.location_id) {
        nameMappings.location[m.source.trim().toLowerCase()] = m.location_id;
      } else if (m.kind === 'activity' && m.activity_id) {
        nameMappings.activity[m.source.trim().toLowerCase()] = m.activity_id;
      } else if (m.kind === 'staff' && m.staff_id) {
        nameMappings.staff[staffLabelKey(m.source)] = m.staff_id;
      }
    }
    return { codeMap, nameMappings };
  };

  const loadEdSheet = (wb, name) => {
    setSheetName(name);
    setWeekRanges(getEdWeekDateRanges(wb, name));
    setWeekIndex(0);
    setMissingStaff(null);
    setResults(null);
    setDeletionSummary(null);
  };

  const handleFormatChange = (nextFormat) => {
    setFormat(nextFormat);
    setResults(null);
    setDeletionSummary(null);
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
    setDeletionSummary(null);
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

  // Classic format: a suggested rank from the section the person's in,
  // picked from this department's OWN rank list (ranks are per-department,
  // so there's no fixed name to suggest) — the officer can change it.
  const suggestClassicRank = (section) => {
    const senior = staffRanks.filter(r => r.requires_supervision === false);
    const junior = staffRanks.filter(r => r.requires_supervision !== false);
    if (section === 'locum') return (staffRanks.find(r => /locum/i.test(r.rank)) || senior[0])?.rank || '';
    if (section === 'consultant') return senior[0]?.rank || '';
    if (section === 'intern') return staffRanks.find(r => /intern/i.test(r.rank))?.rank || '';
    return junior.find(r => !/intern/i.test(r.rank))?.rank || '';
  };

  // extraStaff / mappingList cover records and mappings just created,
  // before the parent's staffList prop and the mappings state catch up.
  const checkMissingStaff = (extraStaff = [], mappingList = mappings) => {
    if (!workbook) return;
    const knownStaff = [...staffList, ...extraStaff];
    const mappedLabels = new Set(mappingList.filter(m => m.kind === 'staff' && m.staff_id).map(m => staffLabelKey(m.source)));
    if (format !== 'ed') {
      // Labels carry trailing speciality words ("Linda Thomson
      // Obstetrics"), so "already has a record" uses the same matching
      // the import itself does, not an exact name compare.
      const missing = getClassicStaffRoster(workbook)
        .filter(p => !mappedLabels.has(staffLabelKey(p.rawLabel)) && !matchStaffName(p.rawLabel, knownStaff))
        .map(p => {
          const rank = suggestClassicRank(p.section);
          return { rawLabel: p.rawLabel, name: p.name, fte: 0, suggestedRank: rank, rank, create: true };
        });
      setMissingStaff(missing);
      return;
    }
    const roster = getEdStaffRoster(workbook);
    const existingNames = new Set(knownStaff.map(s => s.name.trim().toLowerCase()));
    const missing = roster
      .filter(p => !existingNames.has(p.name.toLowerCase()) && !mappedLabels.has(staffLabelKey(p.name)))
      .map(p => ({
        rawLabel: p.name,
        name: p.name,
        fte: 0,
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

    if (toCreate.some(p => !p.name.trim())) {
      setError('Every staff member being created needs a name.');
      return;
    }
    if (toCreate.some(p => Number.isNaN(parseFloat(p.fte)) || parseFloat(p.fte) < 0)) {
      setError('Every staff member being created needs an FTE of 0 or more.');
      return;
    }

    setCreatingStaff(true);
    setCreatingProgress({ current: 0, total: toCreate.length });
    setError(null);
    const created = [];
    try {
      for (let i = 0; i < toCreate.length; i++) {
        const person = toCreate[i];
        const name = person.name.trim();
        const { data, error: createError } = await createStaff(departmentId, name, person.rank, '');
        if (createError) throw new Error(`${name}: ${createError.message}`);
        if (data) created.push(data);
        const fte = parseFloat(person.fte);
        if (fte !== 1 && data) {
          const { error: fteError } = await updateStaffFTE(data.staff_id, fte);
          if (fteError) throw new Error(`${name}: created, but failed to set FTE: ${fteError.message}`);
        }
        // A corrected name no longer matches the sheet's label on its own
        // (e.g. "Rach Boland Obstetrics" created as "Rachel Boland"), so
        // remember which record that label means.
        if (data && !matchStaffName(person.rawLabel, [data])) {
          const { error: mapError } = await saveRosterImportMapping(departmentId, { kind: 'staff', source: staffMappingSource(person.rawLabel), staff_id: data.staff_id });
          if (mapError) throw new Error(`${name}: created, but failed to save the name mapping: ${mapError.message}`);
        }
        setCreatingProgress({ current: i + 1, total: toCreate.length });
      }
      if (onStaffChanged) await onStaffChanged();
      const fresh = await loadMappings();
      checkMissingStaff(created, fresh);
    } catch (err) {
      setError(`Failed to create staff: ${err.message}`);
    } finally {
      setCreatingStaff(false);
      setCreatingProgress(null);
    }
  };

  // mappingList overrides the `mappings` state — used straight after
  // saving one, before the state update has landed.
  const runImport = async (dryRun, mappingList = mappings, extraStaff = []) => {
    if (!workbook) return;
    if (!dryRun && !window.confirm('Write this week to the roster now? Review the dry run above first if you haven\'t already.')) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { codeMap, nameMappings } = buildMappingLookups(mappingList);
      const parsed = format === 'ed' ? parseEdWeek(workbook, sheetName, weekIndex) : parseRosterWeek(workbook, weekIndex);
      const people = applyCodeMappings(parsed, codeMap, format === 'ed' ? resolveEdShiftCode : resolveClassicAnySection);
      setImportProgress({ current: 0, total: people.length });
      const { data, error: importError, deletionSummary: nextDeletionSummary } = await importRosterWeek(
        departmentId, people,
        { staffList: [...staffList, ...extraStaff], locations, activities, leaveTypes, nameMappings },
        { dryRun, onProgress: (current, total) => setImportProgress({ current, total }) }
      );
      if (importError) throw importError;
      setResults(data);
      setDeletionSummary(nextDeletionSummary);
      setWasDryRun(dryRun);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    } finally {
      setLoading(false);
      setImportProgress(null);
    }
  };

  // extra: for kind 'staff', the result row's { section } — used to
  // pre-fill a new staff member's rank. FTE always starts at 0.
  const openMappingDraft = (kind, source, extra = {}) => {
    const existing = mappings.find(m => m.kind === kind && m.source === source);
    const suggestedRank = extra.section ? suggestClassicRank(extra.section) : '';
    setMappingDraft({
      kind,
      source,
      staff_mode: existing?.staff_id || kind !== 'staff' ? 'existing' : 'new',
      staff_id: existing?.staff_id || '',
      new_name: cleanStaffLabel(source),
      new_rank: staffRanks.some(r => r.rank === suggestedRank) ? suggestedRank : '',
      new_fte: 0,
      mode: existing?.leave_type_id ? 'leave' : 'shift',
      location_id: existing?.location_id || '',
      activity_id: existing?.activity_id || '',
      leave_type_id: existing?.leave_type_id || '',
      start_time: existing?.start_time?.slice(0, 5) || '08:00',
      end_time: existing?.end_time?.slice(0, 5) || '18:00',
    });
  };

  // Picking a location for a code pre-fills that location's own default
  // times, if it has them — still editable.
  const handleDraftLocationChange = (locationId) => {
    const location = locations.find(l => l.location_id === locationId);
    setMappingDraft(prev => ({
      ...prev,
      location_id: locationId,
      ...(prev.kind === 'code' && location?.default_start_time && location?.default_end_time
        ? { start_time: location.default_start_time.slice(0, 5), end_time: location.default_end_time.slice(0, 5) }
        : {}),
    }));
  };

  const mappingDraftIsComplete = (d) => {
    if (!d) return false;
    if (d.kind === 'location') return !!d.location_id;
    if (d.kind === 'activity') return !!d.activity_id;
    if (d.kind === 'staff') return d.staff_mode === 'existing' ? !!d.staff_id : !!(d.new_name.trim() && d.new_rank && parseFloat(d.new_fte) >= 0);
    if (d.mode === 'leave') return !!d.leave_type_id;
    return !!(d.location_id && d.activity_id && d.start_time && d.end_time);
  };

  const handleSaveMapping = async () => {
    const d = mappingDraft;
    if (!mappingDraftIsComplete(d)) return;
    setSavingMapping(true);
    try {
      if (d.kind === 'staff') {
        let staffId = d.staff_id;
        const extraStaff = [];
        if (d.staff_mode === 'new') {
          const name = d.new_name.trim();
          const { data, error: createError } = await createStaff(departmentId, name, d.new_rank, '');
          if (createError) throw createError;
          const fte = parseFloat(d.new_fte);
          if (!Number.isNaN(fte) && fte !== 1) {
            const { error: fteError } = await updateStaffFTE(data.staff_id, fte);
            if (fteError) throw new Error(`created ${name}, but failed to set FTE: ${fteError.message}`);
          }
          staffId = data.staff_id;
          extraStaff.push(data);
        }
        const { error: saveError } = await saveRosterImportMapping(departmentId, { kind: 'staff', source: d.source, staff_id: staffId });
        if (saveError) throw saveError;
        setMappingDraft(null);
        if (d.staff_mode === 'new' && onStaffChanged) await onStaffChanged();
        const fresh = await loadMappings();
        await runImport(true, fresh, extraStaff);
        return;
      }
      const isLeave = d.kind === 'code' && d.mode === 'leave';
      const { error: saveError } = await saveRosterImportMapping(departmentId, {
        kind: d.kind,
        source: d.source,
        location_id: d.kind !== 'activity' && !isLeave ? d.location_id : null,
        activity_id: d.kind !== 'location' && !isLeave ? d.activity_id : null,
        leave_type_id: isLeave ? d.leave_type_id : null,
        start_time: d.kind === 'code' && !isLeave ? d.start_time : null,
        end_time: d.kind === 'code' && !isLeave ? d.end_time : null,
      });
      if (saveError) throw saveError;
      setMappingDraft(null);
      const fresh = await loadMappings();
      // Re-check straight away so the officer sees the error clear.
      await runImport(true, fresh);
    } catch (err) {
      setError(`Failed to save mapping: ${err.message}`);
    } finally {
      setSavingMapping(false);
    }
  };

  const handleDeleteMapping = async (mappingId) => {
    const { error: deleteError } = await deleteRosterImportMapping(mappingId);
    if (deleteError) {
      setError(`Failed to delete mapping: ${deleteError.message}`);
      return;
    }
    setResults(null);
    setDeletionSummary(null);
    await loadMappings();
  };

  // What a result row's Map… button fixes — an unknown code, or a
  // location/activity name the department doesn't have. A row missing
  // both a location and an activity gets a button for each.
  const mappableTargets = (r) => {
    if (r.ok) return [];
    if (r.unmappedCode) return [{ kind: 'code', source: r.unmappedCode }];
    if (r.unmatchedLabel) return [{ kind: 'staff', source: staffMappingSource(r.unmatchedLabel), section: r.section, fte: r.fte }];
    return [
      r.missingLocation ? { kind: 'location', source: r.missingLocation } : null,
      r.missingActivity ? { kind: 'activity', source: r.missingActivity } : null,
    ].filter(Boolean);
  };

  const describeMappingTarget = (m) => {
    if (m.kind === 'staff') return staffList.find(st => st.staff_id === m.staff_id)?.name || '(staff member not loaded)';
    if (m.leave_type_id) return `Leave: ${leaveTypes.find(lt => lt.leave_type_id === m.leave_type_id)?.name || '(deleted leave type)'}`;
    const location = m.location_id ? (locations.find(l => l.location_id === m.location_id)?.name || '(deleted location)') : null;
    const activity = m.activity_id ? (activities.find(a => a.activity_id === m.activity_id)?.name || '(deleted activity)') : null;
    const times = m.start_time && m.end_time ? ` ${m.start_time.slice(0, 5)}–${m.end_time.slice(0, 5)}` : '';
    return [location, activity].filter(Boolean).join(' / ') + times;
  };

  const activeLocations = locations.filter(l => l.active !== false);
  const draftLocation = mappingDraft ? locations.find(l => l.location_id === mappingDraft.location_id) : null;
  // A location limited to certain activities only offers those, same as
  // everywhere else a location's activity is picked.
  const draftActivities = draftLocation?.allowed_activity_ids?.length > 0
    ? activities.filter(a => draftLocation.allowed_activity_ids.includes(a.activity_id))
    : activities;

  const okCount = results?.filter(r => r.ok).length ?? 0;
  const errorCount = results?.filter(r => !r.ok).length ?? 0;

  return (
    <div>
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Roster format</label>
        {isSuperAdmin ? (
          <>
            <select
              value={format}
              onChange={(e) => handleSuperAdminFormatChange(e.target.value)}
              disabled={savingFormat}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50"
            >
              {FORMATS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Super-admin only — this sets which format this department always uses, for every officer.</p>
          </>
        ) : (
          <p className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-700">
            {FORMATS.find(f => f.value === format)?.label || format}
          </p>
        )}
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
            onChange={(e) => { setWeekIndex(parseInt(e.target.value, 10)); setResults(null); setDeletionSummary(null); }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {weekRanges.map((range, i) => (
              <option key={i} value={i}>Week {i + 1} ({range.start}–{range.end})</option>
            ))}
          </select>
        </div>
      )}

      {workbook && (
        <div className="mb-4">
          <button
            onClick={() => checkMissingStaff()}
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
                  <div key={p.rawLabel} className="flex flex-wrap items-center gap-2 bg-white p-2 rounded border border-gray-200">
                    <input
                      type="checkbox"
                      checked={p.create}
                      onChange={(e) => updateMissingStaffField(i, 'create', e.target.checked)}
                    />
                    <input
                      type="text"
                      value={p.name}
                      onChange={(e) => updateMissingStaffField(i, 'name', e.target.value)}
                      disabled={!p.create}
                      title={p.rawLabel !== p.name ? `From the sheet: "${p.rawLabel}"` : undefined}
                      className="text-sm font-medium text-gray-900 flex-1 min-w-[8rem] px-2 py-1 border border-gray-300 rounded disabled:opacity-50"
                    />
                    <label className="flex items-center gap-1 text-xs text-gray-500">
                      FTE
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        value={p.fte}
                        onChange={(e) => updateMissingStaffField(i, 'fte', e.target.value)}
                        disabled={!p.create}
                        className="w-16 px-1 py-1 border border-gray-300 rounded text-xs disabled:opacity-50"
                      />
                    </label>
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

      {deletionSummary && (
        <div className={`mb-3 p-3 rounded-lg border flex gap-2 items-start ${
          deletionSummary.existingAssignmentCount === 0 && deletionSummary.existingCardCount === 0
            ? 'bg-gray-50 border-gray-200'
            : 'bg-amber-50 border-amber-300'
        }`}>
          <AlertCircle size={16} className={`flex-shrink-0 mt-0.5 ${
            deletionSummary.existingAssignmentCount === 0 && deletionSummary.existingCardCount === 0 ? 'text-gray-400' : 'text-amber-600'
          }`} />
          <p className="text-xs text-gray-700">
            {deletionSummary.existingAssignmentCount === 0 && deletionSummary.existingCardCount === 0 ? (
              <>No existing roster data found for the {deletionSummary.dateStrs.length} date{deletionSummary.dateStrs.length === 1 ? '' : 's'} in this file — nothing to replace.</>
            ) : deletionSummary.applied ? (
              <>
                This file is the source of truth for these dates — <strong>{deletionSummary.existingAssignmentCount}</strong> existing assignment{deletionSummary.existingAssignmentCount === 1 ? '' : 's'} across <strong>{deletionSummary.existingCardCount}</strong> card{deletionSummary.existingCardCount === 1 ? '' : 's'} {deletionSummary.existingCardCount === 1 ? 'was' : 'were'} deleted before writing the roster below.
              </>
            ) : (
              <>
                This file is the source of truth for these dates — writing it for real will <strong>delete {deletionSummary.existingAssignmentCount}</strong> existing assignment{deletionSummary.existingAssignmentCount === 1 ? '' : 's'} across <strong>{deletionSummary.existingCardCount}</strong> card{deletionSummary.existingCardCount === 1 ? '' : 's'} before writing the roster below. On-call duty assignments and recorded leave are never touched by an import.
              </>
            )}
          </p>
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
                {mappableTargets(r).map(t => (
                  <button
                    key={`${t.kind}|${t.source}`}
                    onClick={() => openMappingDraft(t.kind, t.source, t)}
                    className="ml-2 px-2 py-0.5 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded transition"
                  >
                    {t.kind === 'staff' ? `Fix name "${t.source}"` : t.kind === 'code' ? `Map "${t.source}"` : `Map ${t.kind} "${t.source}"`}…
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {mappings.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Saved mappings</p>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            {mappings.map(m => (
              <div key={m.mapping_id} className="p-2 text-xs flex items-center justify-between gap-2">
                <span>
                  <span className="text-gray-500">{MAPPING_KIND_LABEL[m.kind]} </span>
                  <span className="font-semibold text-gray-900">"{m.source}"</span>
                  <span className="text-gray-700"> → {describeMappingTarget(m)}</span>
                </span>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => openMappingDraft(m.kind, m.source)}
                    className="px-2 py-0.5 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded transition"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteMapping(m.mapping_id)}
                    className="px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mappingDraft && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-lg font-bold text-gray-900">
                {mappingDraft.kind === 'staff' ? `Who is "${mappingDraft.source}"?` : `Map ${mappingDraft.kind === 'code' ? 'code' : mappingDraft.kind} "${mappingDraft.source}"`}
              </h2>
              <button onClick={() => setMappingDraft(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Saved for this department — every later import (any week, any file) treats "{mappingDraft.source}" this way.
            </p>

            {mappingDraft.kind === 'code' && (
              <div className="flex gap-4 mb-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={mappingDraft.mode === 'shift'} onChange={() => setMappingDraft(prev => ({ ...prev, mode: 'shift' }))} />
                  A shift
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={mappingDraft.mode === 'leave'} onChange={() => setMappingDraft(prev => ({ ...prev, mode: 'leave' }))} />
                  Leave
                </label>
              </div>
            )}

            {mappingDraft.kind === 'staff' ? (
              <>
                <div className="flex gap-4 mb-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={mappingDraft.staff_mode === 'existing'} onChange={() => setMappingDraft(prev => ({ ...prev, staff_mode: 'existing' }))} />
                    Existing staff member
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={mappingDraft.staff_mode === 'new'} onChange={() => setMappingDraft(prev => ({ ...prev, staff_mode: 'new' }))} />
                    New staff member
                  </label>
                </div>
                {mappingDraft.staff_mode === 'existing' ? (
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Staff member</label>
                    <select
                      value={mappingDraft.staff_id}
                      onChange={(e) => setMappingDraft(prev => ({ ...prev, staff_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="">— Select a staff member —</option>
                      {[...staffList].filter(st => st.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map(st => (
                        <option key={st.staff_id} value={st.staff_id}>{st.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Name</label>
                      <input
                        type="text"
                        value={mappingDraft.new_name}
                        onChange={(e) => setMappingDraft(prev => ({ ...prev, new_name: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-1">Guessed from the sheet — correct it if needed (e.g. "Rach" → "Rachel").</p>
                    </div>
                    <div className="mb-4 flex gap-3">
                      <div className="flex-1">
                        <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Rank</label>
                        <select
                          value={mappingDraft.new_rank}
                          onChange={(e) => setMappingDraft(prev => ({ ...prev, new_rank: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                          <option value="">— Select a rank —</option>
                          {staffRanks.map(r => (
                            <option key={r.rule_id} value={r.rank}>{r.rank}</option>
                          ))}
                        </select>
                      </div>
                      <div className="w-24">
                        <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">FTE</label>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          value={mappingDraft.new_fte}
                          onChange={(e) => setMappingDraft(prev => ({ ...prev, new_fte: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mb-4">FTE starts at 0 (casual/locum) — set it if they work a regular fraction.</p>
                  </>
                )}
              </>
            ) : mappingDraft.kind === 'code' && mappingDraft.mode === 'leave' ? (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Leave type</label>
                <select
                  value={mappingDraft.leave_type_id}
                  onChange={(e) => setMappingDraft(prev => ({ ...prev, leave_type_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">— Select a leave type —</option>
                  {leaveTypes.map(lt => (
                    <option key={lt.leave_type_id} value={lt.leave_type_id}>{lt.name} ({lt.code})</option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                {mappingDraft.kind !== 'activity' && (
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Location</label>
                    <select
                      value={mappingDraft.location_id}
                      onChange={(e) => handleDraftLocationChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="">— Select a location —</option>
                      {activeLocations.map(l => (
                        <option key={l.location_id} value={l.location_id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {mappingDraft.kind !== 'location' && (
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Activity</label>
                    <select
                      value={mappingDraft.activity_id}
                      onChange={(e) => setMappingDraft(prev => ({ ...prev, activity_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="">— Select an activity —</option>
                      {(mappingDraft.kind === 'code' ? draftActivities : activities).map(a => (
                        <option key={a.activity_id} value={a.activity_id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {mappingDraft.kind === 'code' && (
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Times</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={mappingDraft.start_time}
                        onChange={(e) => setMappingDraft(prev => ({ ...prev, start_time: e.target.value }))}
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                      <span className="text-gray-400">–</span>
                      <input
                        type="time"
                        value={mappingDraft.end_time}
                        onChange={(e) => setMappingDraft(prev => ({ ...prev, end_time: e.target.value }))}
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">In a split code like "OT/{mappingDraft.source}", the half's own morning/afternoon times are used instead.</p>
                  </div>
                )}
              </>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setMappingDraft(null)}
                className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-lg transition text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMapping}
                disabled={savingMapping || !mappingDraftIsComplete(mappingDraft)}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm flex items-center justify-center gap-2"
              >
                {savingMapping && <Loader size={16} className="animate-spin" />}
                Save &amp; re-check
              </button>
            </div>
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
