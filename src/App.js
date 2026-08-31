import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader, Plus, X, AlertCircle, HelpCircle, ExternalLink } from 'lucide-react';
import OfficerRosterView from './officer-roster-view-supabase';
import StaffApp from './StaffApp';
import Login from './Login';
import SetPassword from './SetPassword';
import MfaChallenge from './MfaChallenge';
import DepartmentSwitcher from './DepartmentSwitcher';
import { supabase, getMyMemberships, getMfaAssuranceLevel, getMustResetPassword, clearMustResetPassword, signOut, updateMyPreferredView, createDepartment } from './supabaseClient';

// Supabase redirects invite/password-recovery links back here with
// ?type=invite / ?type=recovery (or, on older/implicit-flow projects,
// #access_token=...&type=invite in the hash) — either way it establishes a
// session automatically from the link's one-time token, with no password
// involved. This is the only signal that "you're logged in, but via a
// link, not a password you can reuse" — captured in a useState initializer
// so it's read during React's first synchronous render, before
// supabase-js's own async URL processing has a chance to strip it.
function needsPasswordSetupFromUrl() {
  return /[?&#]type=(invite|recovery)\b/.test(window.location.href);
}

function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking, null = signed out
  const [memberships, setMemberships] = useState(null);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [activeMembership, setActiveMembership] = useState(null);
  // Session-only override of activeMembership.preferredView — lets an
  // officer flip to the staff view (or back) without changing their saved
  // default. null = "use the saved preference". Reset whenever they pick a
  // department, so switching departments always starts from that
  // department's own saved preference.
  const [viewOverride, setViewOverride] = useState(null);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(needsPasswordSetupFromUrl);
  // Whether this account was given a one-time temporary password by an
  // officer (StaffAccountsTab's "One-Time Password" button, for when the
  // real invite email gets spam-filtered) and hasn't set its own password
  // yet. Unlike needsPasswordSetup above, this isn't detectable from the
  // URL — a temp password is a normal password-sign-in, not a one-time
  // link — so it's read from the database instead. null = not checked yet
  // for the current session, true/false once getMustResetPassword has
  // answered. Re-checked from scratch whenever `session` changes, same as
  // needsMfaChallenge below.
  const [needsForcedReset, setNeedsForcedReset] = useState(null);
  // Whether this session still needs to answer a 2FA challenge before
  // seeing anything else. null = not checked yet for the current session
  // (renders the loader, same as `session === undefined`); true/false once
  // getMfaAssuranceLevel has answered. Re-checked from scratch whenever
  // `session` changes, since signing out and back in as someone else must
  // not reuse the previous person's answer.
  const [needsMfaChallenge, setNeedsMfaChallenge] = useState(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [showAddDepartment, setShowAddDepartment] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // Lets OfficerRosterView portal its Day-tab action buttons (Copy Last
  // Week / Add Activity) into this top bar, so they stay visible while
  // scrolled down the page instead of only living next to the date header.
  const topBarActionsRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        setMemberships(null);
        setActiveMembership(null);
        setNeedsMfaChallenge(null);
        setNeedsForcedReset(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Guarded on needsForcedReset still being null so this resolves once per
  // sign-in, not on every `session` change (routine token refreshes fire a
  // new session object too — see the identical comment on the MFA effect
  // below). Skipped entirely while needsPasswordSetup is true: that flow
  // already ends at SetPassword, which would just be reached a second way.
  useEffect(() => {
    if (!session || needsPasswordSetup || needsForcedReset !== null) return;
    let cancelled = false;
    getMustResetPassword().then(({ data, error }) => {
      if (cancelled) return;
      setNeedsForcedReset(!error && !!data);
    });
    return () => { cancelled = true; };
  }, [session, needsPasswordSetup, needsForcedReset]);

  // A plain password sign-in only ever reaches 'aal1'. Someone with 2FA
  // turned on (see TwoFactorSettings) needs a step up to 'aal2' before
  // going any further — skipped entirely for someone who's never enabled
  // it, since then currentLevel and nextLevel are already equal.
  //
  // Guarded on needsMfaChallenge still being null so this resolves once per
  // sign-in, not on every `session` change — onAuthStateChange fires a new
  // session object on routine token refreshes too (roughly hourly), and
  // re-running the check then would flash the app back to a loading screen
  // for no reason. Signing out resets it to null again, above.
  useEffect(() => {
    if (!session || needsPasswordSetup || needsForcedReset !== false || needsMfaChallenge !== null) return;
    let cancelled = false;
    getMfaAssuranceLevel().then(({ data, error }) => {
      if (cancelled) return;
      setNeedsMfaChallenge(!error && data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2');
    });
    return () => { cancelled = true; };
  }, [session, needsPasswordSetup, needsForcedReset, needsMfaChallenge]);

  const loadMemberships = useCallback(async () => {
    setMembershipsLoading(true);
    const { data, isSuperAdmin: superAdmin } = await getMyMemberships();
    setMembershipsLoading(false);
    setMemberships(data);
    setIsSuperAdmin(!!superAdmin);
    if (data.length === 1) setActiveMembership(data[0]);
  }, []);

  // Drops back to the loading state, which the effect above turns straight
  // back into a fresh loadMemberships() call — same mechanism session
  // changes already use, just triggered manually so a newly created
  // department shows up immediately.
  const handleDepartmentAdded = () => {
    setShowAddDepartment(false);
    setMemberships(null);
  };

  useEffect(() => {
    if (session && memberships === null) loadMemberships();
  }, [session, memberships, loadMemberships]);

  const handleSwitchDepartment = () => {
    setActiveMembership(null);
    setViewOverride(null);
  };

  const handlePasswordSet = () => {
    setNeedsPasswordSetup(false);
    window.history.replaceState(null, '', window.location.pathname);
  };

  const handleForcedResetDone = async () => {
    await clearMustResetPassword();
    setNeedsForcedReset(false);
  };

  if (session === undefined) {
    return <FullScreenLoader />;
  }

  if (!session) {
    return <Login />;
  }

  if (needsPasswordSetup) {
    return <SetPassword onDone={handlePasswordSet} />;
  }

  if (needsForcedReset === null) {
    return <FullScreenLoader />;
  }

  if (needsForcedReset) {
    return (
      <SetPassword
        onDone={handleForcedResetDone}
        title="Choose a new password"
        subtitle="You signed in with a temporary password — set your own before continuing."
      />
    );
  }

  if (needsMfaChallenge === null) {
    return <FullScreenLoader />;
  }

  if (needsMfaChallenge) {
    return <MfaChallenge onVerified={() => setNeedsMfaChallenge(false)} />;
  }

  if (memberships === null || membershipsLoading) {
    return <FullScreenLoader />;
  }

  if (memberships.length === 0) {
    return <NoAccountLinked />;
  }

  if (!activeMembership) {
    return (
      <>
        <DepartmentSwitcher
          memberships={memberships}
          onSelect={setActiveMembership}
          isSuperAdmin={isSuperAdmin}
          onAddDepartment={() => setShowAddDepartment(true)}
        />
        {showAddDepartment && (
          <AddDepartmentModal onClose={() => setShowAddDepartment(false)} onCreated={handleDepartmentAdded} />
        )}
      </>
    );
  }

  const { department_id: departmentId, staff_id: staffId, role, preferredView } = activeMembership;
  const showSwitcher = memberships.length > 1;
  // Only officers get a choice — a plain staff row never has an officer
  // view to switch to, so App.js always shows them StaffApp regardless.
  const effectiveView = role === 'officer' ? (viewOverride || preferredView || 'officer') : 'staff';

  const handleToggleView = () => {
    const next = effectiveView === 'officer' ? 'staff' : 'officer';
    setViewOverride(next);
    updateMyPreferredView(staffId, next);
  };

  return (
    <div>
      <div className="fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 shadow-sm px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
        <div ref={topBarActionsRef} className="flex gap-2 flex-wrap" />
        <div className="flex gap-2 flex-wrap">
          {showSwitcher && (
            <button
              onClick={handleSwitchDepartment}
              className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded text-sm transition"
            >
              Switch Department
            </button>
          )}
          {role === 'officer' && (
            <button
              onClick={handleToggleView}
              className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded text-sm transition"
            >
              View: {effectiveView === 'officer' ? 'Officer' : 'Staff'}
            </button>
          )}
          {role === 'officer' && (
            <button
              onClick={() => setShowHelp(true)}
              className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded text-sm transition flex items-center gap-1.5"
            >
              <HelpCircle size={16} />
              Help
            </button>
          )}
          {isSuperAdmin && (
            <button
              onClick={() => setShowAddDepartment(true)}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded text-sm transition flex items-center gap-1"
            >
              <Plus size={16} />
              Add Department
            </button>
          )}
          <button
            onClick={() => signOut()}
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded text-sm transition"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="pt-16">
        {effectiveView === 'officer' ? (
          <OfficerRosterView departmentId={departmentId} staffId={staffId} topBarActionsRef={topBarActionsRef} isSuperAdmin={isSuperAdmin} />
        ) : (
          <StaffApp departmentId={departmentId} staffId={staffId} />
        )}
      </div>

      {showAddDepartment && (
        <AddDepartmentModal onClose={() => setShowAddDepartment(false)} onCreated={handleDepartmentAdded} />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
      <Loader size={32} className="text-blue-600 animate-spin" />
    </div>
  );
}

// Super-admin only — enforced server-side by departments_insert_super_admin
// (migrations/2026-08-22_departments_insert_policy.sql), not just by this
// button being hidden from everyone else. A created department starts
// completely empty: nothing else references its department_id yet.
function AddDepartmentModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError(null);
    const { error: createError } = await createDepartment(name.trim());
    setSaving(false);

    if (createError) {
      setError(createError.message);
      return;
    }
    onCreated();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold text-gray-900">New Department</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
            <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase">
              Department name
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold rounded-lg transition flex items-center justify-center gap-2"
          >
            {saving ? <Loader size={18} className="animate-spin" /> : null}
            {saving ? 'Creating...' : 'Create department'}
          </button>
        </form>

        <p className="text-xs text-gray-500 mt-4">
          Starts empty — no staff, activities, or shift patterns until you add them.
        </p>
      </div>
    </div>
  );
}

// The three guides live as static pages under public/docs (see
// public/docs/*.html) — plain, self-contained HTML rather than a PDF or a
// claude.ai artifact link, so they open instantly in a new tab with no
// external account or viewer needed, and are versioned in this repo right
// alongside the app they document.
const HELP_GUIDES = [
  { href: 'docs/walkthrough.html', label: 'Walkthrough', description: 'A guided, start-to-finish tour of a week on the roster.' },
  { href: 'docs/how-to-guide.html', label: 'How-To Guide', description: 'Full reference for every screen, organised by role.' },
  { href: 'docs/features.html', label: 'Features', description: 'A one-page summary of everything the app does.' },
];

function HelpModal({ onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold text-gray-900">Help</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-2">
          {HELP_GUIDES.map(guide => (
            <a
              key={guide.href}
              href={`${process.env.PUBLIC_URL}/${guide.href}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start justify-between gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-blue-300 transition"
            >
              <div>
                <p className="text-sm font-semibold text-gray-900">{guide.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{guide.description}</p>
              </div>
              <ExternalLink size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function NoAccountLinked() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">No account linked</h1>
        <p className="text-gray-600 mb-6">
          Your login isn't linked to a staff record yet. Ask your department officer to invite you.
        </p>
        <button
          onClick={() => signOut()}
          className="px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

export default App;
