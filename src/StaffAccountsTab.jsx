import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader, CheckCircle2, CircleDashed } from 'lucide-react';
import { getStaffList, inviteStaff } from './supabaseClient';
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

  return (
    <>
      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
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
                  <td className="px-3 py-3 border border-gray-200 text-sm text-gray-700 capitalize">
                    {person.role || 'staff'}
                  </td>
                  <td className="px-3 py-3 border border-gray-200">
                    {person.user_id ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
                        <CheckCircle2 size={14} /> Linked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500">
                        <CircleDashed size={14} /> Not linked
                      </span>
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
