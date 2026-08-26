import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader, CheckCircle2, CircleDashed } from 'lucide-react';
import { getStaffList, inviteStaff, updateStaffRole, supabase } from './supabaseClient';
import { RANK_OPTIONS } from './StaffAvailabilityTab';

const ROLE_OPTIONS = [
  { value: 'staff', label: 'Staff' },
  { value: 'officer', label: 'Officer' },
  { value: 'intern', label: 'Intern' },
];

// Officer-facing tool for creating logins. Deliberately separate from
// StaffProfilesTab (which edits contact/coffee/activity-restriction fields
// on staff who already exist) — this tab is about linking a `staff` row to
// an actual auth account, a different concern with its own failure modes
// (invite email delivery, "already has an account", role assignment).
export default function StaffAccountsTab({ departmentId, refreshKey }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [rank, setRank] = useState('consultant');
  const [role, setRole] = useState('staff');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState(null);
  const [inviteSuccess, setInviteSuccess] = useState(null);

  // Inviting an existing, not-yet-linked staff row (as opposed to the form
  // above, which creates a brand new one) — which row's inline email input
  // is open, if any.
  const [linkingStaffId, setLinkingStaffId] = useState(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkRole, setLinkRole] = useState('staff');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState(null);

  // Which row's Role dropdown is currently mid-save, so it can be disabled
  // and show progress without a full-table loading state.
  const [savingRoleId, setSavingRoleId] = useState(null);
  const [roleError, setRoleError] = useState(null);

  // Resending access to an already-linked account — keyed by staff_id so
  // only the row being reinvited shows progress/result.
  const [reinvitingId, setReinvitingId] = useState(null);
  const [reinviteResult, setReinviteResult] = useState(null); // { staffId, message, isError }

  const loadStaff = async () => {
    setLoading(true);
    try {
      const { data, error: loadError } = await getStaffList(departmentId);
      if (loadError) throw loadError;
      setStaff(data);
      setError(null);
    } catch (err) {
      setError(`Failed to load staff: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (departmentId) loadStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, refreshKey]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const { data, error: inviteErr } = await inviteStaff(departmentId, name.trim(), email.trim(), rank, role);
      if (inviteErr) throw inviteErr;

      setInviteSuccess(data?.invited ? `Invite sent to ${email.trim()}.` : `${email.trim()} already has an account — linked to this department.`);
      setName('');
      setEmail('');
      setRank('consultant');
      setRole('staff');
      loadStaff();
    } catch (err) {
      setInviteError(`Failed to invite: ${err.message}`);
    } finally {
      setInviting(false);
    }
  };

  const handleStartLink = (person) => {
    setLinkingStaffId(person.staff_id);
    setLinkEmail(person.email || '');
    setLinkRole(person.role || 'staff');
    setLinkError(null);
  };

  const handleSendLink = async (person) => {
    if (!linkEmail.trim()) return;

    setLinking(true);
    setLinkError(null);
    try {
      const { error: linkErr } = await inviteStaff(departmentId, person.name, linkEmail.trim(), person.rank, linkRole, person.staff_id);
      if (linkErr) throw linkErr;

      setLinkingStaffId(null);
      setLinkEmail('');
      loadStaff();
    } catch (err) {
      setLinkError(`Failed to invite: ${err.message}`);
    } finally {
      setLinking(false);
    }
  };

  // Changing a role is separate from linking an account — works for a
  // linked or not-yet-linked staff member either way, at invite time or
  // any time after.
  const handleRoleChange = async (staffId, newRole) => {
    setSavingRoleId(staffId);
    setRoleError(null);
    try {
      const { error: roleErr } = await updateStaffRole(staffId, newRole);
      if (roleErr) throw roleErr;
      loadStaff();
    } catch (err) {
      setRoleError(`Failed to update role: ${err.message}`);
    } finally {
      setSavingRoleId(null);
    }
  };

  // Resends account access to a staff member who's already linked (e.g.
  // they never got or lost the original invite email). Person only ever
  // has one email on file (`staff.email`, kept current by edits here, in
  // Staff and Availability, or Staff Activity Profiles — whichever was
  // saved most recently), so that's always the address this goes to.
  // Reuses the password-recovery link rather than `inviteUserByEmail`
  // (which errors for an account that already exists) — same flow as the
  // "Forgot password" link in Login.jsx, which App.js also routes to the
  // SetPassword screen.
  const handleReinvite = async (person) => {
    if (!person.email) return;

    setReinvitingId(person.staff_id);
    setReinviteResult(null);
    try {
      const { error: reinviteErr } = await supabase.auth.resetPasswordForEmail(person.email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (reinviteErr) throw reinviteErr;

      setReinviteResult({ staffId: person.staff_id, message: `Sent to ${person.email}.`, isError: false });
    } catch (err) {
      setReinviteResult({ staffId: person.staff_id, message: `Failed: ${err.message}`, isError: true });
    } finally {
      setReinvitingId(null);
    }
  };

  return (
    <>
      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {roleError && (
        <div className="mb-6 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{roleError}</p>
        </div>
      )}

      <form onSubmit={handleInvite} className="mb-6 p-4 bg-blue-50 rounded-lg space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <select
            value={rank}
            onChange={(e) => setRank(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {RANK_OPTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {ROLE_OPTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {inviteError && <p className="text-sm text-red-700">{inviteError}</p>}
        {inviteSuccess && <p className="text-sm text-green-700">{inviteSuccess}</p>}

        <button
          type="submit"
          disabled={inviting}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm flex items-center justify-center gap-2"
        >
          {inviting ? <Loader size={16} className="animate-spin" /> : null}
          {inviting ? 'Inviting...' : 'Invite'}
        </button>
      </form>

      {loading ? (
        <div className="text-center py-8">
          <Loader size={32} className="text-blue-600 animate-spin mx-auto mb-2" />
          <p className="text-gray-600 text-sm">Loading staff...</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-4 py-2 border border-gray-200 font-semibold text-sm text-gray-700">Staff</th>
                <th className="text-left px-3 py-2 border border-gray-200 font-semibold text-sm text-gray-700">Role</th>
                <th className="text-left px-3 py-2 border border-gray-200 font-semibold text-sm text-gray-700">Account</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(person => (
                <tr key={person.staff_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 border border-gray-200">
                    <p className="font-semibold text-sm text-gray-900">{person.name}</p>
                    <p className="text-xs text-gray-600 capitalize">{person.rank}</p>
                  </td>
                  <td className="px-3 py-3 border border-gray-200">
                    <select
                      value={person.role || 'staff'}
                      onChange={(e) => handleRoleChange(person.staff_id, e.target.value)}
                      disabled={savingRoleId === person.staff_id}
                      className="px-2 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
                    >
                      {ROLE_OPTIONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3 border border-gray-200">
                    {person.user_id ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
                          <CheckCircle2 size={14} /> Linked
                        </span>
                        <button
                          onClick={() => handleReinvite(person)}
                          disabled={reinvitingId === person.staff_id || !person.email}
                          title={person.email ? `Resend access link to ${person.email}` : 'No email on file'}
                          className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded text-xs transition disabled:opacity-50"
                        >
                          {reinvitingId === person.staff_id ? 'Sending...' : 'Reinvite'}
                        </button>
                        {reinviteResult?.staffId === person.staff_id && (
                          <p className={`text-xs basis-full ${reinviteResult.isError ? 'text-red-700' : 'text-green-700'}`}>
                            {reinviteResult.message}
                          </p>
                        )}
                      </div>
                    ) : linkingStaffId === person.staff_id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="email"
                          placeholder="Email"
                          value={linkEmail}
                          onChange={(e) => setLinkEmail(e.target.value)}
                          disabled={linking}
                          autoFocus
                          className="px-2 py-1 border border-gray-300 rounded text-sm w-40"
                        />
                        <select
                          value={linkRole}
                          onChange={(e) => setLinkRole(e.target.value)}
                          disabled={linking}
                          className="px-2 py-1 border border-gray-300 rounded text-sm"
                        >
                          {ROLE_OPTIONS.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleSendLink(person)}
                          disabled={linking || !linkEmail.trim()}
                          className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded text-xs transition"
                        >
                          {linking ? 'Sending...' : 'Send'}
                        </button>
                        <button
                          onClick={() => { setLinkingStaffId(null); setLinkError(null); }}
                          disabled={linking}
                          className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded text-xs transition"
                        >
                          Cancel
                        </button>
                        {linkError && <p className="text-xs text-red-700 basis-full">{linkError}</p>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500">
                          <CircleDashed size={14} /> Not linked
                        </span>
                        <button
                          onClick={() => handleStartLink(person)}
                          className="px-2 py-0.5 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition"
                        >
                          Invite
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
