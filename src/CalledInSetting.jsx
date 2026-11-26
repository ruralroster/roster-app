import React, { useState } from 'react';
import { setDepartmentAllowCalledIn, setStaffCanBeCalledIn } from './supabaseClient';

// Reports > Pay Variations: "Called in when not on call" (off by default).
// On, the officer ticks who may use it; those people get a Called in timer
// on Variations any time (CallbackBanner calledIn).
export default function CalledInSetting({ departmentId, department, staff, onChanged }) {
  const [error, setError] = useState(null);
  const allowed = !!department?.allow_called_in;
  const people = (staff || []).filter(s => s.active !== false && !s.non_clinical).sort((a, b) => a.name.localeCompare(b.name));

  const toggleDept = async (on) => {
    const { error: err } = await setDepartmentAllowCalledIn(departmentId, on);
    if (err) { setError(err.message); return; }
    setError(null);
    onChanged({ department: { ...department, allow_called_in: on } });
  };
  const togglePerson = async (s, on) => {
    const { error: err } = await setStaffCanBeCalledIn(s.staff_id, on);
    if (err) { setError(err.message); return; }
    setError(null);
    onChanged({ staffId: s.staff_id, can_be_called_in: on });
  };

  return (
    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
      <label className="flex items-center gap-2 font-semibold text-amber-900">
        <input type="checkbox" checked={allowed} onChange={(e) => toggleDept(e.target.checked)} className="w-4 h-4" />
        Called in when not on call
      </label>
      <p className="text-xs text-gray-600 mt-1">
        For people who get called in without being on call or on shift. The people ticked below get a <strong>Called in (not on call)</strong> timer on Variations any time; it's recorded as "Called in", separate from on-call callbacks.
      </p>
      {allowed && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-48 overflow-y-auto">
          {people.map(s => (
            <label key={s.staff_id} className="flex items-center gap-2 text-gray-800">
              <input type="checkbox" checked={!!s.can_be_called_in} onChange={(e) => togglePerson(s, e.target.checked)} className="w-4 h-4" />
              {s.name} <span className="text-xs text-gray-500">{s.rank}</span>
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-700 mt-1">Couldn't save: {error}</p>}
    </div>
  );
}
