import React from 'react';
import StaffRosterView from './staffRosterView';

function StaffApp({ departmentId, staffId }) {
  return (
    <div>
      <StaffRosterView departmentId={departmentId} staffId={staffId} />
    </div>
  );
}

export default StaffApp;
