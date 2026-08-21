import React, { useState } from 'react';
import { Loader, AlertCircle, CheckCircle2 } from 'lucide-react';
import { signIn, supabase } from './supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resetSent, setResetSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResetSent(false);

    const { error: signInError } = await signIn(email.trim(), password);

    setLoading(false);
    if (signInError) {
      setError('Incorrect email or password.');
    }
    // On success, the onAuthStateChange listener in App.js picks up the new
    // session and moves on — nothing else to do here.
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Enter your email above first, then click "Forgot password".');
      return;
    }
    setLoading(true);
    setError(null);
    setResetSent(false);

    // Sends a link back to this same app with ?type=recovery — App.js
    // recognizes that and shows the same SetPassword screen an invite uses.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + window.location.pathname,
    });

    setLoading(false);
    if (resetError) {
      setError(resetError.message);
    } else {
      setResetSent(true);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Roster</h1>
          <p className="text-gray-600 mb-8">Sign in to continue</p>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
              <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {resetSent && (
            <div className="mb-6 p-4 bg-green-50 border border-green-300 rounded-lg flex gap-2 items-start">
              <CheckCircle2 size={18} className="text-green-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-green-700">Check your email for a password reset link.</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold rounded-lg transition text-lg flex items-center justify-center gap-2"
            >
              {loading ? <Loader size={20} className="animate-spin" /> : null}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <button
            type="button"
            onClick={handleForgotPassword}
            disabled={loading}
            className="w-full text-center text-sm text-blue-600 hover:text-blue-700 mt-4"
          >
            Forgot password?
          </button>

          <p className="text-xs text-gray-500 text-center mt-6">
            Don't have an account? Ask your department officer to invite you.
          </p>
        </div>
      </div>
    </div>
  );
}
