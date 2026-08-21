import React from 'react';
import { signOut } from './supabaseClient';

// Shown only when the signed-in person has more than one active staff
// membership (App.js skips straight past this for the common single-
// membership case). Built entirely from the user's own memberships — never
// a hardcoded department list.
export default function DepartmentSwitcher({ memberships, onSelect }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Choose a department</h1>
          <p className="text-gray-600 mb-6">You have access to more than one</p>

          <div className="space-y-2">
            {memberships.map((m) => (
              <button
                key={m.department_id}
                onClick={() => onSelect(m)}
                className="w-full text-left p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition"
              >
                <div className="font-medium text-gray-900">{m.department_name || 'Department'}</div>
                <div className="text-xs text-gray-600 capitalize">{m.role}</div>
              </button>
            ))}
          </div>

          <button
            onClick={() => signOut()}
            className="w-full mt-6 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
