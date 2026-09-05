import React, { useState } from 'react';
import { Loader, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { supabase } from './supabaseClient';

// Settings -> Security, alongside TwoFactorSettings. Unlike SetPassword.jsx
// (shown full-screen after an invite/recovery link or a forced reset), this
// is the self-service version for someone already signed in who just wants
// to pick a new password. Same supabase.auth.updateUser call either way —
// it operates on the caller's own session, so there's no separate table to
// keep in sync the way staff.email needs update-staff-email.
export default function ChangePassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSuccess(false);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPassword('');
    setConfirm('');
    setSuccess(true);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Password</h2>
      <p className="text-xs text-gray-500 mb-4">Change the password you use to sign in.</p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex gap-2 items-center">
          <CheckCircle2 size={18} className="text-green-600 flex-shrink-0" />
          <p className="text-sm font-semibold text-green-800">Password updated.</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">New password</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Confirm new password</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm flex items-center gap-2"
        >
          {busy ? <Loader size={16} className="animate-spin" /> : <KeyRound size={16} />}
          {busy ? 'Saving...' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
