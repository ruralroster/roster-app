import React, { useState } from 'react';
import { X, AlertCircle, Trash2 } from 'lucide-react';
import { createJobPlace, updateJobPlace, deleteJobPlace } from './supabaseClient';

// ============================================================
// JOB PLACES — Settings → Jobs → "Places"
// ============================================================
//
// The places a job needs before it's covered, for the Planner tab — e.g.
// Endoscopy: Endoscopist + Anaesthetist. See
// migrations/2026-10-18_planner_jobs.sql for what each field means.

const KIND_OPTIONS = [
  { value: 'staff', label: 'Staff' },
  { value: 'visitor', label: 'Visitor only' },
  { value: 'either', label: 'Staff or visitor' },
];
const GRADE_OPTIONS = [
  { value: 'any', label: 'Any grade' },
  { value: 'senior', label: 'Senior' },
  { value: 'junior', label: 'Junior' },
];

const blankPlace = () => ({ role: '', kind: 'staff', grade: 'any', required_advanced_skills: [], min_count: 1 });

function PlaceFields({ value, onChange, advancedSkills }) {
  // A visitor-only place is never filled from the roster, so grade and
  // skills don't apply to it.
  const set = (k, v) => onChange(k === 'kind' && v === 'visitor'
    ? { ...value, kind: v, grade: 'any', required_advanced_skills: [] }
    : { ...value, [k]: v });
  const toggleSkill = (id) => set('required_advanced_skills', value.required_advanced_skills.includes(id)
    ? value.required_advanced_skills.filter(s => s !== id)
    : [...value.required_advanced_skills, id]);
  const isVisitorOnly = value.kind === 'visitor';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Role (e.g. 'Anaesthetist')"
          value={value.role}
          onChange={(e) => set('role', e.target.value)}
          className="flex-1 min-w-[10rem] px-2 py-1 border border-gray-300 rounded text-sm"
        />
        <select value={value.kind} onChange={(e) => set('kind', e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm">
          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {!isVisitorOnly && (
          <select value={value.grade} onChange={(e) => set('grade', e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm">
            {GRADE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1 text-sm text-gray-700">
          How many
          <input
            type="number"
            min={1}
            max={10}
            value={value.min_count}
            onChange={(e) => set('min_count', Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            className="w-14 px-2 py-1 border border-gray-300 rounded text-sm"
          />
        </label>
      </div>
      {!isVisitorOnly && advancedSkills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-600">Needs any one of:</span>
          {advancedSkills.map(skill => {
            const on = value.required_advanced_skills.includes(skill.advanced_skill_id);
            return (
              <button
                key={skill.advanced_skill_id}
                type="button"
                onClick={() => toggleSkill(skill.advanced_skill_id)}
                aria-pressed={on}
                className={`px-2 py-0.5 rounded-full text-xs border transition ${on ? 'bg-purple-100 border-purple-400 text-purple-900 font-semibold' : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'}`}
              >
                {skill.name}
              </button>
            );
          })}
          {value.required_advanced_skills.length === 0 && <span className="text-xs text-gray-400 italic">no skill needed</span>}
        </div>
      )}
    </div>
  );
}

const samePlace = (a, b) => a.role === b.role && a.kind === b.kind && a.grade === b.grade && a.min_count === b.min_count
  && a.required_advanced_skills.length === b.required_advanced_skills.length
  && a.required_advanced_skills.every(id => b.required_advanced_skills.includes(id));

function PlaceRow({ place, advancedSkills, onSaved, onDeleted, setError }) {
  const [draft, setDraft] = useState({ ...place, required_advanced_skills: place.required_advanced_skills || [] });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = !samePlace(draft, { ...place, required_advanced_skills: place.required_advanced_skills || [] });

  const save = async () => {
    if (!draft.role.trim()) { setError('Give the place a role name first.'); return; }
    setBusy(true);
    const { data, error } = await updateJobPlace(place.place_id, { ...draft, role: draft.role.trim() });
    setBusy(false);
    if (error) { setError(`Couldn't save the place: ${error.message}`); return; }
    setError(null);
    onSaved(data);
  };
  const remove = async () => {
    setBusy(true);
    const { error } = await deleteJobPlace(place.place_id);
    setBusy(false);
    if (error) { setError(`Couldn't remove the place: ${error.message}`); return; }
    setError(null);
    onDeleted(place.place_id);
  };

  return (
    <div className="p-3 border border-gray-200 rounded-lg space-y-2">
      <PlaceFields value={draft} onChange={setDraft} advancedSkills={advancedSkills} />
      <div className="flex flex-wrap gap-2 justify-end">
        {confirmDelete ? (
          <>
            <span className="text-xs text-gray-600 self-center">Remove this place? Anyone booked into it stays on the job as an extra.</span>
            <button onClick={remove} disabled={busy} className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-medium rounded text-xs transition">Remove</button>
            <button onClick={() => setConfirmDelete(false)} className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded text-xs transition">Keep</button>
          </>
        ) : (
          <>
            {dirty && (
              <>
                <button onClick={() => setDraft({ ...place, required_advanced_skills: place.required_advanced_skills || [] })} className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded text-xs transition">Undo changes</button>
                <button onClick={save} disabled={busy} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition">Save</button>
              </>
            )}
            <button onClick={() => setConfirmDelete(true)} className="p-1 text-gray-500 hover:text-red-600 rounded transition" aria-label={`Remove ${place.role}`} title="Remove this place">
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function JobPlacesModal({ departmentId, job, places, advancedSkills, onPlacesChange, onClose }) {
  const [newPlace, setNewPlace] = useState(blankPlace);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    if (!newPlace.role.trim()) { setError('Give the place a role name first.'); return; }
    setBusy(true);
    const nextOrder = places.reduce((m, p) => Math.max(m, p.sort_order ?? 0), -1) + 1;
    const { data, error: addError } = await createJobPlace(departmentId, job.job_type_id, { ...newPlace, role: newPlace.role.trim(), sort_order: nextOrder });
    setBusy(false);
    if (addError) { setError(`Couldn't add the place: ${addError.message}`); return; }
    setError(null);
    setNewPlace(blankPlace());
    onPlacesChange([...places, data]);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{job.name} — Places</h2>
            <p className="text-sm text-gray-600">
              What {job.name} needs before it's covered, for the Planner tab. This is the minimum: you can always add more people to a job.
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
            <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          {places.length === 0 && (
            <p className="text-sm text-gray-500 italic">No places yet. A job with no places is never shown as short in the Planner.</p>
          )}
          {places.map(place => (
            <PlaceRow
              key={place.place_id}
              place={place}
              advancedSkills={advancedSkills}
              setError={setError}
              onSaved={(saved) => onPlacesChange(places.map(p => p.place_id === saved.place_id ? saved : p))}
              onDeleted={(placeId) => onPlacesChange(places.filter(p => p.place_id !== placeId))}
            />
          ))}
        </div>

        <div className="mt-4 p-3 bg-blue-50 rounded-lg space-y-2">
          <p className="text-xs font-semibold text-gray-600 uppercase">Add a place</p>
          <PlaceFields value={newPlace} onChange={setNewPlace} advancedSkills={advancedSkills} />
          <div className="flex justify-end">
            <button onClick={handleAdd} disabled={busy} className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm">
              Add place
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
