import React, { useState, useEffect } from 'react';
import { getMyBirthday, setMyBirthday } from './supabaseClient';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const dietLabel = (b) => [b.dairy_free && 'dairy free', b.gluten_free && 'gluten free'].filter(Boolean).join(', ');

// Settings → Profile, under Phone: opt in to a birthday notification.
// Day and month only (no year); private to this person — see
// migrations/2026-11-06b_birthdays.sql. On the day the coffee run is told,
// and the person gets a Happy birthday (BirthdayGreeting).
export default function BirthdaySetting({ staffId }) {
  const [birthday, setBirthday] = useState(null); // { day, month, dairy_free, gluten_free } or null
  const [editing, setEditing] = useState(null); // the form's copy while choosing
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!staffId) return;
    getMyBirthday(staffId).then(({ data, error: loadError }) => {
      if (loadError) console.error('Failed to load birthday:', loadError);
      else setBirthday(data);
    });
  }, [staffId]);

  const save = async (next) => {
    setSaving(true);
    const { error: saveError } = await setMyBirthday(staffId, next);
    setSaving(false);
    if (saveError) {
      setError(`Couldn't save: ${saveError.message}`);
      return;
    }
    setBirthday(next);
    setEditing(null);
    setError(null);
  };

  const selectClass = 'border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white';

  return (
    <div className="py-3">
      <div className="flex justify-between items-center gap-4">
        <dt className="text-sm text-gray-500">Birthday notification</dt>
        <dd className="text-sm font-semibold text-gray-900 text-right">
          {birthday && !editing ? (
            <span className="flex items-center gap-2">
              🎂 {birthday.day} {MONTHS[birthday.month - 1]}{dietLabel(birthday) && ` · ${dietLabel(birthday)}`}
              <button onClick={() => setEditing(birthday)} className="text-xs font-medium text-blue-600 hover:text-blue-800">Change</button>
            </span>
          ) : !editing && (
            <button onClick={() => setEditing({ day: 1, month: 1, dairy_free: false, gluten_free: false })} className="text-xs font-medium text-blue-600 hover:text-blue-800">
              Would you like one?
            </button>
          )}
        </dd>
      </div>
      {editing && (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-600 mb-2">
            On your birthday, whoever does the coffee order gets a little birthday pop-up with your name. Just the day and month, no year, and nobody can look it up.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={editing.day}
              onChange={e => setEditing({ ...editing, day: Number(e.target.value) })}
              className={selectClass}
              aria-label="Day"
            >
              {Array.from({ length: DAYS_IN_MONTH[editing.month - 1] }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select
              value={editing.month}
              onChange={e => {
                const month = Number(e.target.value);
                setEditing({ ...editing, month, day: Math.min(editing.day, DAYS_IN_MONTH[month - 1]) });
              }}
              className={selectClass}
              aria-label="Month"
            >
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {[['dairy_free', 'Dairy free'], ['gluten_free', 'Gluten free']].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!editing[key]}
                  onChange={e => setEditing({ ...editing, [key]: e.target.checked })}
                  className="w-4 h-4 accent-blue-600"
                />
                {label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2 mt-3">
            {birthday && (
              <button onClick={() => save(null)} disabled={saving} className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-40">
                Turn off
              </button>
            )}
            <button onClick={() => { setEditing(null); setError(null); }} disabled={saving} className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
              Cancel
            </button>
            <button onClick={() => save(editing)} disabled={saving} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
