import React, { useState, useEffect, useCallback } from 'react';
import { Loader } from 'lucide-react';
import OfficerRosterView from './officer-roster-view-supabase';
import StaffApp from './StaffApp';
import Login from './Login';
import SetPassword from './SetPassword';
import DepartmentSwitcher from './DepartmentSwitcher';
import { supabase, getMyMemberships, signOut, updateMyPreferredView } from './supabaseClient';

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        setMemberships(null);
        setActiveMembership(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadMemberships = useCallback(async () => {
    setMembershipsLoading(true);
    const { data } = await getMyMemberships();
    setMembershipsLoading(false);
    setMemberships(data);
    if (data.length === 1) setActiveMembership(data[0]);
  }, []);

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

  if (session === undefined) {
    return <FullScreenLoader />;
  }

  if (!session) {
    return <Login />;
  }

  if (needsPasswordSetup) {
    return <SetPassword onDone={handlePasswordSet} />;
  }

  if (memberships === null || membershipsLoading) {
    return <FullScreenLoader />;
  }

  if (memberships.length === 0) {
    return <NoAccountLinked />;
  }

  if (!activeMembership) {
    return <DepartmentSwitcher memberships={memberships} onSelect={setActiveMembership} />;
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
      <div className="fixed top-4 left-4 z-40 flex gap-2">
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
        <button
          onClick={() => signOut()}
          className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded text-sm transition"
        >
          Sign Out
        </button>
      </div>

      {effectiveView === 'officer' ? (
        <OfficerRosterView departmentId={departmentId} staffId={staffId} />
      ) : (
        <StaffApp departmentId={departmentId} staffId={staffId} />
      )}
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
