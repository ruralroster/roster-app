import React, { useState, useEffect } from 'react';
import { getMyBirthday } from './supabaseClient';
import { isBirthdayOn } from './birthdays';
import { toLocalDateStr } from './dateUtils';

// "Happy birthday from Rstar" for someone who's opted in (BirthdaySetting),
// the first time they open the app on the day. Once per device per day.
export default function BirthdayGreeting({ staffId }) {
  const [show, setShow] = useState(false);
  const seenKey = `rstar-birthday-greeted-${staffId}-${toLocalDateStr(new Date())}`;

  useEffect(() => {
    if (!staffId) return;
    try {
      if (localStorage.getItem(seenKey)) return;
    } catch { /* private window: just show it */ }
    getMyBirthday(staffId).then(({ data }) => {
      if (isBirthdayOn(data)) setShow(true);
    });
  }, [staffId, seenKey]);

  const close = () => {
    setShow(false);
    try { localStorage.setItem(seenKey, '1'); } catch { /* ignore */ }
  };

  if (!show) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={close}>
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm text-center" onClick={e => e.stopPropagation()}>
        <p className="text-5xl mb-3">🎉🎂🎉</p>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Happy birthday!</h2>
        <p className="text-sm text-gray-600 mb-5">From all of us at Rstar. Have a great day.</p>
        <button onClick={close} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg">
          Thanks!
        </button>
      </div>
    </div>
  );
}
