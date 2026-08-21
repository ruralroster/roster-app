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
