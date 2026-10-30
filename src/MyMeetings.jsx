import React, { useEffect, useState } from 'react';
import { Phone, Video } from 'lucide-react';
import { supabase, getMeetings } from './supabaseClient';
import { meetingRecipients } from './meetingAudience';

// Staff Day view: the meetings on this date that are for this person
// (same audience rules as the reminders), with Join and dial-in buttons.
// Shows nothing when there are none, or before the meetings migration.

const hhmm = (t) => (t || '').slice(0, 5);
const telHref = (dialIn) => `tel:${dialIn.replace(/[^\d+,;#*]/g, '')}`;

export default function MyMeetings({ departmentId, staffMember, staffRanks, dateStr, working }) {
  const [meetings, setMeetings] = useState([]);
  const [away, setAway] = useState(false);

  useEffect(() => {
    if (!departmentId || !staffMember) return;
    let cancelled = false;
    Promise.all([
      getMeetings(departmentId, dateStr, dateStr),
      supabase.from('staff_availability').select('available').eq('staff_id', staffMember.staff_id).eq('date', dateStr).maybeSingle(),
    ]).then(([meetingsRes, availRes]) => {
      if (cancelled) return;
      setMeetings(meetingsRes.data || []);
      setAway(availRes.data?.available === false);
    });
    return () => { cancelled = true; };
  }, [departmentId, staffMember, dateStr]);

  if (!staffMember) return null;
  const me = staffMember.staff_id;
  const context = {
    staff: [staffMember],
    rankRows: staffRanks,
    workingIds: new Set(working ? [me] : []),
    awayIds: new Set(away ? [me] : []),
  };
  const mine = meetings.filter(m => meetingRecipients(m.audience, context).length > 0);
  if (mine.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow-xl p-4 mb-6 border-l-4 border-indigo-500">
      <h2 className="text-sm font-semibold text-indigo-900 mb-2">Meetings for you</h2>
      <div className="space-y-2">
        {mine.map(m => (
          <div key={m.meeting_id} className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-900">
              <span className="font-semibold">{hhmm(m.start_time)}–{hhmm(m.end_time)}</span> {m.name}
              {m.locations?.name && <span className="text-gray-500"> · {m.locations.name}</span>}
            </p>
            <div className="flex gap-2">
              {m.join_url && (
                <a href={m.join_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg">
                  <Video size={14} /> Join
                </a>
              )}
              {m.dial_in && (
                <a href={telHref(m.dial_in)} className="flex items-center gap-1 px-3 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-900 text-xs font-medium rounded-lg">
                  <Phone size={14} /> Dial in
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
