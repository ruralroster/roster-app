import React from 'react';

export const DEPARTMENTS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Emergency Department',
    description: '12-hour shifts, Resus bays, fast-paced assessment',
    color: 'border-red-500',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Theatre Setup',
    description: 'Multi-theatre setup, General/STOP/EMERG activities, full day shifts',
    color: 'border-blue-500',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Small Rural Hospital',
    description: 'Clinics, Wards, Small ED',
    color: 'border-green-500',
  },
  {
    id: '835c81c1-09cf-409f-96c9-12c5c2e103ef',
    name: 'Large Rural Hospital',
    description: 'Small team, limited theatres, day/night shifts only',
    color: 'border-purple-500',
  },
];

export default function DemoSelector({ onSelect }) {
  const handleSelect = (departmentId) => {
    localStorage.setItem('selectedDepartmentId', departmentId);
    onSelect(departmentId);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Small Rural Hospital Setup</h1>
          <p className="text-gray-600">Choose a department to continue</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {DEPARTMENTS.map(dept => (
            <button
              key={dept.id}
              onClick={() => handleSelect(dept.id)}
              className={`text-left bg-white rounded-lg shadow-sm hover:shadow-md p-6 border-l-4 ${dept.color} transition`}
            >
              <h2 className="text-lg font-bold text-gray-900 mb-2">{dept.name}</h2>
              <p className="text-sm text-gray-600">{dept.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
