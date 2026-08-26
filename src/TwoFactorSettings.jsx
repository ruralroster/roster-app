import React, { useState, useEffect, useCallback } from 'react';
import { Loader, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { listMfaFactors, enrollMfaFactor, verifyMfaCode, unenrollMfaFactor } from './supabaseClient';

// Settings -> Security, in both the staff app and an officer's own "View:
// Staff" toggle (same screen either way, since it's self-service and has
// nothing to do with rostering). Fully optional per person — enrolling
// stores a TOTP factor against Supabase's own auth.mfa, so there's no
// secret of ours to hold; App.js's MfaChallenge screen is what actually
// asks for the code again at a future sign-in once this is on.
export default function TwoFactorSettings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [verifiedFactor, setVerifiedFactor] = useState(null); // the active totp factor, if any
  const [enrollment, setEnrollment] = useState(null); // { factorId, qrCode, secret } while setting up
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: listError } = await listMfaFactors();
      if (listError) throw listError;

      const totp = (data?.totp || []).find(f => f.status === 'verified');
      setVerifiedFactor(totp || null);
      setError(null);
    } catch (err) {
      setError(`Failed to load 2FA status: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  const handleStartEnroll = async () => {
    setBusy(true);
    setError(null);
    try {
      // Clear out any half-finished enrollment from a previous attempt so
      // they don't pile up against the account.
      const { data: existing } = await listMfaFactors();
      for (const f of existing?.totp || []) {
        if (f.status !== 'verified') await unenrollMfaFactor(f.id);
      }

      const { data, error: enrollError } = await enrollMfaFactor();
      if (enrollError) throw enrollError;

      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setCode('');
    } catch (err) {
      setError(`Failed to start setup: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelEnroll = async () => {
    setBusy(true);
    try {
      await unenrollMfaFactor(enrollment.factorId);
    } catch {
      // Best-effort cleanup — an orphaned unverified factor is harmless and
      // gets swept on the next enroll attempt anyway.
    } finally {
      setEnrollment(null);
      setCode('');
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await verifyMfaCode(enrollment.factorId, code.trim());
      if (verifyError) throw verifyError;

      setEnrollment(null);
      setCode('');
      await loadFactors();
    } catch (err) {
      setError('That code didn\'t work — check the time on your phone and try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleTurnOff = async () => {
    if (!window.confirm('Turn off two-factor authentication? Signing in will only need your password from then on.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: unenrollError } = await unenrollMfaFactor(verifiedFactor.id);
      if (unenrollError) throw unenrollError;

      await loadFactors();
    } catch (err) {
      setError(`Failed to turn off 2FA: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 text-center py-8">
        <Loader size={24} className="text-blue-600 animate-spin mx-auto mb-2" />
        <p className="text-gray-600 text-sm">Loading security settings...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Two-Factor Authentication</h2>
      <p className="text-xs text-gray-500 mb-4">
        Adds a code from an authenticator app (like Google Authenticator or Authy) to signing in, on top of your password. Optional — turn it on or off any time.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {enrollment ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">Scan this with your authenticator app:</p>
          <img src={enrollment.qrCode} alt="2FA QR code" className="w-48 h-48 border border-gray-200 rounded-lg" />
          <div>
            <p className="text-xs text-gray-500 mb-1">Can't scan it? Enter this key manually:</p>
            <code className="block text-xs bg-gray-100 px-3 py-2 rounded-lg break-all">{enrollment.secret}</code>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Enter the 6-digit code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              disabled={busy}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm tracking-widest text-center disabled:opacity-50"
              placeholder="000000"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCancelEnroll}
              disabled={busy}
              className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium rounded-lg transition text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleVerify}
              disabled={busy || code.length !== 6}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm"
            >
              {busy ? 'Verifying...' : 'Verify & enable'}
            </button>
          </div>
        </div>
      ) : verifiedFactor ? (
        <div className="flex items-center justify-between gap-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-green-600 flex-shrink-0" />
            <p className="text-sm font-semibold text-green-800">Two-factor authentication is on</p>
          </div>
          <button
            onClick={handleTurnOff}
            disabled={busy}
            className="px-3 py-1.5 bg-white border border-red-300 hover:bg-red-50 text-red-700 font-medium rounded-lg transition text-xs disabled:opacity-50 flex-shrink-0"
          >
            Turn off
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-gray-400 flex-shrink-0" />
            <p className="text-sm font-semibold text-gray-700">Two-factor authentication is off</p>
          </div>
          <button
            onClick={handleStartEnroll}
            disabled={busy}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-xs flex-shrink-0"
          >
            {busy ? 'Starting...' : 'Turn on'}
          </button>
        </div>
      )}
    </div>
  );
}
