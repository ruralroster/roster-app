import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import UpdateBanner from './UpdateBanner';
import reportWebVitals from './reportWebVitals';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
// Imported purely for its side effect: registers the beforeinstallprompt
// listener as early as possible, so InstallAppButton (rendered on the
// Login screen) can trigger the browser's real install dialog on demand
// even if the event fired before that component ever mounted.
import './installPrompt';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
    <UpdateBanner />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

// Registers the app-shell service worker (src/service-worker.js) so the
// app installs as a PWA and loads instantly offline. It never caches
// Supabase requests — see that file's own comment. onUpdate hands the
// newly-installed (but not yet active) worker to UpdateBanner, which
// offers a one-click way to activate and reload it — see that file's
// comment for why that's needed at all.
serviceWorkerRegistration.register({
  onUpdate: (registration) => {
    if (registration.waiting) {
      window.dispatchEvent(new CustomEvent('sw-update-available', { detail: registration.waiting }));
    }
  },
});
