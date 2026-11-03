// Screenshots of Rstar and DR Roster for the decks, signed in as the demo
// officer and doctor (Wattle Creek / Demo District, all made-up people).
// Staff and DR Roster screens at phone size; Rstar's officer screens at
// laptop size. Writes shots/<name>.png. Each shot is independent: a
// failure is logged and the rest carry on.
//
// It also makes the demo look alive first: the officer offers three gaps
// for volunteering and the doctor volunteers for one (demo people have
// notifications off, so nobody is emailed).
const fs = require('fs');
const { chromium, devices } = require('playwright');

const env = Object.fromEntries(fs.readFileSync('/home/bengladwin/roster-app/scripts/demo-copy/.screenshot-logins', 'utf8')
  .split('\n').filter(l => /^DEMO_\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const ROSTAR = 'https://ruralroster.github.io/roster-app/';
const DR = 'https://ruralroster.github.io/district-roster/';
const PHONE = { ...devices['iPhone 13'], locale: 'en-AU', timezoneId: 'Australia/Brisbane', permissions: ['notifications'] };
const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'en-AU', timezoneId: 'Australia/Brisbane', permissions: ['notifications'] };
const ONLY = process.argv.slice(2); // optional: only these shot names

fs.mkdirSync('shots', { recursive: true });
const failures = [];

async function open(browser, url, who, device, { signIn = true } = {}) {
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept()); // offer / volunteer confirmations
  // Headless Chromium reports notifications as blocked; show the screen a
  // phone sees before it's been asked.
  await page.addInitScript(() => {
    if ('Notification' in window) Object.defineProperty(Notification, 'permission', { get: () => 'default' });
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  if (signIn) {
    await page.fill('input[type="email"]', env[`DEMO_${who}_EMAIL`]);
    await page.fill('input[type="password"]', env[`DEMO_${who}_PASSWORD`]);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
  }
  return { ctx, page };
}

async function shot(page, name, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  try {
    if (fn) await fn();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `shots/${name}.png` });
    console.log('ok  ', name);
  } catch (e) {
    failures.push(name);
    console.log('FAIL', name, e.message.split('\n')[0]);
  }
}

const tap = (page, text, opts = {}) => page.getByText(text, { exact: true, ...opts }).last().click();
const top = (page) => page.evaluate(() => window.scrollTo(0, 0));
// Scroll so the element sits a little below the top of the screen.
const bringUp = (locator, offset = 90) => locator.evaluate((el, off) => {
  window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off);
}, offset);

(async () => {
  const browser = await chromium.launch();
  const all = !ONLY.length;

  // ---- Set the scene: offers and a volunteer. The officer offers two
  // registrar gaps on days the demo doctor isn't rostered (so they're shown
  // them); the doctor volunteers for one and the other stays available.
  if (all || ONLY.includes('setup')) {
    const d = await open(browser, ROSTAR, 'DOCTOR', PHONE);
    await tap(d.page, 'Variation');
    await d.page.waitForTimeout(6000);
    const busy = new Set((await d.page.$$eval('b, strong, span, div', els => els.map(e => e.textContent.trim())))
      .map(t => (t.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d+ \w{3}/) || [])[0]).filter(Boolean));
    console.log('setup: doctor busy on', [...busy].join(' | '));

    const o = await open(browser, ROSTAR, 'OFFICER', LAPTOP);
    try {
      if (await o.page.getByText('View: Staff').count()) await o.page.getByText('View: Staff').click();
      await o.page.waitForTimeout(3000);
      await o.page.getByText(/Unfilled, not offered yet/).click();
      await o.page.waitForTimeout(800);
      const tomorrow = new Date(Date.now() + 86400000);
      const rows = await o.page.getByRole('button', { name: 'Offer Registrar' }).evaluateAll(bs =>
        bs.map(b => b.closest('div').parentElement.querySelector('p')?.textContent || ''));
      const picks = rows.map((t, i) => ({ t, i, day: t.split(' · ')[0] }))
        .filter(r => !busy.has(r.day) && /Emergency/.test(r.t) && new Date(r.day + ' ' + tomorrow.getFullYear()) >= new Date(tomorrow.toDateString()))
        .slice(0, 2);
      // Click from the bottom up so earlier indexes stay put.
      for (const r of [...picks].reverse()) {
        await o.page.getByRole('button', { name: 'Offer Registrar' }).nth(r.i).click();
        await o.page.getByRole('button', { name: 'Offer', exact: true }).click(); // the offer dialog
        await o.page.waitForTimeout(2500);
        console.log('setup: offered', r.t);
      }
    } catch (e) { console.log('setup offers:', e.message.split('\n')[0]); }
    await o.ctx.close();

    try {
      await d.page.reload({ waitUntil: 'networkidle' });
      await tap(d.page, 'Variation');
      await d.page.waitForTimeout(6000);
      const vol = d.page.getByRole('button', { name: /^Volunteer/ });
      console.log('setup: doctor can volunteer for', await vol.count());
      if (await vol.count()) { await vol.first().click(); await d.page.waitForTimeout(2500); console.log('setup: volunteered'); }
    } catch (e) { console.log('setup volunteer:', e.message.split('\n')[0]); }
    await d.ctx.close();
  }

  // ---- Rstar, a callback from start to finish (phone). Only when named
  // (node shots.js r_callback r_timer r_short r_patient r_fatigue). The demo
  // doctor isn't really on call, so their on-call lookup and the callback
  // itself are answered in this browser only: nothing is written.
  const CALLBACK_SHOTS = ['r_callback', 'r_timer', 'r_short', 'r_patient', 'r_fatigue'];
  if (CALLBACK_SHOTS.some(n => ONLY.includes(n))) {
    const { ctx, page } = await open(browser, ROSTAR, 'DOCTOR', PHONE);
    await page.route('**/rest/v1/duty_assignments*', async route => {
      const url = route.request().url();
      if (!url.includes('staff_id=eq.')) return route.continue();
      const typesUrl = url.replace(/duty_assignments\?.*/, 'duty_types?select=key,counts_as_on_call,start_time,end_time&active=eq.true&counts_as_on_call=eq.true');
      const types = await (await route.fetch({ url: typesUrl })).json();
      const now = new Date();
      const hhmm = now.toTimeString().slice(0, 5);
      const covers = (t) => t.start_time && t.end_time && (t.start_time <= t.end_time
        ? hhmm >= t.start_time.slice(0, 5) && hhmm < t.end_time.slice(0, 5)
        : hhmm >= t.start_time.slice(0, 5) || hhmm < t.end_time.slice(0, 5));
      const type = types.find(covers) || types[0];
      const day = new Date(now);
      if (type.start_time > type.end_time && hhmm < type.end_time.slice(0, 5)) day.setDate(day.getDate() - 1);
      const date = day.toLocaleDateString('en-CA');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ date, duty_type: type.key }]) });
    });
    // The callback: started 7 minutes ago (so it asks whether to record a
    // short one), finished when Complete is tapped.
    let call = null;
    const reply = (route, row) => {
      const one = (route.request().headers().accept || '').includes('vnd.pgrst.object');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(one ? row : [row]) });
    };
    await page.route('**/rest/v1/callbacks*', async route => {
      const req = route.request();
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '[]');
        const row = Array.isArray(body) ? body[0] : body;
        call = { ...row, callback_id: '00000000-0000-0000-0000-000000000001', started_at: new Date(Date.now() - 7 * 60000).toISOString(), ended_at: null, edited_at: null, shifts: null };
        return reply(route, call);
      }
      if (req.method() === 'PATCH' && call) {
        call = { ...call, ...JSON.parse(req.postData() || '{}') };
        return reply(route, call);
      }
      if (req.method() === 'GET' && call && !call.ended_at && req.url().includes('ended_at=is.null')) return reply(route, call);
      return route.continue();
    });
    await tap(page, 'Variation'); await page.waitForTimeout(4000);
    await shot(page, 'r_callback', () => top(page));
    await shot(page, 'r_timer', async () => {
      await page.getByRole('button', { name: /^Callback/ }).first().click(); await page.waitForTimeout(3000);
      await top(page);
    });
    await shot(page, 'r_short', () => page.getByRole('button', { name: /Complete$/ }).first().click());
    await shot(page, 'r_patient', async () => {
      await page.getByRole('button', { name: 'Record it' }).click(); await page.waitForTimeout(1500);
      await page.locator('input[inputmode="numeric"]').fill('123456');
    });
    await shot(page, 'r_fatigue', async () => {
      await page.getByRole('button', { name: 'Skip', exact: true }).click(); await page.waitForTimeout(800);
    });
    await ctx.close();
  }

  // ---- Rstar, the Overtime button (phone). Only when named (node shots.js
  // r_overtime). The demo doctor's own shifts are answered in this browser
  // with one that ended 20 minutes ago, and no on-call: nothing is written.
  if (ONLY.includes('r_overtime')) {
    const { ctx, page } = await open(browser, ROSTAR, 'DOCTOR', PHONE);
    await page.route('**/rest/v1/duty_assignments*', route =>
      route.request().url().includes('staff_id=eq.')
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.continue());
    await page.route('**/rest/v1/staff_assignments*', async route => {
      const url = route.request().url();
      if (!url.includes('staff_id=eq.') || !url.includes('on_call')) return route.continue();
      const end = new Date(Date.now() - 20 * 60000);
      const start = new Date(end.getTime() - 8 * 3600000);
      const hm = (d) => d.toTimeString().slice(0, 8);
      const row = { date: start.toLocaleDateString('en-CA'), shift_id: '00000000-0000-0000-0000-000000000002', on_call: false,
        shifts: { name: 'ED Day', start_time: hm(start), end_time: hm(end) } };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) });
    });
    await tap(page, 'Variation'); await page.waitForTimeout(4000);
    await shot(page, 'r_overtime', () => top(page));
    await ctx.close();
  }

  // ---- Rstar, staff (phone).
  {
    const s = await open(browser, ROSTAR, null, PHONE, { signIn: false });
    await shot(s.page, 'r_signin');
    await s.ctx.close();

    const { ctx, page } = await open(browser, ROSTAR, 'DOCTOR', PHONE);
    await shot(page, 'r_day');
    await shot(page, 'r_week', () => tap(page, 'Week'));
    await shot(page, 'r_phonebook', () => tap(page, 'Phone Book'));
    await shot(page, 'r_variation', async () => { await tap(page, 'Variation'); await page.waitForTimeout(5000); await bringUp(page.getByRole('heading', { name: 'Available Shifts' }), 120); });
    await shot(page, 'r_swapform', async () => {
      await tap(page, 'Variation');
      await page.getByRole('button', { name: /Swap a shift/ }).click(); // collapsed by default
      await page.getByRole('button', { name: 'Offer for swap' }).first().click();
      await bringUp(page.getByText(/could work in return/).first(), 220);
    });
    await shot(page, 'r_myvariations', async () => {
      await tap(page, 'Variation');
      const head = page.getByText('My Variations', { exact: true }).first();
      await head.click();
      await bringUp(head, 120);
    });
    await shot(page, 'r_sick', async () => {
      await tap(page, 'Variation');
      await page.getByRole('button', { name: 'Notify Sick' }).click();
    });
    await page.keyboard.press('Escape');
    await page.goto(ROSTAR, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
    await shot(page, 'r_coffee', () => page.getByRole('button', { name: /Coffee/ }).last().click());
    await page.goto(ROSTAR, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
    await shot(page, 'r_availability', async () => { await tap(page, 'Settings'); await tap(page, 'Availability'); });
    await shot(page, 'r_profile', async () => { await tap(page, 'Settings'); await tap(page, 'Profile'); await top(page); });
    await shot(page, 'r_coffeeprefs', async () => { await tap(page, 'Settings'); await page.locator('div.flex-wrap > button', { hasText: /^Coffee$/ }).click(); await top(page); });
    await shot(page, 'r_notifications', async () => { await tap(page, 'Settings'); await tap(page, 'Notifications'); });
    await shot(page, 'r_restrictions', async () => { await tap(page, 'Settings'); await tap(page, 'Restrictions'); await top(page); });
    await shot(page, 'r_security', async () => { await tap(page, 'Settings'); await tap(page, 'Security'); await top(page); });
    await shot(page, 'r_twofactor', async () => {
      await tap(page, 'Settings'); await tap(page, 'Security');
      await bringUp(page.getByText(/Two-Factor Authentication/i).first(), 120);
    });
    await shot(page, 'r_export', async () => {
      await page.goto(ROSTAR, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
      await tap(page, 'Export'); await page.waitForTimeout(2500); await top(page);
    });
    // Where staff find help: Settings → Walkthrough (the video decks' last slide).
    await shot(page, 'r_help', async () => {
      await page.goto(ROSTAR, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
      await tap(page, 'Settings'); await tap(page, 'Walkthrough'); await top(page);
    });
    await ctx.close();
  }

  // ---- Rstar, staff screens that need something the demo doesn't have:
  // stars, recorded variations, a meeting, a swap. Only when named. The
  // extra rows are answered in this browser only: nothing is written.
  const EXTRA_SHOTS = ['r_setpassword', 'r_installios', 'r_search', 'r_person', 'r_starred', 'r_crossover', 'r_myvariations_full', 'r_meeting', 'r_takeswap'];
  if (EXTRA_SHOTS.some(n => ONLY.includes(n))) {
    // Invite links land on Set your password (?type=invite); don't save it.
    if (['r_setpassword', 'r_installios'].some(n => ONLY.includes(n))) {
      const s = await open(browser, ROSTAR, null, PHONE, { signIn: false });
      await shot(s.page, 'r_installios', () => tap(s.page, 'Install App'));
      await s.ctx.close();
      const p = await open(browser, `${ROSTAR}?type=invite`, 'DOCTOR', PHONE);
      await shot(p.page, 'r_setpassword');
      await p.ctx.close();
    }

    const { ctx, page } = await open(browser, ROSTAR, 'DOCTOR', PHONE, { signIn: false });
    const rest = (route, table, query) => route.request().url().replace(/\/rest\/v1\/.*/, `/rest/v1/${table}?${query}`);
    const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });
    const plus = (n) => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
    // Three colleagues from the demo department (RLS keeps it to theirs).
    let colleagues = null;
    const others = async (route) => colleagues || (colleagues = (await (await route.fetch({ url: rest(route, 'staff', 'select=staff_id,name&active=eq.true&order=name&limit=6') })).json())
      .filter(x => x.name !== 'Aisha Achebe').slice(0, 3));
    await page.route('**/rest/v1/staff_favorites?*', async route => {
      if (route.request().method() !== 'GET' || !ONLY.some(n => ['r_starred', 'r_crossover'].includes(n))) return route.continue();
      json(route, (await others(route)).slice(0, 2).map((c, i) => ({ favorite_id: `demo-fav-${i}`, starred_staff_id: c.staff_id })));
    });
    await page.route('**/rest/v1/callbacks?*', async route => {
      if (route.request().method() !== 'GET' || !route.request().url().includes('ended_at=not.is.null')) return route.continue();
      const types = await (await route.fetch({ url: rest(route, 'duty_types', 'select=key&active=eq.true&counts_as_on_call=eq.true') })).json();
      const at = (date, t) => new Date(`${date}T${t}:00+10:00`).toISOString();
      const row = (id, kind, date, s, e, extra) => ({ callback_id: id, kind, duty_date: date, started_at: at(date, s), ended_at: at(date, e), edited_at: null, ...extra });
      json(route, [
        row('demo-cb-1', 'callback', plus(-1), '02:10', '03:25', { duty_type: types[0]?.key, shifts: null }),
        row('demo-cb-2', 'overtime', plus(-3), '18:00', '19:05', { shifts: { name: 'ED Day' } }),
        row('demo-cb-3', 'callback', plus(-6), '22:40', '23:15', { duty_type: types[0]?.key, shifts: null }),
      ]);
    });
    await page.route('**/rest/v1/meetings?*', route => {
      if (route.request().method() !== 'GET') return route.continue();
      const u = new URL(route.request().url());
      json(route, [{ meeting_id: 'demo-meeting', department_id: u.searchParams.get('department_id')?.slice(3), name: 'Junior teaching', date: today,
        start_time: '12:30:00', end_time: '13:30:00', audience: { mode: 'everyone' }, push_minutes_before: 10, email_morning: true,
        join_url: 'https://example.com/teams', dial_in: '07 5550 0199', locations: { name: 'Education Centre' } }]);
    });
    await page.route('**/rest/v1/rpc/my_department_swaps', async route => {
      const [c] = await others(route);
      json(route, [{ listing_id: 'demo-swap', shift_date: plus(3), start_time: '08:00:00', end_time: '18:00:00', lister: c?.name || 'A colleague',
        shift_label: 'ED Day', note: 'Family wedding', my_offer_id: null,
        swap_options: [{ assignment_id: 'demo-a1', label: `${new Date(`${plus(9)}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} ED Evening 13:00-23:00 (Rstar)` }] }]);
    });
    await page.fill('input[type="email"]', env.DEMO_DOCTOR_EMAIL);
    await page.fill('input[type="password"]', env.DEMO_DOCTOR_PASSWORD);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const searchBtn = () => page.getByRole('button', { name: /Coffee/ }).last().locator('xpath=following-sibling::button[1]');
    await shot(page, 'r_meeting', () => bringUp(page.getByText('Meetings for you').first(), 160));
    await shot(page, 'r_search', async () => {
      await searchBtn().click();
      await page.getByPlaceholder('Search staff...').fill('a');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
    });
    await shot(page, 'r_person', async () => {
      if (!(await page.getByPlaceholder('Search staff...').count())) {
        await searchBtn().click();
        await page.getByPlaceholder('Search staff...').fill('a');
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.waitForTimeout(1500);
      }
      await page.locator('.max-h-96 button').nth(1).click();
    });
    await page.goto(ROSTAR, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
    await shot(page, 'r_starred', async () => { await tap(page, 'Week'); await page.waitForTimeout(2000); await top(page); });
    await shot(page, 'r_crossover', async () => {
      await tap(page, 'Week'); await page.waitForTimeout(2000);
      await page.getByRole('button', { name: /Crossover/ }).nth(1).click();
    });
    await page.goto(ROSTAR, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
    await shot(page, 'r_myvariations_full', async () => {
      await tap(page, 'Variation');
      const head = page.getByText('My Variations', { exact: true }).first();
      await head.click();
      await bringUp(head, 120);
    });
    await shot(page, 'r_takeswap', async () => {
      await tap(page, 'Variation'); await page.waitForTimeout(4000);
      await page.getByRole('button', { name: 'List', exact: true }).click();
      await bringUp(page.getByText('Swaps you could take').first(), 120);
    });
    await ctx.close();
  }

  // ---- Rstar, officer (laptop).
  {
    const { ctx, page } = await open(browser, ROSTAR, 'OFFICER', LAPTOP);
    if (await page.getByText('View: Staff').count()) await page.getByText('View: Staff').click();
    await page.waitForTimeout(2500);
    await shot(page, 'o_calendar', async () => { await page.getByRole('button', { name: /^Calendar/ }).last().click(); await top(page); });
    await shot(page, 'o_planner', async () => { await tap(page, 'Planner'); await page.waitForTimeout(2500); await top(page); });
    await shot(page, 'o_day', async () => { await tap(page, 'Day'); await page.waitForTimeout(2500); await top(page); });
    await shot(page, 'o_offer', async () => {
      await page.getByRole('button', { name: /^Calendar/ }).last().click(); await page.waitForTimeout(2000);
      await page.getByText(/Unfilled, not offered yet/).click(); await page.waitForTimeout(800);
      await page.getByRole('button', { name: /^Offer / }).first().click();
      await page.getByText(/^Service disruption:/).first().click(); // tick it, for the picture only
    });
    // Close the dialog without offering.
    if (await page.getByRole('button', { name: 'Cancel', exact: true }).count()) await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await shot(page, 'o_settings', async () => { await tap(page, 'Settings'); await top(page); });
    // Where officers find help: the Help button in the header.
    await shot(page, 'o_help', async () => {
      await top(page);
      await page.getByRole('button', { name: 'Help' }).click();
    });
    if (await page.getByText('How-To Guide').count()) await page.keyboard.press('Escape');
    await page.goto(ROSTAR, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
    if (await page.getByText('View: Staff').count()) await page.getByText('View: Staff').click();
    // One Settings section open at a time: open its group, then the section.
    const section = async (group, title) => {
      await page.goto(ROSTAR, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
      if (await page.getByText('View: Staff').count()) await page.getByText('View: Staff').click();
      await tap(page, 'Settings'); await page.waitForTimeout(800);
      await tap(page, group); await page.waitForTimeout(500);
      const head = page.getByText(title, { exact: true }).last();
      await head.click(); await page.waitForTimeout(1500);
      await bringUp(head, 80);
    };
    await shot(page, 'o_jobs', () => section('Locations & Activities', 'Jobs (Planner)'));
    await shot(page, 'o_ranks', () => section('Staff & Contacts', 'Ranks'));
    await shot(page, 'o_accounts', () => section('Staff & Contacts', 'Staff Accounts'));
    await shot(page, 'o_import', () => section('Rostering Tools', 'Excel Roster Import'));
    await shot(page, 'o_reports', () => section('Reports & Compliance', 'On-Call & Weekend Fairness'));
    await shot(page, 'o_locations', () => section('Locations & Activities', 'Locations'));
    await shot(page, 'o_activities', () => section('Locations & Activities', 'Activities'));
    await shot(page, 'o_places', async () => {
      await section('Locations & Activities', 'Jobs (Planner)');
      await page.getByRole('button', { name: 'Places', exact: true }).first().click();
      await page.waitForTimeout(800);
    });
    await page.keyboard.press('Escape');
    await shot(page, 'o_department', () => section('Department', 'Session Times'));
    await shot(page, 'o_shifts', () => section('Shifts & Rules', 'Shifts'));
    await shot(page, 'o_patternrules', () => section('Shifts & Rules', 'Shift Pattern Rules'));
    await shot(page, 'o_duties', () => section('Shifts & Rules', 'Duty Types'));
    await shot(page, 'o_leave', () => section('Shifts & Rules', 'Leave Types'));
    await shot(page, 'o_skills', () => section('Shifts & Rules', 'Advanced Skill'));
    await shot(page, 'o_weektemplates', () => section('Rostering Tools', 'Week Templates'));
    await shot(page, 'o_export', () => section('Rostering Tools', 'Excel Roster Export'));
    await shot(page, 'o_staff', () => section('Staff & Contacts', 'Staff and Availability'));
    await shot(page, 'o_phonebook', () => section('Staff & Contacts', 'Phone Book'));
    await shot(page, 'o_myaccount', async () => {
      await page.goto(ROSTAR, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
      if (await page.getByText('View: Staff').count()) await page.getByText('View: Staff').click();
      await tap(page, 'Settings'); await page.waitForTimeout(800);
      const head = page.getByText('My Account', { exact: true }).last();
      await head.click(); await page.waitForTimeout(1500);
      await bringUp(head, 80);
    });

    // Calendar: the Volunteering panel, and Copy a week / Export to Payroll.
    const calendar = async () => {
      await page.goto(ROSTAR, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
      if (await page.getByText('View: Staff').count()) await page.getByText('View: Staff').click();
      await page.getByRole('button', { name: /^Calendar/ }).last().click(); await page.waitForTimeout(2500);
    };
    await shot(page, 'o_volunteering', async () => {
      await calendar();
      await bringUp(page.getByRole('heading', { name: 'Volunteering' }), 80);
    });
    // The panel's Unfilled, not offered yet list, opened (nothing offered).
    await shot(page, 'o_unfilled', async () => {
      await calendar();
      await page.getByText(/Unfilled, not offered yet/).click(); await page.waitForTimeout(800);
      await bringUp(page.getByRole('heading', { name: 'Volunteering' }), 80);
    });
    await shot(page, 'o_caltools', async () => {
      await calendar();
      await bringUp(page.getByRole('button', { name: 'Export to Payroll' }), 420);
    });
    await shot(page, 'o_payroll', async () => {
      await page.getByRole('button', { name: 'Export to Payroll' }).click(); await page.waitForTimeout(800);
    });
    await page.keyboard.press('Escape');

    // Planner, step by step. Find a blank week (no jobs) a few weeks out,
    // lay ED Day on its weekdays, then show filling a week with gaps.
    const planner = async () => {
      await page.goto(ROSTAR, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
      if (await page.getByText('View: Staff').count()) await page.getByText('View: Staff').click();
      await tap(page, 'Planner'); await page.waitForTimeout(2500);
    };
    const nextWeek = async () => { await page.getByLabel('Next week').click(); await page.waitForTimeout(2000); };
    const jobCards = () => page.locator('div.rounded-lg.border.p-1\\.5');
    await planner();
    for (let i = 0; i < 6; i++) await nextWeek();
    for (let i = 0; i < 20 && (await jobCards().count()) > 0; i++) await nextWeek();
    await shot(page, 'o_blank', () => top(page));
    // The first palette job (Emergency, first in colour order).
    await shot(page, 'o_pick', async () => {
      await page.locator('div.space-y-1\\.5 button').first().click(); await page.waitForTimeout(800);
    });
    await shot(page, 'o_layout', async () => {
      for (let d = 0; d < 5; d++) {
        await page.getByRole('button', { name: /^\+ / }).nth(d).click(); await page.waitForTimeout(1500);
      }
      await page.locator('div.space-y-1\\.5 button').first().click(); // put the job down
      await page.waitForTimeout(1000);
    });
    await shot(page, 'o_template', async () => {
      const pick = page.getByLabel('Week template');
      if (await pick.count()) await pick.selectOption({ index: 1 });
      await bringUp(page.getByText(/^Week of /).first(), 160);
    });
    // Fill: three weeks out, where the demo leaves a few gaps.
    await planner();
    for (let i = 0; i < 3; i++) await nextWeek();
    await page.getByText('2 · Fill places').click(); await page.waitForTimeout(1000);
    await shot(page, 'o_fill', () => top(page));
    await shot(page, 'o_rank', async () => {
      // Whoever's most in need of shifts: the first name in the list.
      await page.locator('div.flex.flex-wrap.gap-1\\.5 button').first().click(); await page.waitForTimeout(1500);
      // Scroll to their choice 1.
      const best = page.locator('span[title*="choice 1:"]');
      if (await best.count()) await bringUp(best.first(), 260); else await top(page);
    });
    await ctx.close();
  }

  // ---- DR Roster, doctor (phone).
  {
    const s = await open(browser, DR, null, PHONE, { signIn: false });
    await shot(s.page, 'd_signin');
    await s.ctx.close();

    const { ctx, page } = await open(browser, DR, 'DOCTOR', PHONE);
    await shot(page, 'd_calendar');
    await shot(page, 'd_day', async () => {
      await page.locator('button.cal-available').first().click();
      await bringUp(page.getByRole('button', { name: /^Apply/ }).first(), 260);
    });
    await shot(page, 'd_block', async () => {
      await top(page);
      await page.locator('button.cal-none').first().click();
      await bringUp(page.getByText("I'm not available this day"), 300);
    });
    await shot(page, 'd_calendar_home', async () => {
      await top(page);
      await page.getByLabel('Look across sites').uncheck();
    });
    await shot(page, 'd_profile', async () => { await tap(page, 'My profile'); await top(page); });
    await shot(page, 'd_myshifts_list', async () => { await tap(page, 'Swaps'); await page.waitForTimeout(2000); await bringUp(page.locator('.view-switch'), 70); });
    await shot(page, 'd_myshifts_cal', async () => {
      await page.locator('.view-switch').getByText('Calendar').click();
      await page.waitForTimeout(800);
      await bringUp(page.locator('.my-cal-nav, .my-cal').first(), 40);
    });
    await shot(page, 'd_findswap', async () => {
      await page.locator('.view-switch').getByText('List').click();
      const b = page.getByRole('button', { name: /^Find a swap \(/ }).first();
      await b.click();
      await bringUp(b, 160);
    });
    await shot(page, 'd_listform', async () => {
      await page.getByRole('button', { name: 'List for swap' }).first().click();
      await bringUp(page.locator('form').filter({ hasText: /in return/ }).first(), 140);
    });
    await shot(page, 'd_across', async () => {
      await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
      await tap(page, 'Swaps'); await page.waitForTimeout(1500);
      const box = page.getByLabel('Look across sites').first();
      await box.check(); await page.waitForTimeout(2000);
      await bringUp(box, 140);
    });
    await ctx.close();
  }

  // ---- DR Roster, officer (phone).
  {
    const { ctx, page } = await open(browser, DR, 'OFFICER', PHONE);
    await shot(page, 'do_post', async () => { await bringUp(page.getByText('Post a shift').first(), 40); });
    await shot(page, 'do_day', async () => {
      await top(page);
      await page.locator('button.cal-open').first().click();
      await bringUp(page.getByRole('button', { name: /^Approve/ }).first(), 330);
    });
    await shot(page, 'do_swaps', async () => {
      await tap(page, 'Swaps'); await page.waitForTimeout(2000);
      await bringUp(page.getByRole('button', { name: /^Approve/ }).first(), 330);
    });
    await shot(page, 'do_account', async () => { await tap(page, 'My account'); await top(page); });
    await ctx.close();
  }

  await browser.close();
  console.log(failures.length ? `\n${failures.length} failed: ${failures.join(', ')}` : '\nall ok');
})().catch(e => { console.error(e); process.exit(1); });
