// Screenshots of Rostar and DR Roster for the decks, signed in as the demo
// officer and doctor (Wattle Creek / Demo District, all made-up people).
// Staff and DR Roster screens at phone size; Rostar's officer screens at
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

  // ---- Rostar, staff (phone).
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
      await page.getByRole('button', { name: 'Offer for swap' }).first().click();
      await bringUp(page.getByText(/Service disruption/).first(), 220);
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
    await shot(page, 'r_notifications', async () => { await tap(page, 'Settings'); await tap(page, 'Notifications'); });
    await ctx.close();
  }

  // ---- Rostar, officer (laptop).
  {
    const { ctx, page } = await open(browser, ROSTAR, 'OFFICER', LAPTOP);
    if (await page.getByText('View: Staff').count()) await page.getByText('View: Staff').click();
    await page.waitForTimeout(2500);
    await shot(page, 'o_calendar', async () => { await page.getByRole('button', { name: /^Calendar/ }).last().click(); await top(page); });
    await shot(page, 'o_planner', async () => { await tap(page, 'Planner'); await page.waitForTimeout(2500); await top(page); });
    await shot(page, 'o_day', async () => { await tap(page, 'Day'); await page.waitForTimeout(2500); await top(page); });
    await shot(page, 'o_settings', async () => { await tap(page, 'Settings'); await top(page); });
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
