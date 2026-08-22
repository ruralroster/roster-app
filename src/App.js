import React, { useState, useEffect, useCallback } from 'react';
import { Loader, Plus, X, AlertCircle } from 'lucide-react';
import OfficerRosterView from './officer-roster-view-supabase';
import StaffApp from './StaffApp';
import Login from './Login';
import SetPassword from './SetPassword';
import DepartmentSwitcher from './DepartmentSwitcher';
import { supabase, getMyMemberships, signOut, updateMyPreferredView, createDepartment } from './supabaseClient';

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
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [showAddDepartment, setShowAddDepartment] = useState(false);

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
      <div className="fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 shadow-sm px-4 py-3 flex gap-2 flex-wrap">
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

      <div className="pt-16">
        {effectiveView === 'officer' ? (
          <OfficerRosterView departmentId={departmentId} staffId={staffId} />
        ) : (
          <StaffApp departmentId={departmentId} staffId={staffId} />
        )}
      </div>

      {showAddDepartment && (
        <AddDepartmentModal onClose={() => setShowAddDepartment(false)} onCreated={handleDepartmentAdded} />
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
