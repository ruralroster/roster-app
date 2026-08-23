import React, { useEffect, useState } from 'react';

// CRA's default service-worker setup leaves a newly-installed update
// silently "waiting" until every tab of the app is fully closed —
// service-worker.js already listens for a SKIP_WAITING message (see its
// own comment) to force it live sooner, but nothing was ever triggering
// that from the client, so a plain refresh never picked up a new deploy.
// index.js's onUpdate config dispatches 'sw-update-available' with the
// waiting worker as soon as one shows up; this just offers a one-click way
// to activate it and reload once it takes over.
export default function UpdateBanner() {
  const [waitingWorker, setWaitingWorker] = useState(null);

  useEffect(() => {
    const handler = (event) => setWaitingWorker(event.detail);
    window.addEventListener('sw-update-available', handler);
    return () => window.removeEventListener('sw-update-available', handler);
  }, []);

  useEffect(() => {
    if (!waitingWorker || !('serviceWorker' in navigator)) return;
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, [waitingWorker]);

  if (!waitingWorker) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] bg-blue-600 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-lg">
      <p className="text-sm font-medium">A new version of this app is available.</p>
      <button
        onClick={() => waitingWorker.postMessage({ type: 'SKIP_WAITING' })}
        className="px-3 py-1.5 bg-white text-blue-700 font-semibold rounded text-sm hover:bg-blue-50 transition flex-shrink-0"
      >
        Reload
      </button>
    </div>
  );
}
