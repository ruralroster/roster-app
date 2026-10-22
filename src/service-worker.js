/* eslint-disable no-restricted-globals */

// App-shell-only service worker: precaches the static build output
// (JS/CSS/HTML/images) that Workbox's InjectManifest plugin lists via
// self.__WB_MANIFEST at build time, so the app installs and loads
// instantly offline. Deliberately does NOT add any runtime caching route
// for Supabase requests — roster data and auth state must always come from
// the network, never a stale cache, so there's no offline write queue and
// no risk of showing yesterday's roster as current.

import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';

clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

const fileExtensionRegexp = new RegExp('/[^/?]+\\.[^/]+$');

registerRoute(
  ({ request, url }) => {
    if (request.mode !== 'navigate') return false;
    if (url.pathname.startsWith('/_')) return false;
    if (url.pathname.match(fileExtensionRegexp)) return false;
    return true;
  },
  createHandlerBoundToURL(process.env.PUBLIC_URL + '/index.html')
);

// Static images only — never anything under the Supabase URL, so roster
// data is always fetched fresh.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.endsWith('.png'),
  new StaleWhileRevalidate({
    cacheName: 'images',
    plugins: [new ExpirationPlugin({ maxEntries: 50 })],
  })
);

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Web Push — GitHub issue #1. The notify-volunteering Edge Function sends
// { title, body, url, tag }; tag collapses repeats about the same shift
// into one notification.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Roster', {
      body: data.body || '',
      icon: `${process.env.PUBLIC_URL}/logo192.png`,
      badge: `${process.env.PUBLIC_URL}/logo192.png`,
      tag: data.tag,
      data: { url: data.url || self.registration.scope },
    })
  );
});

// Tapping a notification opens its link — in an already-open Roster
// window if there is one, otherwise a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find(w => w.url.startsWith(self.registration.scope));
      if (!existing) return self.clients.openWindow(url);
      // navigate() only works on a window this worker controls; fall back
      // to a new window rather than leaving the tap doing nothing.
      return existing.focus()
        .then(() => existing.navigate(url))
        .catch(() => self.clients.openWindow(url));
    })
  );
});
