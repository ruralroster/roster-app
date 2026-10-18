import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { getJobTypesAndPlaces, createJobType, updateJobType, deleteJobType } from './supabaseClient';
import JobPlacesModal from './JobPlacesModal';
import JobConversionModal from './JobConversionModal';

// ============================================================
// JOBS — Settings → Locations & Activities → Jobs (Planner)
// ============================================================
//
// The department's regular jobs: a location, an activity and the hours
// the service runs (ED Day = Emergency · ED Cover · 08:00-18:00), plus the
// places each one needs (JobPlacesModal). These are the Planner tab's
// palette. See migrations/2026-10-18_planner_jobs.sql.

const hhmm = (t) => (t || '').slice(0, 5);
const blankJob = () => ({ name: '', location_id: '', activity_id: '', start_time: '08:00', end_time: '18:00' });

function JobFields({ value, onChange, locations, activitiesAllowedAtLocation }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const activities = value.location_id ? activitiesAllowedAtLocation(value.location_id) : [];
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <input
        type="text"
        placeholder="Job name (e.g. 'ED Day')"
        value={value.name}
        onChange={(e) => set('name', e.target.value)}
        className="flex-1 min-w-[9rem] px-2 py-1 border border-gray-300 rounded text-sm"
      />
      <select
        value={value.location_id}
        onChange={(e) => onChange({ ...value, location_id: e.target.value, activity_id: '' })}
        className="px-2 py-1 border border-gray-300 rounded text-sm"
        aria-label="Location"
      >
        <option value="">Location…</option>
        {locations.map(l => <option key={l.location_id} value={l.location_id}>{l.name}</option>)}
      </select>
      <select
        value={value.activity_id}
        onChange={(e) => set('activity_id', e.target.value)}
        disabled={!value.location_id}
        className="px-2 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
        aria-label="Activity"
      >
        <option value="">Activity…</option>
        {activities.map(a => <option key={a.activity_id} value={a.activity_id}>{a.name}</option>)}
      </select>
      <label className="flex items-center gap-1 text-sm text-gray-700">
        <input type="time" value={value.start_time} onChange={(e) => set('start_time', e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm" aria-label="Starts" />
        to
        <input type="time" value={value.end_time} onChange={(e) => set('end_time', e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm" aria-label="Finishes" />
      </label>
    </div>
  );
}

const jobProblem = (j) => {
  if (!j.name.trim()) return 'Give the job a name.';
  if (!j.location_id || !j.activity_id) return 'Pick a location and an activity.';
  if (!j.start_time || !j.end_time) return 'Set when the job starts and finishes.';
  return null;
};

export default function PlannerJobsSettings({ departmentId, locations, activities, activitiesAllowedAtLocation, advancedSkills }) {
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [jobTypes, setJobTypes] = useState([]);
  const [places, setPlaces] = useState([]);
  const [error, setError] = useState(null);
  const [newJob, setNewJob] = useState(blankJob);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [placesJobId, setPlacesJobId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showConvert, setShowConvert] = useState(false);

  useEffect(() => {
    if (!departmentId) return;
    let cancelled = false;
    setLoading(true);
    getJobTypesAndPlaces(departmentId).then(res => {
      if (cancelled) return;
      setLoading(false);
      setMissing(res.missing);
      if (res.error) { setError(`Failed to load jobs: ${res.error.message}`); return; }
      setJobTypes(res.jobTypes);
      setPlaces(res.places);
    });
    return () => { cancelled = true; };
  }, [departmentId]);

  const locationName = (id) => locations.find(l => l.location_id === id)?.name || 'Unknown location';
  const activityName = (id) => activities.find(a => a.activity_id === id)?.name || 'Unknown activity';
  const activeLocations = locations.filter(l => l.active !== false);

  const sortedJobs = [...jobTypes].sort((a, b) =>
    locationName(a.location_id).localeCompare(locationName(b.location_id))
    || hhmm(a.start_time).localeCompare(hhmm(b.start_time))
    || a.name.localeCompare(b.name));

  const handleAdd = async () => {
    const problem = jobProblem(newJob);
    if (problem) { setError(problem); return; }
    setBusy(true);
    const nextOrder = jobTypes.reduce((m, j) => Math.max(m, j.sort_order ?? 0), -1) + 1;
    const { data, error: addError } = await createJobType(departmentId, { ...newJob, name: newJob.name.trim(), sort_order: nextOrder });
    setBusy(false);
    if (addError) {
      setError(addError.code === '23505' ? `There's already a job called "${newJob.name.trim()}".` : `Couldn't add the job: ${addError.message}`);
      return;
    }
    setError(null);
    setJobTypes(prev => [...prev, data]);
    setNewJob(blankJob());
    setPlacesJobId(data.job_type_id); // straight on to what it needs
  };

  const startEdit = (job) => {
    setEditingId(job.job_type_id);
    setEditDraft({ name: job.name, location_id: job.location_id, activity_id: job.activity_id, start_time: hhmm(job.start_time), end_time: hhmm(job.end_time) });
  };

  const handleSaveEdit = async () => {
    const problem = jobProblem(editDraft);
    if (problem) { setError(problem); return; }
    setBusy(true);
    const { data, error: saveError } = await updateJobType(editingId, { ...editDraft, name: editDraft.name.trim() });
    setBusy(false);
    if (saveError) {
      setError(saveError.code === '23505' ? `There's already a job called "${editDraft.name.trim()}".` : `Couldn't save the job: ${saveError.message}`);
      return;
    }
    setError(null);
    setJobTypes(prev => prev.map(j => j.job_type_id === data.job_type_id ? data : j));
    setEditingId(null);
  };

  const handleDelete = async (jobTypeId) => {
    setBusy(true);
    const { error: deleteError } = await deleteJobType(jobTypeId);
    setBusy(false);
    if (deleteError) { setError(`Couldn't remove the job: ${deleteError.message}`); return; }
    setError(null);
    setJobTypes(prev => prev.filter(j => j.job_type_id !== jobTypeId));
    setPlaces(prev => prev.filter(p => p.job_type_id !== jobTypeId));
    setConfirmDeleteId(null);
  };

  if (loading) return <p className="text-sm text-gray-500">Loading jobs…</p>;
  if (missing) {
    return (
      <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900">
        Jobs need the database update in <code>migrations/2026-10-18_planner_jobs.sql</code>. Run it in the Supabase SQL Editor, then reload the app.
      </div>
    );
  }

  const placesJob = jobTypes.find(j => j.job_type_id === placesJobId);

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        Your regular jobs for the Planner: where, what, and the hours the service runs, plus the places each one needs filled. People's own hours on a job still come from their shift.
      </p>
      <div className="mb-3 p-3 bg-teal-50 border border-teal-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-teal-900">Turn the activities already on the roster (and in week templates) into jobs, so nothing shows as "not a job".</p>
        <button onClick={() => setShowConvert(true)} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg text-xs">
          Convert existing activities…
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="mb-4 p-3 border border-gray-200 rounded-lg space-y-2">
        <JobFields value={newJob} onChange={setNewJob} locations={activeLocations} activitiesAllowedAtLocation={activitiesAllowedAtLocation} />
        <div className="flex justify-end">
          <button onClick={handleAdd} disabled={busy} className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm">
            Add job
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {sortedJobs.length === 0 && <p className="text-sm text-gray-500 italic">No jobs yet.</p>}
        {sortedJobs.map(job => {
          const jobPlaces = places.filter(p => p.job_type_id === job.job_type_id);
          if (editingId === job.job_type_id) {
            return (
              <div key={job.job_type_id} className="p-3 border border-blue-300 rounded-lg space-y-2">
                <JobFields value={editDraft} onChange={setEditDraft} locations={activeLocations} activitiesAllowedAtLocation={activitiesAllowedAtLocation} />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditingId(null)} className="px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white font-medium rounded text-xs transition">Cancel</button>
                  <button onClick={handleSaveEdit} disabled={busy} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition">Save</button>
                </div>
              </div>
            );
          }
          return (
            <div key={job.job_type_id} className="p-3 border border-gray-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-sm text-gray-900">
                  {job.name}
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {locationName(job.location_id)} · {activityName(job.activity_id)} · {hhmm(job.start_time)}–{hhmm(job.end_time)}
                  </span>
                </p>
                <p className={`text-xs ${jobPlaces.length ? 'text-teal-700' : 'text-amber-700'}`}>
                  {jobPlaces.length
                    ? jobPlaces.map(p => (p.min_count > 1 ? `${p.min_count} × ${p.role}` : p.role) + (p.kind === 'visitor' ? ' (visitor)' : '')).join(' + ')
                    : 'No places yet'}
                </p>
              </div>
              {confirmDeleteId === job.job_type_id ? (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-gray-600">Remove {job.name} and its places? Bookings already made stay.</span>
                  <button onClick={() => handleDelete(job.job_type_id)} disabled={busy} className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-medium rounded text-xs transition">Remove</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded text-xs transition">Keep</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setPlacesJobId(job.job_type_id)} className="px-3 py-1 bg-teal-100 hover:bg-teal-200 text-teal-900 font-medium rounded text-xs transition">Places</button>
                  <button onClick={() => startEdit(job)} className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition">Edit</button>
                  <button onClick={() => setConfirmDeleteId(job.job_type_id)} className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded text-xs transition">Delete</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showConvert && (
        <JobConversionModal
          departmentId={departmentId}
          jobTypes={jobTypes}
          locations={locations}
          activities={activities}
          onJobsChange={setJobTypes}
          onClose={() => setShowConvert(false)}
        />
      )}

      {placesJob && (
        <JobPlacesModal
          departmentId={departmentId}
          job={placesJob}
          places={places.filter(p => p.job_type_id === placesJob.job_type_id)}
          advancedSkills={advancedSkills}
          onPlacesChange={(next) => setPlaces(prev => [...prev.filter(p => p.job_type_id !== placesJob.job_type_id), ...next])}
          onClose={() => setPlacesJobId(null)}
        />
      )}
    </div>
  );
}
