import React, { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { getDeferredInstallPrompt, triggerInstallPrompt, isStandalone, isIOS } from './installPrompt';

// A manual "Install App" affordance for when the browser doesn't offer its
// own install prompt on its own — Chrome/Edge/Android only show their
// passive mini-infobar under their own engagement heuristics, so plenty of
// sessions never see it even when the app is fully installable. Renders
// nothing once already installed (standalone mode).
//
//  - Chrome/Edge/Android: a captured beforeinstallprompt event (see
//    installPrompt.js) lets this button trigger the browser's real native
//    install dialog directly.
//  - iOS Safari: there is no programmatic install API at all — "Add to
//    Home Screen" is a manual Share-menu action only, so this shows
//    instructions instead of a button that would silently do nothing.
//  - Anything else (desktop Firefox, an already-ineligible page, etc.):
//    renders nothing — there's no install action to offer.
export default function InstallAppButton() {
  const [installable, setInstallable] = useState(!!getDeferredInstallPrompt());
  const [installed, setInstalled] = useState(isStandalone());
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  useEffect(() => {
    const handler = () => {
      setInstallable(!!getDeferredInstallPrompt());
      setInstalled(isStandalone());
    };
    window.addEventListener('pwa-install-available', handler);
    return () => window.removeEventListener('pwa-install-available', handler);
  }, []);

  if (installed) return null;

  const handleInstall = async () => {
    await triggerInstallPrompt();
    setInstallable(!!getDeferredInstallPrompt());
    setInstalled(isStandalone());
  };

  if (installable) {
    return (
      <button
        type="button"
        onClick={handleInstall}
        className="w-full flex items-center justify-center gap-2 text-sm text-blue-600 hover:text-blue-700 mt-3 py-2 border border-blue-200 rounded-lg hover:bg-blue-50 transition"
      >
        <Download size={16} />
        Install App
      </button>
    );
  }

  if (isIOS()) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowIOSHelp(!showIOSHelp)}
          className="w-full flex items-center justify-center gap-2 text-sm text-blue-600 hover:text-blue-700 py-2 border border-blue-200 rounded-lg hover:bg-blue-50 transition"
        >
          <Download size={16} />
          Install App
        </button>
        {showIOSHelp && (
          <p className="text-xs text-gray-600 text-center mt-2">
            Tap the Share icon in Safari, then "Add to Home Screen".
          </p>
        )}
      </div>
    );
  }

  return null;
}
