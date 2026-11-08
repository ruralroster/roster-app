import React, { useEffect, useState } from 'react';

// Keeps everyone on the latest version without them having to do anything.
//
// CRA's default service-worker setup leaves a newly-installed update
// silently "waiting" until every tab of the app is fully closed —
// service-worker.js listens for a SKIP_WAITING message to force it live
// sooner. index.js's onUpdate config dispatches 'sw-update-available' with
// the waiting worker as soon as one shows up. This component:
//   - checks for a new version whenever the app comes back to the screen,
//     and hourly while it stays open (each check is one small request);
//   - applies it and reloads straight away if the app was only just
//     opened (or brought back), or is in the background;
//   - otherwise waits until nobody is typing, no dialog is open and the
//     screen hasn't been touched for a little while, so nobody loses what
//     they're in the middle of. Until then a banner says an update is
//     coming, with a button to take it now.

const CHECK_EVERY_MS = 60 * 60 * 1000;
const JUST_OPENED_MS = 15 * 1000; // after opening or coming back to the app
const IDLE_MS = 2 * 60 * 1000; // updates aren't urgent: wait for a real pause

// True while someone is mid-task: typing in a field or with a dialog
// (the app's modals are full-screen `fixed inset-0` overlays) open.
function isBusy() {
  const el = document.activeElement;
  if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return true;
  return !!document.querySelector('.fixed.inset-0');
}

export default function UpdateBanner() {
  const [waitingWorker, setWaitingWorker] = useState(null);

  useEffect(() => {
    const handler = (event) => setWaitingWorker(event.detail);
    window.addEventListener('sw-update-available', handler);
    return () => window.removeEventListener('sw-update-available', handler);
  }, []);

  // Look for a new version regularly, and on coming back to the app.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const check = () => navigator.serviceWorker.getRegistration().then(reg => reg?.update()).catch(() => {});
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // Once a new version is waiting: reload when it takes over, and hand it
  // over at the first safe moment.
  useEffect(() => {
    if (!waitingWorker || !('serviceWorker' in navigator)) return undefined;
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const apply = () => waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    let shownAt = performance.now(); // page load, or the last return to the app
    let lastTouch = 0;
    const onTouch = () => { lastTouch = performance.now(); };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') apply();
      else shownAt = performance.now();
    };
    const tryApply = () => {
      const now = performance.now();
      if (document.visibilityState === 'hidden') { apply(); return; }
      if (isBusy()) return;
      if (now - shownAt < JUST_OPENED_MS || now - lastTouch > IDLE_MS) apply();
    };
    tryApply();
    const timer = setInterval(tryApply, 5000);
    window.addEventListener('pointerdown', onTouch, true);
    window.addEventListener('keydown', onTouch, true);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', onTouch, true);
      window.removeEventListener('keydown', onTouch, true);
      document.removeEventListener('visibilitychange', onVisibility);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, [waitingWorker]);

  if (!waitingWorker) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] bg-blue-600 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-lg">
      <p className="text-sm font-medium">An update is ready. The app will refresh itself when you've finished what you're doing.</p>
      <button
        onClick={() => waitingWorker.postMessage({ type: 'SKIP_WAITING' })}
        className="px-3 py-1.5 bg-white text-blue-700 font-semibold rounded text-sm hover:bg-blue-50 transition flex-shrink-0"
      >
        Update now
      </button>
    </div>
  );
}
