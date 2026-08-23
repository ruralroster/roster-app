import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader } from 'lucide-react';
import { getStaffActivityMatrix, updateStaffActivityRestrictions, updateStaffEmail, updateStaffCoffeeOrder, updateStaffName } from './supabaseClient';
import CoffeePicker from './CoffeePicker';
import EditableCell from './EditableCell';

export default function StaffProfilesTab({ departmentId, refreshKey }) {
  const [staff, setStaff] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updating, setUpdating] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { staff: staffData, activities: activitiesData, error: loadError } = 
          await getStaffActivityMatrix(departmentId);
        
        if (loadError) throw loadError;
        setStaff(staffData);
        setActivities(activitiesData);
      } catch (err) {
        setError(`Failed to load staff profiles: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    if (departmentId) {
      load();
    }
  }, [departmentId, refreshKey]);

  const handleActivityToggle = async (staffId, activityId, activityName, isEnabled) => {
    setUpdating(staffId);
    try {
      const staffMember = staff.find(s => s.staff_id === staffId);
      let restrictions = staffMember.activity_restrictions || [];

      if (isEnabled) {
        // Remove from restrictions (means they CAN do it)
        restrictions = restrictions.filter(a => a !== activityName);
      } else {
        // Add to restrictions (means they CANNOT do it)
        restrictions = [...restrictions, activityName];
      }

      const { error: updateError } = await updateStaffActivityRestrictions(staffId, restrictions);
      if (updateError) throw updateError;

      // Update local state
      setStaff(staff.map(s => 
        s.staff_id === staffId 
          ? { ...s, activity_restrictions: restrictions }
          : s
      ));
      setError(null);
    } catch (err) {
      setError(`Failed to update restrictions: ${err.message}`);
    } finally {
      setUpdating(null);
    }
  };

  const handleNameChange = async (staffId, name) => {
    if (!name.trim()) return;
    setUpdating(staffId);
    try {
      const { error: updateError } = await updateStaffName(staffId, name.trim());
      if (updateError) throw updateError;

      setStaff(staff.map(s => s.staff_id === staffId ? { ...s, name: name.trim() } : s));
      setError(null);
    } catch (err) {
      setError(`Failed to update name: ${err.message}`);
    } finally {
      setUpdating(null);
    }
  };

  const handleEmailChange = async (staffId, email) => {
    setUpdating(staffId);
    try {
      const { error: updateError } = await updateStaffEmail(staffId, email);
      if (updateError) throw updateError;

      setStaff(staff.map(s => s.staff_id === staffId ? { ...s, email } : s));
      setError(null);
    } catch (err) {
      setError(`Failed to update email: ${err.message}`);
    } finally {
      setUpdating(null);
    }
  };

  const handleCoffeeOrderChange = async (staffId, coffeeOrder) => {
    setUpdating(staffId);
    try {
      const { error: updateError } = await updateStaffCoffeeOrder(staffId, coffeeOrder);
      if (updateError) throw updateError;

      setStaff(staff.map(s => s.staff_id === staffId ? { ...s, coffee_order: coffeeOrder } : s));
      setError(null);
    } catch (err) {
      setError(`Failed to update coffee order: ${err.message}`);
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader size={32} className="text-blue-600 animate-spin mx-auto mb-2" />
        <p className="text-gray-600 text-sm">Loading staff profiles...</p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <p className="text-xs text-gray-600 mb-4">
        Check = staff can do this activity. Uncheck = staff cannot do this activity.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-4 py-2 border border-gray-200 font-semibold text-sm text-gray-700">Staff</th>
              <th className="text-left px-3 py-2 border border-gray-200 font-semibold text-sm text-gray-700">Email</th>
              <th className="text-left px-3 py-2 border border-gray-200 font-semibold text-sm text-gray-700">Coffee Order</th>
              {activities.map(activity => (
                <th 
                  key={activity.activity_id}
                  className="text-center px-3 py-2 border border-gray-200 font-semibold text-sm text-gray-700"
                >
                  {activity.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map(person => (
              <tr key={person.staff_id} className="hover:bg-gray-50">
                <td className="px-4 py-3 border border-gray-200">
                  <div>
                    <EditableCell
                      value={person.name}
                      placeholder="Name"
                      disabled={updating === person.staff_id}
                      onSave={(value) => handleNameChange(person.staff_id, value)}
                    />
                    <p className="text-xs text-gray-600 capitalize">{person.rank}</p>
                  </div>
                </td>
                <td className="border border-gray-200">
                  <EditableCell
                    value={person.email}
                    placeholder="Add email…"
                    disabled={updating === person.staff_id}
                    onSave={(value) => handleEmailChange(person.staff_id, value)}
                  />
                </td>
                <td className="border border-gray-200 px-2 py-2">
                  <CoffeePicker
                    value={person.coffee_order}
                    disabled={updating === person.staff_id}
                    onSave={(value) => handleCoffeeOrderChange(person.staff_id, value)}
                  />
                </td>
                {activities.map(activity => {
                  const isEnabled = !(person.activity_restrictions || []).includes(activity.name);
                  return (
                    <td 
                      key={`${person.staff_id}-${activity.activity_id}`}
                      className="text-center px-3 py-3 border border-gray-200"
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => handleActivityToggle(person.staff_id, activity.activity_id, activity.name, isEnabled)}
                        disabled={updating === person.staff_id}
                        className="w-5 h-5 cursor-pointer accent-blue-600"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
