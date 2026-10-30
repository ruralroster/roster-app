import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { getMeetingTypes, createMeetingType, updateMeetingType, deleteMeetingType } from './supabaseClient';
import { MeetingForm, blankMeeting, meetingDraft, meetingFields, meetingProblem, remindersLabel } from './MeetingEditor';
import { audienceLabel } from './meetingAudience';

// ============================================================
// MEETINGS — Settings → Locations & Activities → Meetings
// ============================================================
//
// The department's regular meetings (Junior teaching, ID meeting, SMO
// meeting): usual time, where, who they're for, the reminders and how to
// join remotely. These make up the Planner's Meetings palette. They never
// touch anyone's shift. See migrations/2026-10-31_meetings.sql.

const hhmm = (t) => (t || '').slice(0, 5);

export default function MeetingTypesSettings({ departmentId, locations, staff, rankRows }) {
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [types, setTypes] = useState([]);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState(blankMeeting);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!departmentId) return;
    let cancelled = false;
    setLoading(true);
    getMeetingTypes(departmentId).then(res => {
      if (cancelled) return;
      setLoading(false);
      setMissing(res.missing);
      if (res.error) { setError(`Failed to load meetings: ${res.error.message}`); return; }
      setTypes(res.meetingTypes);
    });
    return () => { cancelled = true; };
  }, [departmentId]);

  const activeLocations = locations.filter(l => l.active !== false);
  const locationName = (id) => locations.find(l => l.location_id === id)?.name;
  const nameTaken = (err, name) => (err.code === '23505' ? `There's already a meeting called "${name}".` : null);

  const handleAdd = async () => {
    const problem = meetingProblem(newDraft);
    if (problem) { setError(problem); return; }
    setBusy(true);
    const nextOrder = types.reduce((m, t) => Math.max(m, t.sort_order ?? 0), -1) + 1;
    const { data, error: addError } = await createMeetingType(departmentId, { ...meetingFields(newDraft), sort_order: nextOrder });
    setBusy(false);
    if (addError) { setError(nameTaken(addError, newDraft.name.trim()) || `Couldn't add the meeting: ${addError.message}`); return; }
    setError(null);
    setTypes(prev => [...prev, data]);
    setNewDraft(blankMeeting());
    setAdding(false);
  };

  const handleSave = async () => {
    const problem = meetingProblem(editDraft);
    if (problem) { setError(problem); return; }
    setBusy(true);
    const { data, error: saveError } = await updateMeetingType(editingId, meetingFields(editDraft));
    setBusy(false);
    if (saveError) { setError(nameTaken(saveError, editDraft.name.trim()) || `Couldn't save the meeting: ${saveError.message}`); return; }
    setError(null);
    setTypes(prev => prev.map(t => (t.meeting_type_id === data.meeting_type_id ? data : t)));
    setEditingId(null);
  };

  const handleDelete = async (id) => {
    setBusy(true);
    const { error: deleteError } = await deleteMeetingType(id);
    setBusy(false);
    if (deleteError) { setError(`Couldn't remove the meeting: ${deleteError.message}`); return; }
    setError(null);
    setTypes(prev => prev.filter(t => t.meeting_type_id !== id));
    setConfirmDeleteId(null);
  };

  if (loading) return <p className="text-sm text-gray-500">Loading meetings…</p>;
  if (missing) {
    return (
      <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900">
        Meetings need the database update in <code>migrations/2026-10-31_meetings.sql</code>. Run it in the Supabase SQL Editor, then reload the app.
      </div>
    );
  }

  const formProps = { locations: activeLocations, staff, rankRows };

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        Regular meetings, such as teaching or a radiology meeting. Put them on a day in the Planner; the people each one is for get a phone notification shortly before and/or an email that morning, with the join link if there is one. They don't change anyone's shift.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {adding ? (
        <div className="mb-4 p-3 border border-gray-200 rounded-lg space-y-2">
          <MeetingForm value={newDraft} onChange={setNewDraft} {...formProps} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); setNewDraft(blankMeeting()); }} className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-lg text-sm">Cancel</button>
            <button onClick={handleAdd} disabled={busy} className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm">Add meeting</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mb-4 px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition text-sm">
          + New meeting
        </button>
      )}

      <div className="space-y-2">
        {types.length === 0 && <p className="text-sm text-gray-500 italic">No meetings yet.</p>}
        {types.map(t => {
          if (editingId === t.meeting_type_id) {
            return (
              <div key={t.meeting_type_id} className="p-3 border border-blue-300 rounded-lg space-y-2">
                <MeetingForm value={editDraft} onChange={setEditDraft} {...formProps} />
                <p className="text-xs text-gray-500">Changes apply to meetings you put on the Planner from now on; ones already there keep their own settings.</p>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditingId(null)} className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded text-xs transition">Cancel</button>
                  <button onClick={handleSave} disabled={busy} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition">Save</button>
                </div>
              </div>
            );
          }
          return (
            <div key={t.meeting_type_id} className="p-3 border border-gray-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-sm text-gray-900">
                  {t.name}
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {hhmm(t.start_time)}–{hhmm(t.end_time)}{locationName(t.location_id) ? ` · ${locationName(t.location_id)}` : ''}
                  </span>
                </p>
                <p className="text-xs text-indigo-700">
                  {audienceLabel(t.audience)} · {remindersLabel(t)}{t.join_url || t.dial_in ? ' · can dial in' : ''}
                </p>
              </div>
              {confirmDeleteId === t.meeting_type_id ? (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-gray-600">Remove {t.name}? Meetings already on the Planner stay.</span>
                  <button onClick={() => handleDelete(t.meeting_type_id)} disabled={busy} className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-medium rounded text-xs transition">Remove</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded text-xs transition">Keep</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => { setEditingId(t.meeting_type_id); setEditDraft(meetingDraft(t)); }} className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition">Edit</button>
                  <button onClick={() => setConfirmDeleteId(t.meeting_type_id)} className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded text-xs transition">Delete</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
