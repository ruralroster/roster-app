import React, { useState, useEffect } from 'react';
import { Loader, AlertCircle } from 'lucide-react';
import { supabase } from './supabaseClient';

export default function StaffLogin({ departmentId, onLogin }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadStaff = async () => {
      try {
        const { data, error: staffError } = await supabase
          .from('staff')
          .select('*')
          .eq('department_id', departmentId)
          .order('name');

        if (staffError) throw staffError;
        setStaff(data || []);
      } catch (err) {
        setError(`Failed to load staff: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    if (departmentId) {
      loadStaff();
    }
  }, [departmentId]);

  const handleLogin = (staffId) => {
    localStorage.setItem('selectedStaffId', staffId);
    onLogin(staffId);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader size={32} className="text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading staff list...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Large Rural Hospital</h1>
          <p className="text-gray-600 mb-8">Roster</p>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
              <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-4 uppercase">
              Select your name
            </label>
            <div className="space-y-2">
              {staff.map((person) => (
                <button
                  key={person.staff_id}
                  onClick={() => handleLogin(person.staff_id)}
                  className="w-full text-left p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition font-medium text-gray-900"
                >
                  <div>{person.name}</div>
                  <div className="text-xs text-gray-600 capitalize">{person.rank}</div>
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-gray-500 text-center">
            This is a test login. Production will use real authentication.
          </p>
        </div>
      </div>
    </div>
  );
}
