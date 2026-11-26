import React, { useEffect, useState } from 'react';
import { Mail, Upload, X } from 'lucide-react';
import { getMyUnsentVariations, getMyLastVariationSend, markMyVariationsSent } from './supabaseClient';
import { variationRef, variationFor, buildEsoEmail, mailtoHref, parseEsoSummaryLines, formatCallDate, formatClock } from './callbackUtils';

// The weekly nudge (2026-11-26): when it's been more than a week since a
// doctor last sent their variations to the department's ESO (or since their
// oldest unsent one, if they never have) and some are unsent, opening the
// app asks them to send a summary. Their saved text files can be added, so
// the patient details go in the email too: read here, in memory, never
// stored or sent to Rstar. Times come from Rstar.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SNOOZE_KEY = 'rstar-variations-reminder-later';

export default function VariationsReminder({ staffId, staffName, esoEmail, dutyTypes }) {
  const [unsent, setUnsent] = useState(null);
  const [details, setDetails] = useState({}); // ref -> { mrn, surname, firstName }, from their files
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!staffId || !esoEmail) return;
    try { if (sessionStorage.getItem(SNOOZE_KEY)) return; } catch { /* no storage: ask anyway */ }
    let cancelled = false;
    Promise.all([getMyUnsentVariations(staffId), getMyLastVariationSend(staffId)]).then(([{ data }, last]) => {
      if (cancelled || !data?.length) return;
      const since = last ? new Date(last) : new Date(data[0].ended_at);
      if (Date.now() - since.getTime() > WEEK_MS) {
        setUnsent(data);
        setOpen(true);
      }
    });
    return () => { cancelled = true; };
  }, [staffId, esoEmail]);

  if (!open || !unsent?.length) return null;

  const later = () => {
    try { sessionStorage.setItem(SNOOZE_KEY, '1'); } catch { /* fine */ }
    setOpen(false);
  };

  // Their saved "Rstar variation …" files: read for the patient details on
  // each one's RSTAR line, kept only in this page's memory.
  const addFiles = async (e) => {
    const found = {};
    for (const file of Array.from(e.target.files || [])) {
      try {
        for (const line of parseEsoSummaryLines(await file.text())) {
          if (line.ref && (line.mrn || line.surname || line.firstName)) found[line.ref] = { mrn: line.mrn, surname: line.surname, firstName: line.firstName };
        }
      } catch { /* not a text file: skip */ }
    }
    setDetails(prev => ({ ...prev, ...found }));
    e.target.value = '';
  };

  const send = async () => {
    const variations = unsent.map(c => {
      const ref = variationRef(c.callback_id);
      return { ref, kind: c.kind, label: variationFor(c, dutyTypes), startedAt: c.started_at, endedAt: c.ended_at, ...(details[ref] || {}) };
    });
    await markMyVariationsSent(unsent.map(c => c.callback_id));
    setOpen(false);
    window.location.href = mailtoHref(esoEmail, buildEsoEmail(staffName, variations));
  };

  const withDetails = unsent.filter(c => details[variationRef(c.callback_id)]).length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-2">
          <h2 className="text-lg font-bold text-gray-900">Send your variations?</h2>
          <button onClick={later} className="p-1 hover:bg-gray-100 rounded-lg" aria-label="Later"><X size={20} /></button>
        </div>
        <p className="text-sm text-gray-700 mb-3">
          Would you like to take a few seconds to send a summary of your overtimes and call backs to the department ESO for completion?
        </p>
        <ul className="text-sm text-gray-800 mb-3 space-y-1">
          {unsent.map(c => {
            const ref = variationRef(c.callback_id);
            return (
              <li key={c.callback_id} className="flex justify-between gap-2">
                <span>{c.kind === 'overtime' ? 'Overtime' : 'Callback'} · {formatCallDate(c.started_at)} {formatClock(c.started_at)}–{formatClock(c.ended_at)}</span>
                <span className={`text-xs ${details[ref] ? 'text-green-700' : 'text-gray-400'}`}>{details[ref] ? 'patient ✓' : ref}</span>
              </li>
            );
          })}
        </ul>
        <label className="w-full mb-3 py-2 border border-dashed border-gray-400 rounded-lg text-sm text-gray-700 flex items-center justify-center gap-2 cursor-pointer hover:bg-gray-50">
          <Upload size={16} />
          {withDetails ? `Patient details from ${withDetails} of ${unsent.length} files` : 'Add patient details from your saved files'}
          <input type="file" multiple accept=".txt,text/plain" onChange={addFiles} className="hidden" />
        </label>
        <p className="text-xs text-gray-500 mb-4">Your files are read on this phone only, to put the patient details in the email. Rstar never keeps them.</p>
        <div className="flex gap-3">
          <button onClick={later} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-lg">Later</button>
          <button onClick={send} className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2">
            <Mail size={18} /> Send summary
          </button>
        </div>
      </div>
    </div>
  );
}
