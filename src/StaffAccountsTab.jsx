import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader, CheckCircle2, CircleDashed } from 'lucide-react';
import { getStaffList, inviteStaff, updateStaffRole, generateTempPassword, supabase } from './supabaseClient';

const ROLE_OPTIONS = [
  { value: 'staff', label: 'Staff' },
  { value: 'officer', label: 'Officer' },
  { value: 'intern', label: 'Intern' },
];

const ROSTER_APP_URL = 'https://ruralroster.github.io/roster-app/';

// "Dr Sarah Jones" -> "Sarah", for the temp-password email's greeting.
function firstNameOf(name) {
  if (!name) return 'there';
  const words = name.split(' ').filter(Boolean).filter(w => !/^(Dr|Mr|Mrs|Ms|Prof)\.?$/i.test(w));
  return words[0] || 'there';
}

// A mailto: link pre-filling subject/body so the officer reviews and sends
// from their own mail client — deliberately not server-sent email, so this
// needs no new infrastructure (no transactional email provider/secret) on
// top of the temp password the Edge Function already generates.
function tempPasswordMailto({ name, email, password }) {
  const subject = 'Rostering app Password reset';
  const body = [
    `Dear ${firstNameOf(name)},`,
    '',
    'please find below your one-time password for the rostering app:',
    '',
    password,
    '',
    `You'll have to reset that as soon as you log in. Use this email address as your username and put it into the website ${ROSTER_APP_URL}`,
  ].join('\n');
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Officer-facing tool for creating logins. Deliberately separate from
// StaffProfilesTab (which edits contact/coffee/activity-restriction fields
// on staff who already exist) — this tab is about linking a `staff` row to
// an actual auth account, a different concern with its own failure modes
// (invite email delivery, "already has an account", role assignment).
export default function StaffAccountsTab({ departmentId, refreshKey, staffRanks = [] }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [rank, setRank] = useState('');
  const [role, setRole] = useState('staff');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState(null);
  const [inviteSuccess, setInviteSuccess] = useState(null);

  // Inviting an existing, not-yet-linked staff row (as opposed to the form
  // above, which creates a brand new one) — which row's inline email input
  // is open, if any. linkMode distinguishes the two actions that share this
  // same inline form: 'invite' (send a Supabase invite email) vs 'otp'
  // (create/link the account directly and hand back a temp password,
  // without depending on an invite email arriving).
  const [linkingStaffId, setLinkingStaffId] = useState(null);
  const [linkMode, setLinkMode] = useState('invite');
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

  // One-time temporary password — the WhatsApp/SMS fallback for when the
  // invite/reinvite email itself gets spam-filtered. Keyed by staff_id, same
  // shape as reinviteResult above.
  const [generatingPwId, setGeneratingPwId] = useState(null);
  const [tempPasswordResult, setTempPasswordResult] = useState(null); // { staffId, password, error }

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
    if (!name.trim() || !email.trim() || !rank) return;

    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const { data, error: inviteErr } = await inviteStaff(departmentId, name.trim(), email.trim(), rank, role);
      if (inviteErr) throw inviteErr;

      setInviteSuccess(data?.invited ? `Invite sent to ${email.trim()}.` : `${email.trim()} already has an account — linked to this department.`);
      setName('');
      setEmail('');
      setRank('');
      setRole('staff');
      loadStaff();
    } catch (err) {
      setInviteError(`Failed to invite: ${err.message}`);
    } finally {
      setInviting(false);
    }
  };

  const handleStartLink = (person, mode = 'invite') => {
    setLinkingStaffId(person.staff_id);
    setLinkMode(mode);
    setLinkEmail(person.email || '');
    setLinkRole(person.role || 'staff');
    setLinkError(null);
  };

  const handleSendLink = async (person) => {
    if (!linkEmail.trim()) return;

    setLinking(true);
    setLinkError(null);
    try {
      if (linkMode === 'otp') {
        const { data, error: genErr } = await generateTempPassword(departmentId, person.staff_id, linkEmail.trim());
        if (genErr) throw genErr;

        setLinkingStaffId(null);
        setLinkEmail('');
        setTempPasswordResult({ staffId: person.staff_id, name: person.name, email: linkEmail.trim(), password: data.tempPassword });
        loadStaff();
      } else {
        const { error: linkErr } = await inviteStaff(departmentId, person.name, linkEmail.trim(), person.rank, linkRole, person.staff_id);
        if (linkErr) throw linkErr;

        setLinkingStaffId(null);
        setLinkEmail('');
        loadStaff();
      }
    } catch (err) {
      setLinkError(`Failed: ${err.message}`);
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

  // Sets a random temporary password on the account server-side (see
  // supabase/functions/generate-temp-password/index.ts) and returns it once
  // for the officer to relay to a person whose invite/reinvite email keeps
  // landing in spam — shown in a modal (below) with a mailto: link
  // pre-filled to send it on. Also flags the account so App.js forces them
  // through SetPassword on next login, same screen an invite link would
  // have shown.
  const handleGenerateTempPassword = async (person) => {
    if (!window.confirm(
      `Generate a one-time password for ${person.name}? Their current password (if any) stops working immediately — only share the new one with them directly.`
    )) return;

    setGeneratingPwId(person.staff_id);
    setTempPasswordResult(null);
    try {
      const { data, error: genErr } = await generateTempPassword(departmentId, person.staff_id);
      if (genErr) throw genErr;

      setTempPasswordResult({ staffId: person.staff_id, name: person.name, email: person.email, password: data.tempPassword });
    } catch (err) {
      setTempPasswordResult({ staffId: person.staff_id, name: person.name, error: err.message });
    } finally {
      setGeneratingPwId(null);
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
            required
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">— Select a rank —</option>
            {staffRanks.map(r => (
              <option key={r.rule_id} value={r.rank}>{r.rank}</option>
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

        {staffRanks.length === 0 && (
          <p className="text-xs text-amber-700">Add a rank in Settings → Ranks before inviting new staff.</p>
        )}

        <button
          type="submit"
          disabled={inviting || !rank}
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
                        <button
                          onClick={() => handleGenerateTempPassword(person)}
                          disabled={generatingPwId === person.staff_id}
                          title="Generate a one-time password to share manually (WhatsApp, SMS, etc.) if the invite email is being spam-filtered"
                          className="px-2 py-0.5 bg-purple-100 hover:bg-purple-200 text-purple-900 font-medium rounded text-xs transition disabled:opacity-50"
                        >
                          {generatingPwId === person.staff_id ? 'Generating...' : 'One-Time Password'}
                        </button>
                        {reinviteResult?.staffId === person.staff_id && (
                          <p className={`text-xs basis-full ${reinviteResult.isError ? 'text-red-700' : 'text-green-700'}`}>
                            {reinviteResult.message}
                          </p>
                        )}
                      </div>
                    ) : linkingStaffId === person.staff_id ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <input
                          type="email"
                          placeholder="Email"
                          value={linkEmail}
                          onChange={(e) => setLinkEmail(e.target.value)}
                          disabled={linking}
                          autoFocus
                          className="px-2 py-1 border border-gray-300 rounded text-sm w-40"
                        />
                        {linkMode === 'invite' && (
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
                        )}
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500">
                          <CircleDashed size={14} /> Not linked
                        </span>
                        <button
                          onClick={() => handleStartLink(person, 'invite')}
                          className="px-2 py-0.5 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition"
                        >
                          Invite
                        </button>
                        <button
                          onClick={() => handleStartLink(person, 'otp')}
                          title="Create their account and generate a one-time password to share manually (WhatsApp, SMS, etc.)"
                          className="px-2 py-0.5 bg-purple-100 hover:bg-purple-200 text-purple-900 font-medium rounded text-xs transition"
                        >
                          One-Time Password
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

      {tempPasswordResult && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-gray-900">One-Time Password</h2>
            <p className="text-sm text-gray-600 mb-4">{tempPasswordResult.name}</p>

            {tempPasswordResult.error ? (
              <p className="text-sm text-red-700 mb-4">Failed: {tempPasswordResult.error}</p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <code className="text-lg font-mono font-semibold text-purple-900 flex-1">{tempPasswordResult.password}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(tempPasswordResult.password)}
                    className="text-xs text-purple-700 underline flex-shrink-0"
                  >
                    Copy
                  </button>
                </div>

                <p className="text-xs text-gray-500 mb-4">
                  Shown once — they'll be asked to set their own password after signing in.
                </p>

                {tempPasswordResult.email ? (
                  <>
                    <p className="text-sm text-gray-800 mb-3">
                      Would you like to email this one-time password to: {tempPasswordResult.name}?
                    </p>
                    <div className="flex gap-2">
                      <a
                        href={tempPasswordMailto(tempPasswordResult)}
                        onClick={() => setTempPasswordResult(null)}
                        className="flex-1 text-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition text-sm"
                      >
                        Yes
                      </a>
                      <button
                        onClick={() => setTempPasswordResult(null)}
                        className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition text-sm"
                      >
                        No
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-amber-700 mb-2">No email on file — share this password with them directly instead.</p>
                    <button
                      onClick={() => setTempPasswordResult(null)}
                      className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition text-sm"
                    >
                      Close
                    </button>
                  </>
                )}
              </>
            )}

            {tempPasswordResult.error && (
              <button
                onClick={() => setTempPasswordResult(null)}
                className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition text-sm"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
