import { setViewingAs, previewFetch, PREVIEW_MESSAGE } from './viewAs';

const BASE = 'https://example.supabase.co';

describe('previewFetch', () => {
  beforeEach(() => { global.fetch = jest.fn(() => Promise.resolve(new Response('[]', { status: 200 }))); });
  afterEach(() => setViewingAs(null));

  test('passes everything through when not viewing as anyone', async () => {
    await previewFetch(`${BASE}/rest/v1/staff_availability`, { method: 'POST' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  describe('while viewing as someone', () => {
    beforeEach(() => setViewingAs({ staffId: 's1', name: 'A Barrie' }));

    test('lets reads through', async () => {
      await previewFetch(`${BASE}/rest/v1/staff?select=*`, { method: 'GET' });
      await previewFetch(`${BASE}/rest/v1/rpc/birthdays_today`, { method: 'POST' });
      await previewFetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' });
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    test.each([
      ['a table write', '/rest/v1/staff_availability', 'POST'],
      ['an update', '/rest/v1/staff?staff_id=eq.s1', 'PATCH'],
      ['a delete', '/rest/v1/volunteer_requests?x=1', 'DELETE'],
      ['a writing RPC', '/rest/v1/rpc/update_my_phone', 'POST'],
      ['an Edge Function', '/functions/v1/notify-volunteering', 'POST'],
      ['a password change', '/auth/v1/user', 'PUT'],
    ])('refuses %s', async (_, path, method) => {
      const res = await previewFetch(`${BASE}${path}`, { method });
      expect(global.fetch).not.toHaveBeenCalled();
      expect(res.status).toBe(403);
      expect((await res.json()).message).toBe(PREVIEW_MESSAGE);
    });
  });
});
