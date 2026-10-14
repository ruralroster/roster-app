import React, { useState, useEffect, useCallback } from 'react';
import { PhoneCall, PhoneOff, AlertCircle, Loader, Download, X, Moon, Trash2, Pencil, Clock } from 'lucide-react';
import {
  getMyVariationOptions,
  getMyOpenCallback,
  startCallback,
  completeCallback,
  deleteCallback,
  getMyCallbacks,
  updateCallbackTimes,
} from './supabaseClient';
import {
  SHORT_CALL_MS,
  FATIGUE_NOTICE_MS,
  fatigueReturnTime,
  formatElapsed,
  formatDuration,
  formatClock,
  formatCallDate,
  buildCallbackNoteText,
  callbackNoteFilename,
  toDateTimeLocalValue,
  validateCallTimes,
  variationLabel,
  variationFor,
  VARIATION_KIND_LABEL,
} from './callbackUtils';
import { buildCsv, downloadTextFile } from './icsExport';

const VARIATION_CSV_COLUMNS = [
  { header: 'Date', value: c => formatCallDate(c.started_at) },
  { header: 'Type', value: c => VARIATION_KIND_LABEL[c.kind] || 'Callback' },
  { header: 'For', value: c => c.for },
  { header: 'Started', value: c => formatClock(c.started_at) },
  { header: 'Finished', value: c => formatClock(c.ended_at) },
  { header: 'Duration (min)', value: c => Math.round((new Date(c.ended_at) - new Date(c.started_at)) / 60000) },
];

// "Variations" card shown at the very top of the staff Variation tab: one
// Callback button per on-call slot this person is inside right now, and an
// Overtime button per rostered shift in its overtime window (30 min before
// it ends to 4 h after). While one is running it becomes a timer with a
// Stop button — shown even if the on-call/overtime window has since ended,
// so it can always be stopped. Calls onRecorded after one is kept, so the
// My Variations list below can refresh.
export function CallbackBanner({ staffId, departmentId, staffName, dutyTypes, onRecorded }) {
  const [options, setOptions] = useState({ onCalls: [], shifts: [] });
  const [openCall, setOpenCall] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => new Date());

  // Stop flow: 'confirm-short' (under 15 min: keep or discard?)
  // → 'patient' (optional MRN/name, downloaded only) → fatigue notice.
  const [completeStep, setCompleteStep] = useState(null);
  const [completedCall, setCompletedCall] = useState(null); // { started_at, ended_at, callback_id? }
  const [mrn, setMrn] = useState('');
  const [surname, setSurname] = useState('');
  const [firstName, setFirstName] = useState('');
  const [fatigueUntil, setFatigueUntil] = useState(null);

  const refresh = useCallback(async () => {
    if (!staffId || !departmentId) return;
    const [{ data: opts, error: optsErr }, { data: open, error: openErr }] = await Promise.all([
      getMyVariationOptions(staffId, departmentId),
      getMyOpenCallback(staffId),
    ]);
    if (optsErr || openErr) setError(`Couldn't check your on-call/shift status: ${(optsErr || openErr).message}`);
    setOptions(opts);
    setOpenCall(open);
    setLoaded(true);
  }, [staffId, departmentId]);

  // Re-check every minute, so buttons appear/disappear as on-call and
  // overtime windows start/end while the app is open.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  // Tick the on-screen timer while a call is running. The timer is just
  // now − started_at (stored in the database), so it survives the app
  // closing.
  useEffect(() => {
    if (!openCall) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [openCall]);

  useEffect(() => {
    if (!fatigueUntil) return;
    const id = setTimeout(() => setFatigueUntil(null), FATIGUE_NOTICE_MS);
    return () => clearTimeout(id);
  }, [fatigueUntil]);

  const handleStart = async (start) => {
    setBusy(true);
    const { data, error: err } = await startCallback(departmentId, staffId, start);
    setBusy(false);
    if (err) {
      setError(`Couldn't start: ${err.message}`);
      refresh();
      return;
    }
    setError(null);
    setNow(new Date());
    setOpenCall(data);
  };

  const handleCallComplete = async () => {
    if (!openCall) return;
    const endedAt = new Date();
    if (endedAt - new Date(openCall.started_at) < SHORT_CALL_MS) {
      setCompletedCall({ ...openCall, ended_at: endedAt.toISOString() });
      setCompleteStep('confirm-short');
      return;
    }
    await recordCall(openCall, endedAt);
  };

  const recordCall = async (call, endedAt) => {
    setBusy(true);
    const { data, error: err } = await completeCallback(call.callback_id, endedAt);
    setBusy(false);
    if (err) {
      setError(`Couldn't save the call: ${err.message}`);
      return;
    }
    setError(null);
    setOpenCall(null);
    setCompletedCall(data);
    setMrn('');
    setSurname('');
    setFirstName('');
    setCompleteStep('patient');
    onRecorded?.();
  };

  const handleDiscardShort = async () => {
    setBusy(true);
    const { error: err } = await deleteCallback(completedCall.callback_id);
    setBusy(false);
    if (err) {
      setError(`Couldn't discard the call: ${err.message}`);
      return;
    }
    setError(null);
    setOpenCall(null);
    setCompletedCall(null);
    setCompleteStep(null);
  };

  // Patient details go into a text file on this phone only — never sent
  // to the server.
  const handleDownloadNote = () => {
    downloadTextFile(callbackNoteFilename(completedCall.started_at), 'text/plain', buildCallbackNoteText({
      staffName,
      variationLabel: variationLabel(completedCall, dutyTypes),
      startedAt: completedCall.started_at,
      endedAt: completedCall.ended_at,
      mrn: mrn.trim(),
      surname: surname.trim(),
      firstName: firstName.trim(),
    }));
    finishPatientStep();
  };

  const finishPatientStep = () => {
    setMrn('');
    setSurname('');
    setFirstName('');
    setFatigueUntil(fatigueReturnTime(completedCall.ended_at));
    setCompletedCall(null);
    setCompleteStep(null);
  };

  const fatigueNotice = fatigueUntil && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-indigo-900/90 p-6" onClick={() => setFatigueUntil(null)}>
      <div className="text-center text-white max-w-sm animate-pulse">
        <Moon size={56} className="mx-auto mb-4" />
        <p className="text-2xl font-bold mb-3">You are on fatigue</p>
        <p className="text-lg">
          Please don't reattend until <span className="font-bold">{formatClock(fatigueUntil)}</span>
          {' '}({fatigueUntil.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}).
        </p>
        <p className="text-sm text-indigo-200 mt-4">10 hours after you finished.</p>
      </div>
    </div>
  );

  const completeModal = completeStep && completedCall && (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        {completeStep === 'confirm-short' ? (
          <>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Under 15 minutes</h2>
            <p className="text-sm text-gray-700 mb-6">
              This {completedCall.kind === 'overtime' ? 'overtime' : 'call'} lasted {formatDuration(new Date(completedCall.ended_at) - new Date(completedCall.started_at))} — under 15 minutes. Do you want to record it?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDiscardShort}
                disabled={busy}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-lg transition disabled:opacity-50"
              >
                Don't record
              </button>
              <button
                onClick={() => recordCall(completedCall, completedCall.ended_at)}
                disabled={busy}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-50"
              >
                Record it
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between mb-2">
              <h2 className="text-xl font-bold text-gray-900">{VARIATION_KIND_LABEL[completedCall.kind] || 'Callback'} recorded</h2>
              <button onClick={finishPatientStep} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-700 mb-1">
              {formatClock(completedCall.started_at)} – {formatClock(completedCall.ended_at)} ({formatDuration(new Date(completedCall.ended_at) - new Date(completedCall.started_at))})
            </p>
            <p className="text-xs text-gray-500 mb-4">
              Optional: which patient was this for? This is <span className="font-semibold">only saved to a text file on this phone</span> — the app never stores patient details.
            </p>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">MRN</label>
            <input value={mrn} onChange={e => setMrn(e.target.value)} inputMode="numeric" autoComplete="off" className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-3" />
            <p className="text-xs text-gray-500 text-center mb-3">or</p>
            <div className="flex gap-2 mb-6">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Last name</label>
                <input value={surname} onChange={e => setSurname(e.target.value)} autoComplete="off" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">First name</label>
                <input value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="off" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={finishPatientStep} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-lg transition">
                Skip
              </button>
              <button
                onClick={handleDownloadNote}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
              >
                <Download size={18} />
                Download to phone
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  const hasOptions = options.onCalls.length > 0 || options.shifts.length > 0;
  if (!loaded || (!hasOptions && !openCall)) {
    return <>{completeModal}{fatigueNotice}</>;
  }

  return (
    <>
      {openCall ? (
        <div className="bg-red-600 text-white rounded-lg shadow-sm p-6 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-100">In progress · {variationLabel(openCall, dutyTypes)}</p>
          <p className="text-4xl font-bold font-mono my-2">{formatElapsed(now - new Date(openCall.started_at))}</p>
          <p className="text-sm text-red-100 mb-4">Started {formatClock(openCall.started_at)}</p>
          <button
            onClick={handleCallComplete}
            disabled={busy}
            className="w-full py-4 bg-white text-red-700 text-lg font-bold rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader size={20} className="animate-spin" /> : <PhoneOff size={20} />}
            {openCall.kind === 'overtime' ? 'Overtime Complete' : 'Call Complete'}
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Variations</h1>
          <p className="text-sm text-gray-500 mb-4">Tap when it starts — tap again when you're done.</p>
          <div className="space-y-3">
            {options.onCalls.map(oc => (
              <button
                key={`${oc.date}-${oc.duty_type}`}
                onClick={() => handleStart({ kind: 'callback', dutyDate: oc.date, dutyType: oc.duty_type })}
                disabled={busy}
                className="w-full py-4 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-3 disabled:opacity-50 text-left"
              >
                {busy ? <Loader size={22} className="animate-spin flex-shrink-0" /> : <PhoneCall size={22} className="flex-shrink-0" />}
                <span>
                  <span className="block text-lg font-bold">Callback — {oc.label}</span>
                  <span className="block text-xs text-green-100">On call until {formatClock(oc.end)}</span>
                </span>
              </button>
            ))}
            {options.shifts.map(sh => (
              <button
                key={`${sh.date}-${sh.shift_id}`}
                onClick={() => handleStart({ kind: 'overtime', dutyDate: sh.date, shiftId: sh.shift_id })}
                disabled={busy}
                className="w-full py-4 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-3 disabled:opacity-50 text-left"
              >
                {busy ? <Loader size={22} className="animate-spin flex-shrink-0" /> : <Clock size={22} className="flex-shrink-0" />}
                <span>
                  <span className="block text-lg font-bold">Overtime — {sh.label}</span>
                  <span className="block text-xs text-blue-100">Shift ends {formatClock(sh.end)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {completeModal}
      {fatigueNotice}
    </>
  );
}

// "My Variations" — this person's recorded callbacks and overtime (times
// only), to copy into the payroll variation form. Times can be corrected
// (e.g. Complete tapped late); download as CSV, then delete once submitted.
export function MyCallbacks({ staffId, dutyTypes, refreshKey }) {
  const [callbacks, setCallbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Inline time correction for one call at a time.
  const [editingId, setEditingId] = useState(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editError, setEditError] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (!staffId) return;
    const load = async () => {
      setLoading(true);
      const { data, error: err } = await getMyCallbacks(staffId);
      setError(err ? `Failed to load your variations: ${err.message}` : null);
      setCallbacks(data);
      setLoading(false);
    };
    load();
  }, [staffId, refreshKey]);

  const rows = callbacks.map(c => ({ ...c, label: variationLabel(c, dutyTypes), for: variationFor(c, dutyTypes) }));
  const totalMs = rows.reduce((sum, c) => sum + (new Date(c.ended_at) - new Date(c.started_at)), 0);

  const handleDelete = async (ids) => {
    const message = ids.length === 1
      ? 'Delete this record? Make sure it is on your payroll variation form first.'
      : `Delete all ${ids.length} records? Make sure they are on your payroll variation form first.`;
    if (!window.confirm(message)) return;
    for (const id of ids) {
      const { error: err } = await deleteCallback(id);
      if (err) {
        setError(`Failed to delete: ${err.message}`);
        return;
      }
      setCallbacks(prev => prev.filter(c => c.callback_id !== id));
    }
    setError(null);
  };

  const startEdit = (c) => {
    setEditingId(c.callback_id);
    setEditStart(toDateTimeLocalValue(c.started_at));
    setEditEnd(toDateTimeLocalValue(c.ended_at));
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    // datetime-local values carry no timezone, so new Date() reads them as
    // this phone's local time — same as how they were shown.
    const validation = validateCallTimes(editStart, editEnd);
    if (validation) {
      setEditError(validation);
      return;
    }
    setSavingEdit(true);
    const { data, error: err } = await updateCallbackTimes(editingId, new Date(editStart), new Date(editEnd));
    setSavingEdit(false);
    if (err) {
      setEditError(`Failed to save: ${err.message}`);
      return;
    }
    setCallbacks(prev => prev
      .map(c => (c.callback_id === data.callback_id ? data : c))
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at)));
    setEditingId(null);
  };

  if (loading) return <div className="text-center py-4"><Loader size={20} className="animate-spin mx-auto" /></div>;

  return (
    <>
      <p className="text-xs text-gray-600 mb-4">
        Callbacks and overtime you've recorded — use these for your payroll variation form. Tap the pencil to correct a time. Download them, then delete them once submitted.
      </p>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No variations recorded.</p>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-700">{rows.length} record{rows.length === 1 ? '' : 's'} · {formatDuration(totalMs)} total</p>
            <div className="flex gap-2">
              <button
                onClick={() => downloadTextFile('my_variations.csv', 'text/csv', buildCsv(VARIATION_CSV_COLUMNS, rows))}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition flex items-center gap-1.5"
              >
                <Download size={14} />
                Download
              </button>
              <button
                onClick={() => handleDelete(rows.map(c => c.callback_id))}
                className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-900 text-xs font-medium rounded-lg transition"
              >
                Delete all
              </button>
            </div>
          </div>
          <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg">
            {rows.map(c => (editingId === c.callback_id ? (
              <div key={c.callback_id} className="px-3 py-3 bg-blue-50">
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Started</label>
                <input type="datetime-local" value={editStart} onChange={e => setEditStart(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-3" />
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Finished</label>
                <input type="datetime-local" value={editEnd} onChange={e => setEditEnd(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-3" />
                {editError && <p className="text-sm text-red-700 mb-3">{editError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => setEditingId(null)} className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium rounded-lg transition">
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={savingEdit}
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
                  >
                    {savingEdit ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <div key={c.callback_id} className="flex items-center justify-between px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{formatCallDate(c.started_at)}</p>
                  <p className="text-xs text-gray-600">
                    {formatClock(c.started_at)} – {formatClock(c.ended_at)} · {formatDuration(new Date(c.ended_at) - new Date(c.started_at))} · {c.label}
                    {c.edited_at && <span className="ml-1 text-amber-700">· edited</span>}
                  </p>
                </div>
                <div className="flex">
                  <button onClick={() => startEdit(c)} className="p-2 text-gray-400 hover:text-blue-600" title="Edit times">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => handleDelete([c.callback_id])} className="p-2 text-gray-400 hover:text-red-600" title="Delete">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )))}
          </div>
        </>
      )}
    </>
  );
}
