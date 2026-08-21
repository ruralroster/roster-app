import React, { useState } from 'react';
import OfficerRosterView from './officer-roster-view-supabase';
import StaffApp from './StaffApp';
import DemoSelector, { DEPARTMENTS } from './DemoSelector';
import { populateNextWeekRandom } from './supabaseClient';

console.log('SUPABASE_URL:', process.env.REACT_APP_SUPABASE_URL);
console.log('DEPARTMENT_ID:', process.env.REACT_APP_DEPARTMENT_ID);

function App() {
  const [view, setView] = useState(null);
  const [populating, setPopulating] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(
    () => localStorage.getItem('selectedDepartmentId')
  );
  const departmentId = selectedDepartmentId || process.env.REACT_APP_DEPARTMENT_ID;

  const handleChangeDepartment = () => {
    localStorage.removeItem('selectedDepartmentId');
    setSelectedDepartmentId(null);
    setView(null);
  };

  const handlePopulateWeek = async () => {
    setPopulating(true);
    const result = await populateNextWeekRandom(departmentId);
    setPopulating(false);

    if (result.success) {
      alert(`✅ Populated ${result.count} assignments for next week!`);
    } else {
      alert(`❌ Failed: ${result.error}`);
    }
  };

  if (!selectedDepartmentId) {
    return <DemoSelector onSelect={setSelectedDepartmentId} />;
  }

  if (view === null) {
    const currentDepartment = DEPARTMENTS.find(d => d.id === departmentId);

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">{currentDepartment?.name || 'Anaesthetics Roster'}</h1>
            <p className="text-gray-600 mb-8">Roster</p>

            <div className="space-y-3">
              <button
                onClick={() => setView('officer')}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition text-lg"
              >
                Officer View
              </button>
              <button
                onClick={() => setView('staff')}
                className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition text-lg"
              >
                Staff View
              </button>
              <button
                onClick={handlePopulateWeek}
                disabled={populating}
                className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-bold rounded-lg transition text-lg"
              >
                {populating ? 'Populating...' : 'Populate Next Week (Test)'}
              </button>
              <button
                onClick={handleChangeDepartment}
                className="w-full px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition text-lg"
              >
                Change Department
              </button>
            </div>

            <p className="text-xs text-gray-500 text-center mt-6">
              Testing interface — choose a view to continue
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'officer') {
    return (
      <div>
        <button
          onClick={() => setView(null)}
          className="fixed top-4 left-4 z-40 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded text-sm transition"
        >
          ← Back to Menu
        </button>
        <OfficerRosterView departmentId={departmentId} />
      </div>
    );
  }

  if (view === 'staff') {
    return (
      <div>
        <button
          onClick={() => setView(null)}
          className="fixed top-4 left-4 z-40 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded text-sm transition"
        >
          ← Back to Menu
        </button>
        <StaffApp departmentId={departmentId} />
      </div>
    );
  }
}

export default App;
