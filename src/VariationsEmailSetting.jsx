import React, { useState } from 'react';
import { saveVariationsEmail } from './supabaseClient';

// Reports > Pay Variations: where this department's variations go (the
// ESO). Set, doctors get Email to ESO when they finish a callback or
// overtime, and the weekly reminder (VariationsReminder).
export default function VariationsEmailSetting({ departmentId, current, onSaved }) {
  const [value, setValue] = useState(current || '');
  const [state, setState] = useState(null); // 'saving' | 'saved' | error text
  const save = async () => {
    setState('saving');
    const { error } = await saveVariationsEmail(departmentId, value);
    if (error) { setState(error.message); return; }
    setState('saved');
    onSaved?.(value.trim().toLowerCase() || null);
  };
  return (
    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
      <label className="block text-xs font-semibold text-blue-900 uppercase mb-1">Variations go to (ESO email)</label>
      <div className="flex gap-2">
        <input type="email" value={value} onChange={(e) => { setValue(e.target.value); setState(null); }} placeholder="eso@health.qld.gov.au" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg" />
        <button onClick={save} disabled={state === 'saving'} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium">Save</button>
      </div>
      <p className="text-xs text-gray-600 mt-1">
        {state === 'saved' ? 'Saved. ' : state && state !== 'saving' ? `Couldn't save: ${state}. ` : ''}
        Doctors email their callbacks and overtime here, with the patient details, from their own email; Rstar never sees the patient details. Anyone with unsent ones is reminded weekly.
      </p>
    </div>
  );
}
