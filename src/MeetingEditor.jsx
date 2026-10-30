import React, { useState } from 'react';
import { X } from 'lucide-react';
import { AUDIENCE_MODES, audienceLabel, DEFAULT_AUDIENCE } from './meetingAudience';

// The meeting form, used for a meeting type (Settings → Meetings) and for
// one meeting on the Planner: name, time, where, who it's for (the
// two-step AudiencePicker), the reminders, and how to join remotely.

const hhmm = (t) => (t || '').slice(0, 5);

export const blankMeeting = () => ({
  name: '',
  location_id: '',
  start_time: '08:00',
  end_time: '08:30',
  audience: DEFAULT_AUDIENCE,
  push_minutes_before: 10,
  email_morning: true,
  join_url: '',
  dial_in: '',
});

// Database row → form values.
export const meetingDraft = (m) => ({
  name: m.name || '',
  location_id: m.location_id || '',
  start_time: hhmm(m.start_time) || '08:00',
  end_time: hhmm(m.end_time) || '08:30',
  audience: m.audience || DEFAULT_AUDIENCE,
  push_minutes_before: m.push_minutes_before,
  email_morning: !!m.email_morning,
  join_url: m.join_url || '',
  dial_in: m.dial_in || '',
});

// Form values → database fields.
export const meetingFields = (d) => ({
  name: d.name.trim(),
  location_id: d.location_id || null,
  start_time: d.start_time,
  end_time: d.end_time,
  audience: d.audience,
  push_minutes_before: d.push_minutes_before,
  email_morning: d.email_morning,
  join_url: d.join_url.trim() || null,
  dial_in: d.dial_in.trim() || null,
});

export const meetingProblem = (d) => {
  if (!d.name.trim()) return 'Give the meeting a name.';
  if (!d.start_time || !d.end_time) return 'Set when the meeting starts and finishes.';
  if (d.join_url.trim() && !/^https?:\/\//i.test(d.join_url.trim())) return 'The join link should start with https://';
  const a = d.audience;
  if (a?.mode === 'custom' && a.scope === 'people' && !(a.staffIds || []).length) return 'Tick at least one person, or pick another audience.';
  return null;
};

// "Reminders: phone 10 min before · email in the morning"
export function remindersLabel(m) {
  const parts = [];
  if (m.push_minutes_before != null) parts.push(`phone ${m.push_minutes_before} min before`);
  if (m.email_morning) parts.push('email in the morning');
  return parts.length ? parts.join(' · ') : 'no reminders';
}

export function MeetingForm({ value, onChange, locations, staff, rankRows, showName = true }) {
  const [pickingAudience, setPickingAudience] = useState(false);
  const set = (k, v) => onChange({ ...value, [k]: v });
  const pushOn = value.push_minutes_before != null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        {showName && (
          <input
            type="text"
            placeholder="Meeting name (e.g. 'Junior teaching')"
            value={value.name}
            onChange={(e) => set('name', e.target.value)}
            className="flex-1 min-w-[10rem] px-2 py-1 border border-gray-300 rounded text-sm"
          />
        )}
        <label className="flex items-center gap-1 text-sm text-gray-700">
          <input type="time" value={value.start_time} onChange={(e) => set('start_time', e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm" aria-label="Starts" />
          to
          <input type="time" value={value.end_time} onChange={(e) => set('end_time', e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm" aria-label="Finishes" />
        </label>
        <select
          value={value.location_id}
          onChange={(e) => set('location_id', e.target.value)}
          className="px-2 py-1 border border-gray-300 rounded text-sm"
          aria-label="Where"
        >
          <option value="">Where (optional)…</option>
          {locations.map(l => <option key={l.location_id} value={l.location_id}>{l.name}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-gray-700">Who:</span>
        <span className="text-gray-900">{audienceLabel(value.audience)}</span>
        <button onClick={() => setPickingAudience(true)} className="px-2 py-0.5 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs">
          Change…
        </button>
      </div>

      <div className="space-y-1 text-sm text-gray-800">
        <label className="flex flex-wrap items-center gap-2">
          <input type="checkbox" checked={pushOn} onChange={(e) => set('push_minutes_before', e.target.checked ? 10 : null)} />
          Phone notification
          {pushOn && (
            <>
              <input
                type="number"
                min="0"
                max="240"
                value={value.push_minutes_before}
                onChange={(e) => set('push_minutes_before', Math.max(0, Math.min(240, Number(e.target.value) || 0)))}
                className="w-16 px-2 py-0.5 border border-gray-300 rounded text-sm"
                aria-label="Minutes before"
              />
              minutes before
            </>
          )}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.email_morning} onChange={(e) => set('email_morning', e.target.checked)} />
          Email that morning (08:00, or 07:00 for a meeting before 08:30)
        </label>
        <p className="text-xs text-gray-500">People coming off or going on a night shift get the email but not the phone notification.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="url"
          placeholder="Join link (Teams, Zoom…), optional"
          value={value.join_url}
          onChange={(e) => set('join_url', e.target.value)}
          className="flex-1 min-w-[12rem] px-2 py-1 border border-gray-300 rounded text-sm"
        />
        <input
          type="tel"
          placeholder="Dial-in number, optional"
          value={value.dial_in}
          onChange={(e) => set('dial_in', e.target.value)}
          className="w-48 px-2 py-1 border border-gray-300 rounded text-sm"
        />
      </div>

      {pickingAudience && (
        <AudiencePicker
          value={value.audience}
          staff={staff}
          rankRows={rankRows}
          onDone={(audience) => { set('audience', audience); setPickingAudience(false); }}
          onClose={() => setPickingAudience(false)}
        />
      )}
    </div>
  );
}

// Step 1: a quick choice, or Custom. Step 2 (Custom): ranks, then all of
// them, only those working that day, or specific people.
export function AudiencePicker({ value, staff, rankRows, onDone, onClose }) {
  const start = value || DEFAULT_AUDIENCE;
  const [step, setStep] = useState(start.mode === 'custom' ? 2 : 1);
  const [ranks, setRanks] = useState(start.ranks || []);
  const [scope, setScope] = useState(start.scope || 'all');
  const [staffIds, setStaffIds] = useState(start.staffIds || []);

  const rankNames = [...new Set([...(rankRows || []).map(r => r.rank), ...staff.map(s => s.rank)].filter(Boolean))];
  const toggle = (list, setList, item) => setList(list.includes(item) ? list.filter(x => x !== item) : [...list, item]);
  const people = staff
    .filter(s => s.active !== false && (ranks.length === 0 || ranks.includes(s.rank)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const done = () => onDone({
    mode: 'custom',
    ranks,
    scope,
    ...(scope === 'people' ? { staffIds: staffIds.filter(id => people.some(p => p.staff_id === id)) } : {}),
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg p-5 w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-3">
          <h2 className="text-lg font-bold text-gray-900">Who's it for?</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg" aria-label="Close"><X size={20} /></button>
        </div>

        {step === 1 ? (
          <div className="space-y-2">
            {AUDIENCE_MODES.map(m => (
              <button
                key={m.mode}
                onClick={() => (m.mode === 'custom' ? setStep(2) : onDone({ mode: m.mode }))}
                className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${start.mode === m.mode ? 'border-blue-600 bg-blue-50 font-semibold' : 'border-gray-300 hover:bg-gray-50'}`}
              >
                {m.label}
                <span className="block text-xs font-normal text-gray-500">
                  {{
                    everyone: 'Everyone in the department, on shift or not',
                    on_shift: 'Everyone rostered on a shift or on call that day',
                    seniors: 'All seniors, on shift or not (they can dial in)',
                    juniors: 'All juniors, on shift or not (they can dial in)',
                    custom: 'Pick ranks, then all of them, those working, or specific people',
                  }[m.mode]}
                </span>
              </button>
            ))}
            <p className="text-xs text-gray-500">People marked unavailable that day (leave, days off) are left out, unless you tick them by name.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Ranks <span className="font-normal text-gray-500">(none ticked = all ranks)</span></p>
              <div className="flex flex-wrap gap-1.5">
                {rankNames.map(r => (
                  <button
                    key={r}
                    onClick={() => toggle(ranks, setRanks, r)}
                    aria-pressed={ranks.includes(r)}
                    className={`px-2.5 py-1 rounded-full border text-xs ${ranks.includes(r) ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300 text-gray-800'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Of those</p>
              {[
                ['all', 'All of them'],
                ['working', 'Only those working that day'],
                ['people', 'Specific people'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="radio" name="audience-scope" checked={scope === key} onChange={() => setScope(key)} />
                  {label}
                </label>
              ))}
            </div>

            {scope === 'people' && (
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                {people.length === 0 && <p className="text-xs text-gray-500 italic">Nobody in those ranks.</p>}
                {people.map(s => (
                  <label key={s.staff_id} className="flex items-center gap-2 text-sm text-gray-800">
                    <input type="checkbox" checked={staffIds.includes(s.staff_id)} onChange={() => toggle(staffIds, setStaffIds, s.staff_id)} />
                    {s.name}
                    {s.rank && <span className="text-xs text-gray-500">{s.rank}</span>}
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium rounded-lg">Back</button>
              <button
                onClick={done}
                disabled={scope === 'people' && staffIds.length === 0}
                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
