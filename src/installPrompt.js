// Captures the browser's beforeinstallprompt event as early as possible —
// this file is imported once from index.js purely for that side effect, so
// the listener is registered before anything else has a chance to miss it.
// Chrome/Edge/Android fire it once when the PWA installability criteria
// are met (valid manifest + icons + registered service worker, all now in
// place — see public/index.html); calling preventDefault() immediately
// stops the browser's own passive mini-infobar and keeps the event around
// so InstallAppButton can trigger the real native install dialog on
// demand instead of waiting for the browser to decide to show it.
//
// iOS Safari never fires this event at all — there is no programmatic
// install API there. "Add to Home Screen" is a manual action from the
// Share menu only, so InstallAppButton shows instructions instead of a
// button that would do nothing.
let deferredPrompt = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.dispatchEvent(new Event('pwa-install-available'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.dispatchEvent(new Event('pwa-install-available'));
  });
}

export function getDeferredInstallPrompt() {
  return deferredPrompt;
}

// Shows the browser's real install dialog. Resolves to the user's choice
// ({ outcome: 'accepted' | 'dismissed' }), or null if no prompt was ever
// captured (e.g. already installed, or a browser that doesn't support this).
export async function triggerInstallPrompt() {
  if (!deferredPrompt) return null;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return choice;
}

export function isStandalone() {
  return (
    (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (typeof window !== 'undefined' && window.navigator.standalone === true)
  );
}

export function isIOS() {
  return typeof window !== 'undefined' && /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
}
