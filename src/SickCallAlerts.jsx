import React, { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { getMyUndismissedSickCallAlerts, dismissSickCallAlert } from './supabaseClient';

// The recipient side of Notify Sick — see getSickCallRecipients in
// supabaseClient.js for who gets these. Checked once when the app opens
// (mounted from App.js above both the officer and staff views), and stays
// up until every alert in it is dismissed. Not a device push — see
// push-notifications-deferred in project memory.
export default function SickCallAlerts({ staffId }) {
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!staffId) return;
    const load = async () => {
      const { data, error: loadError } = await getMyUndismissedSickCallAlerts(staffId);
      if (loadError) {
        console.error('Failed to load sick-call alerts:', loadError);
        return;
      }
      setAlerts(data);
    };
    load();
  }, [staffId]);

  const handleDismiss = async (ids) => {
    try {
      for (const id of ids) {
        const { error: dismissError } = await dismissSickCallAlert(id);
        if (dismissError) throw dismissError;
      }
      setAlerts(prev => prev.filter(a => !ids.includes(a.sick_call_alert_id)));
      setError(null);
    } catch (err) {
      setError(`Failed to dismiss: ${err.message}`);
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold text-gray-900">
            {alerts.length === 1 ? 'Sick call' : `${alerts.length} sick calls`}
          </h2>
          <button onClick={() => handleDismiss(alerts.map(a => a.sick_call_alert_id))} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
            <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="space-y-3">
          {alerts.map(alert => (
            <div key={alert.sick_call_alert_id} className="p-4 bg-red-50 border border-red-300 rounded-lg">
              <p className="text-sm font-medium text-gray-900 whitespace-pre-wrap">{alert.message}</p>
              <div className="flex items-center justify-between gap-3 mt-3">
                <p className="text-xs text-gray-500">
                  {new Date(alert.created_at).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
                <button
                  onClick={() => handleDismiss([alert.sick_call_alert_id])}
                  className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded text-xs transition"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
