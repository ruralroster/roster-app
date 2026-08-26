import React, { useState, useEffect, useCallback } from 'react';
import { Loader, AlertCircle } from 'lucide-react';
import { listMfaFactors, verifyMfaCode, signOut } from './supabaseClient';

// Shown after a successful password sign-in when the account has 2FA
// turned on (see App.js: currentLevel !== nextLevel from
// getMfaAssuranceLevel). Nothing renders behind this until the code
// checks out — a password alone isn't enough to reach the app for someone
// who's enabled this.
export default function MfaChallenge({ onVerified }) {
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);

  const loadFactor = useCallback(async () => {
    setLoading(true);
    const { data, error: listError } = await listMfaFactors();
    setLoading(false);

    if (listError) {
      setError(listError.message);
      return;
    }
    const totp = (data?.totp || []).find(f => f.status === 'verified');
    if (!totp) {
      // No verified factor left (e.g. removed from another session) —
      // nothing to challenge against, so let them straight through rather
      // than get stuck on a screen with no possible next step.
      onVerified();
      return;
    }
    setFactorId(totp.id);
  }, [onVerified]);

  useEffect(() => {
    loadFactor();
  }, [loadFactor]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (code.trim().length !== 6 || !factorId) return;

    setVerifying(true);
    setError(null);
    const { error: verifyError } = await verifyMfaCode(factorId, code.trim());
    setVerifying(false);

    if (verifyError) {
      setError('Incorrect code. Check the time on your phone and try again.');
      return;
    }
    onVerified();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Enter your code</h1>
          <p className="text-gray-600 mb-8">Open your authenticator app and enter the current 6-digit code.</p>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
              <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="text-center py-4">
              <Loader size={24} className="text-blue-600 animate-spin mx-auto" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="w-full p-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none text-center text-lg tracking-widest"
                placeholder="000000"
              />

              <button
                type="submit"
                disabled={verifying || code.length !== 6}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold rounded-lg transition text-lg flex items-center justify-center gap-2"
              >
                {verifying ? <Loader size={20} className="animate-spin" /> : null}
                {verifying ? 'Verifying...' : 'Verify'}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => signOut()}
            className="w-full text-center text-sm text-gray-500 hover:text-gray-700 mt-6"
          >
            Not you? Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
