// "View as" — lets a super admin see the staff app as one of a
// department's staff (App.js), read-only.
//
// The super admin's own login has officer rights everywhere, so anything
// they tapped while viewing as someone would really happen: marking that
// person unavailable, volunteering them, sending a sick call. Instead,
// while viewing as someone, previewFetch (supabaseClient.js's fetch) lets
// reads through and refuses everything else before it leaves the browser:
//   - table writes (POST/PATCH/PUT/DELETE to /rest/v1/),
//   - RPCs, except the read-only ones below,
//   - Edge Functions (emails and push notifications),
//   - changes to the login itself (password, 2FA).
// Signing in and token refreshes still go through. A refused request
// comes back as a 403 whose message says nothing was saved, so the screen
// shows that instead of pretending it worked.

let viewing = null; // { staffId, name } or null

export const setViewingAs = (who) => { viewing = who; };
export const getViewingAs = () => viewing;

// RPCs that only read. Anything not listed is refused while viewing as
// someone — safe if a new read RPC is added and missed here (it just
// shows an error in the preview).
const READ_RPCS = new Set([
  'birthdays_today',
  'get_staff_off_days',
  'my_must_reset_password',
  'validate_supervision',
  'my_roster_swap_shifts',
  'my_department_swaps',
]);

export const PREVIEW_MESSAGE = 'Preview only — nothing is saved or sent while viewing as someone.';

function refused(url, method) {
  if (method === 'GET' || method === 'HEAD') return false;
  const { pathname } = new URL(url, window.location.origin);
  if (pathname.includes('/rest/v1/rpc/')) return !READ_RPCS.has(pathname.split('/rest/v1/rpc/')[1]);
  if (pathname.includes('/rest/v1/') || pathname.includes('/functions/v1/') || pathname.includes('/storage/v1/')) return true;
  return pathname.includes('/auth/v1/user') || pathname.includes('/auth/v1/factors');
}

export function previewFetch(input, init = {}) {
  if (viewing) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || (typeof input === 'string' ? 'GET' : input.method) || 'GET').toUpperCase();
    if (refused(url, method)) {
      return Promise.resolve(new Response(
        JSON.stringify({ message: PREVIEW_MESSAGE, code: 'preview', details: null, hint: null }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ));
    }
  }
  return fetch(input, init);
}
