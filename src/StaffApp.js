import React, { useState, useEffect } from 'react';
import StaffLogin from './StaffLogin';
import StaffRosterView from './staffRosterView';

function StaffApp({ departmentId: departmentIdProp } = {}) {
  const departmentId = departmentIdProp || process.env.REACT_APP_DEPARTMENT_ID;
  const [loggedInStaffId, setLoggedInStaffId] = useState(null);

  // Load saved staff ID from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('selectedStaffId');
    if (saved) {
      setLoggedInStaffId(saved);
    }
  }, []);

  const handleLogout = () => {
    setLoggedInStaffId(null);
    localStorage.removeItem('selectedStaffId');
  };

  if (!loggedInStaffId) {
    return <StaffLogin departmentId={departmentId} onLogin={setLoggedInStaffId} />;
  }

  return (
    <div>
      <StaffRosterView 
        departmentId={departmentId} 
        staffId={loggedInStaffId}
        onLogout={handleLogout}
      />
    </div>
  );
}

export default StaffApp;
