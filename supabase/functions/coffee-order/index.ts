// Coffee order emails and the 8:15 push, replacing the Apps Script and its
// preferences sheet. Called every 5 minutes, 8:00-17:00 Brisbane, by the
// pg_cron job in migrations/2026-10-25_coffee_order_emails.sql. Each call,
// for each department with coffee_emails on:
//
//   8:15-10:30  'reminder' (once): if anyone working this morning has no
//               coffee order (coffeeAttention: blank saved order, or a
//               Planner visitor with no extra), push whoever was ED on call
//               overnight. Tapping it opens the Coffee popup.
//   9:00-10:30  'daily' (once): "Daily Coffee Order" email to the
//               consultant on today's ED late, laid out like the old Apps
//               Script email.
//   9:00-17:00  'update': once the daily email has gone, if the order now
//               differs from the last email, a "Coffee order update" email
//               to the same person: what changed, then the full order.
//               Several edits between two runs arrive as one email.
//
// The order is worked out by _shared/coffeeDay.js, the same code as the
// app's Coffee popup, so the email and the popup always agree.
//
// The timer proves itself with the x-cron-secret header, checked against
// Supabase Vault by coffee_cron_secret_ok(). Deployed with --no-verify-jwt
// since that header, not a login, is what lets it in.
//
// Testing: a call with body { "preview": "you@example.com" } (still with
// the secret) emails that address today's order as it stands, and records
// nothing. See the end of the migration file.
//
// Deploy: `supabase functions deploy coffee-order --no-verify-jwt`
// Uses the same GMAIL_USER, GMAIL_APP_PASSWORD, VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY and APP_URL secrets as notify-volunteering.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';
import webpush from 'npm:web-push@3.6.7';
import { dayCoffeeOrder, edLateConsultant, edOnCallDutyType, edOnCallStaffId } from '../_shared/coffeeDay.js';
import { getDepartmentSessionBoundaries } from '../_shared/shiftSessionUtils.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_USER = Deno.env.get('GMAIL_USER');
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD');
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const APP_URL = (Deno.env.get('APP_URL') || 'https://ruralroster.github.io/roster-app/').replace(/\/?$/, '/');
const COFFEE_URL = `${APP_URL}?coffee=1`;

const REMINDER_AT = 8 * 60 + 15;
const DAILY_AT = 9 * 60;
const FIRST_EMAILS_UNTIL = 10 * 60 + 30; // coffee is ordered at 10:30
const UPDATES_UNTIL = 17 * 60;

type Row = { name: string; coffee: string };
type Snapshot = { rows: Row[]; lines: string[]; total: number; sentTo?: string };
type Recipient = { staff_id: string | null; name: string | null; email: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Today's date and the minutes since midnight in Brisbane (UTC+10, no
// daylight saving), whatever the server's clock zone.
function brisbaneNow(offsetDays = 0) {
  const d = new Date(Date.now() + 10 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const secret = req.headers.get('x-cron-secret') || '';
  const { data: ok } = await admin.rpc('coffee_cron_secret_ok', { p_secret: secret });
  if (!secret || !ok) return json({ error: 'Not allowed' }, 401);

  let body: { preview?: string } = {};
  try {
    body = await req.json();
  } catch {
    // The timer sends {}; nothing else is needed.
  }

  const { data: departments, error } = await admin.from('departments').select('*').eq('coffee_emails', true);
  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const department of departments ?? []) {
    try {
      results.push({ department: department.name, ...(await runDepartment(admin, department, body.preview)) });
    } catch (err) {
      console.error(`coffee-order failed for ${department.name}:`, err);
      results.push({ department: department.name, error: String(err) });
    }
  }
  return json({ data: results });
});

// deno-lint-ignore no-explicit-any
async function runDepartment(admin: SupabaseClient, department: any, preview?: string) {
  const { date, minutes } = brisbaneNow();
  const day = await loadDay(admin, department, date);

  if (preview) {
    await sendOrderEmail(department, day.order, { staff_id: null, name: null, email: preview }, null, null);
    return { preview: true };
  }

  const done: string[] = [];
  const sends = await admin
    .from('coffee_order_sends')
    .select('kind, snapshot, sent_at')
    .eq('department_id', department.department_id)
    .eq('date', date)
    .order('sent_at');
  const sent = sends.data ?? [];
  const hasSent = (kind: string) => sent.some((s) => s.kind === kind);

  if (minutes >= REMINDER_AT && minutes < FIRST_EMAILS_UNTIL && !hasSent('reminder')) {
    if (await claim(admin, department.department_id, date, 'reminder', null, { missing: day.order.missing.map((m: { name: string }) => m.name) })) {
      if (day.order.missing.length > 0) await sendReminder(admin, department, day.order.missing);
      done.push('reminder');
    }
  }

  const snapshot: Snapshot = { rows: day.order.rows, lines: day.order.lines, total: day.order.total };

  if (minutes >= DAILY_AT && minutes < FIRST_EMAILS_UNTIL && !hasSent('daily')) {
    const recipients = await recipientsFor(admin, department, day);
    const sentTo = recipients.map((r) => r.email).join(', ');
    if (await claim(admin, department.department_id, date, 'daily', recipients[0]?.staff_id ?? null, { ...snapshot, sentTo })) {
      for (const r of recipients) await sendOrderEmail(department, day.order, r, null, day.fallbackNote);
      done.push('daily');
    }
    return { done };
  }

  if (hasSent('daily') && minutes < UPDATES_UNTIL) {
    const last = sent.filter((s) => s.kind !== 'reminder').at(-1)?.snapshot as Snapshot | undefined;
    const changes = last ? describeChanges(last, snapshot) : [];
    if (changes.length > 0) {
      const recipients = await recipientsFor(admin, department, day);
      const sentTo = recipients.map((r) => r.email).join(', ');
      await admin.from('coffee_order_sends').insert({
        department_id: department.department_id, date, kind: 'update',
        staff_id: recipients[0]?.staff_id ?? null, snapshot: { ...snapshot, sentTo },
      });
      for (const r of recipients) await sendOrderEmail(department, day.order, r, changes, day.fallbackNote);
      done.push('update');
    }
  }

  return { done };
}

// Inserting the once-a-day row claims it; false if another run got there.
async function claim(admin: SupabaseClient, departmentId: string, date: string, kind: string, staffId: string | null, snapshot: unknown) {
  const { error } = await admin.from('coffee_order_sends').insert({ department_id: departmentId, date, kind, staff_id: staffId, snapshot });
  if (error && error.code !== '23505') throw error;
  return !error;
}

// deno-lint-ignore no-explicit-any
async function loadDay(admin: SupabaseClient, department: any, date: string) {
  const dept = department.department_id;
  const [assignRes, dutyTypesRes, dutiesRes, removedRes, extrasRes, visitorsRes] = await Promise.all([
    admin.from('staff_assignments')
      .select('*, staff(name, rank, coffee_order, email), locations(name), shifts(start_time, end_time)')
      .eq('department_id', dept).eq('date', date),
    admin.from('duty_types').select('*').eq('department_id', dept),
    admin.from('duty_assignments').select('staff_id, duty_type').eq('department_id', dept).eq('date', date),
    admin.from('coffee_order_removed_staff').select('staff_id').eq('department_id', dept).eq('date', date),
    admin.from('coffee_order_extras').select('*').eq('department_id', dept).eq('date', date).order('created_at'),
    admin.from('theatre_activity_visitors')
      .select('name, theatre_activities!inner(date, start_time, end_time)')
      .eq('department_id', dept).eq('theatre_activities.date', date),
  ]);
  const firstError = [assignRes, dutyTypesRes, dutiesRes, removedRes, extrasRes, visitorsRes].find((r) => r.error)?.error;
  if (firstError) throw firstError;

  const assignments = assignRes.data ?? [];
  const edDuty = edOnCallDutyType(dutyTypesRes.data ?? []);
  const edOnCallIds = edDuty ? (dutiesRes.data ?? []).filter((d) => d.duty_type === edDuty.key && d.staff_id).map((d) => d.staff_id) : [];

  const order = dayCoffeeOrder({
    assignments,
    // deno-lint-ignore no-explicit-any
    visitors: (visitorsRes.data ?? []).map((v: any) => ({ name: v.name, start_time: v.theatre_activities?.start_time, end_time: v.theatre_activities?.end_time })),
    removedStaffIds: (removedRes.data ?? []).map((r) => r.staff_id),
    extras: extrasRes.data ?? [],
    boundaries: getDepartmentSessionBoundaries(department),
  });

  return { assignments, edDuty, edOnCallIds, order, fallbackNote: null as string | null };
}

// The consultant on today's ED late. If that can't be worked out (nobody,
// two with neither in the ED on-call slot, or no email), the department's
// officers get it instead, with a note saying why.
// deno-lint-ignore no-explicit-any
async function recipientsFor(admin: SupabaseClient, department: any, day: any): Promise<Recipient[]> {
  const edl = edLateConsultant(day.assignments, day.edOnCallIds);
  // deno-lint-ignore no-explicit-any
  const staff = edl && day.assignments.find((a: any) => a.staff_id === edl.staff_id)?.staff;
  if (edl && staff?.email) return [{ staff_id: edl.staff_id, name: edl.name, email: staff.email }];

  day.fallbackNote = edl
    ? `${edl.name} is on the ED late today but has no email in the app, so this has gone to the rostering officers.`
    : "The app couldn't work out who's on the ED late today, so this has gone to the rostering officers.";
  const { data: officers } = await admin
    .from('staff')
    .select('staff_id, name, email')
    .eq('department_id', department.department_id)
    .eq('role', 'officer')
    .eq('active', true);
  return (officers ?? []).filter((o) => o.email).map((o) => ({ staff_id: o.staff_id, name: o.name, email: o.email }));
}

// "What's changed" lines between the last email and now, by name.
function describeChanges(before: Snapshot, after: Snapshot) {
  const was = new Map(before.rows.map((r) => [r.name, r.coffee]));
  const now = new Map(after.rows.map((r) => [r.name, r.coffee]));
  const changes: string[] = [];
  for (const [name, coffee] of now) {
    if (!was.has(name)) changes.push(`Added: ${name} (${coffee})`);
    else if (was.get(name) !== coffee) changes.push(`Changed: ${name}, ${was.get(name)} → ${coffee}`);
  }
  for (const [name] of was) if (!now.has(name)) changes.push(`Removed: ${name}`);
  if (changes.length === 0 && JSON.stringify(before.lines) !== JSON.stringify(after.lines)) changes.push('The order totals have changed.');
  return changes;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const FONT = 'font-family: Arial, sans-serif;';
const CELL = 'border: 1px solid #ddd; padding: 8px; text-align: left;';

function firstName(name: string | null) {
  return (name || '').replace(/^\s*(dr|prof|a\/prof)\.?\s+/i, '').trim().split(/\s+/)[0] || 'there';
}

// Same layout as the Apps Script email, plus the "most up-to-date" line at
// the top and, for an update, what's changed.
async function sendOrderEmail(
  // deno-lint-ignore no-explicit-any
  department: any,
  order: { rows: Row[]; lines: string[]; total: number },
  to: Recipient,
  changes: string[] | null,
  fallbackNote: string | null,
) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set');

  const place = department.coffee_place_name || 'the coffee shop';
  const deptName = department.name;
  const totalText = `Total: ${order.total} coffee${order.total === 1 ? '' : 's'}`;

  const html = [
    `<p style="${FONT}">Good morning ${escapeHtml(firstName(to.name))}!</p>`,
    `<p style="${FONT}">This email contains the most up-to-date coffee order. Don't forget, you can text the order directly to ${escapeHtml(place)} by <a href="${COFFEE_URL}">opening the app</a> and pressing the coffee icon.</p>`,
    fallbackNote ? `<p style="${FONT} color: #b45309;">${escapeHtml(fallbackNote)}</p>` : '',
    changes
      ? `<h3 style="${FONT}">What's changed</h3><ul style="${FONT}">${changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
      : `<p style="${FONT}">You're on-call today for ED late (and coffee!) in ${escapeHtml(deptName)}. Here is the coffee order for today:</p>`,
    `<h3 style="${FONT}">Coffee Summary</h3>`,
    `<div style="${FONT} background-color: #f9f9f9; padding: 10px; border-radius: 5px;">${order.lines.map(escapeHtml).join('<br>')}${order.lines.length ? '<br><br>' : ''}${totalText}</div>`,
    `<h3 style="${FONT} margin-top: 20px;">Staff Working Today</h3>`,
    `<table style="border-collapse: collapse; width: 100%; max-width: 400px;">`,
    `<tr style="background-color: #f0f0f0;"><th style="${CELL}">Staff Name</th><th style="${CELL}">Coffee</th></tr>`,
    ...order.rows.map((r) => `<tr><td style="${CELL}">${escapeHtml(r.name || '')}</td><td style="${CELL}">${escapeHtml(r.coffee)}</td></tr>`),
    `</table>`,
    `<p style="${FONT} margin-top: 20px;">Cheers,<br>${escapeHtml(deptName)} Team</p>`,
  ].join('\n');

  const text = [
    `Good morning ${firstName(to.name)}!`,
    '',
    `This email contains the most up-to-date coffee order. Don't forget, you can text the order directly to ${place} by opening the app (${COFFEE_URL}) and pressing the coffee icon.`,
    ...(fallbackNote ? ['', fallbackNote] : []),
    '',
    ...(changes ? ["What's changed:", ...changes.map((c) => `- ${c}`)] : [`You're on-call today for ED late (and coffee!) in ${deptName}. Here is the coffee order for today:`]),
    '',
    'Coffee Summary',
    ...order.lines,
    '',
    totalText,
    '',
    'Staff Working Today',
    ...order.rows.map((r) => `${r.name}: ${r.coffee}`),
    '',
    'Cheers,',
    `${deptName} Team`,
  ].join('\n');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  await transporter.sendMail({
    from: `"${deptName} Coffee" <${GMAIL_USER}>`,
    to: to.email,
    subject: changes ? 'Coffee order update' : 'Daily Coffee Order',
    text,
    html,
  });
}

// 8:15: push whoever was ED on call overnight (yesterday's ED on-call slot,
// or yesterday's ED late if the slot was empty).
// deno-lint-ignore no-explicit-any
async function sendReminder(admin: SupabaseClient, department: any, missing: { name: string }[]) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const yesterday = brisbaneNow(-1).date;
  const prev = await loadDay(admin, department, yesterday);
  const staffId = edOnCallStaffId(prev.assignments, prev.edOnCallIds);
  if (!staffId) {
    console.log(`coffee-order: no single ED on call for ${yesterday}, reminder not sent`);
    return;
  }

  webpush.setVapidDetails(`mailto:${GMAIL_USER || 'ruralroster@gmail.com'}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const { data: subs } = await admin.from('push_subscriptions').select('push_subscription_id, endpoint, p256dh, auth').eq('staff_id', staffId);
  const names = missing.map((m) => m.name);
  const payload = JSON.stringify({
    title: names.length === 1 ? 'Someone working today has no coffee order' : `${names.length} people working today have no coffee order`,
    body: `${names.join(', ')}. Tap to add their coffee before the 9:00 email.`,
    url: COFFEE_URL,
    tag: 'coffee-reminder',
  });
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('push_subscription_id', sub.push_subscription_id);
      } else {
        console.error('Coffee reminder push failed:', err);
      }
    }
  }
}
