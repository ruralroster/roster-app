// Meeting reminders: the phone notification shortly before a meeting and
// the morning email, for the meetings laid out on the Planner. Called by
// the pg_cron job in migrations/2026-10-31_meetings.sql, every minute but
// only when meetings_due() says something is due.
//
// For each meeting today (Brisbane), each reminder that's due and not yet
// sent (see dueReminders in _shared/meetingAudience.js) is claimed by
// inserting its meeting_sends row, then sent to everyone the meeting's
// audience covers that day: a push to each of their devices, or an email
// to their staff email. People coming off or going on a night shift get
// the email but not the push (nightStaffIds). Reminders never touch
// anyone's shift.
//
// The timer proves itself with the x-cron-secret header, the same Vault
// secret as coffee-order (coffee_cron_secret_ok). Deployed with
// --no-verify-jwt since that header, not a login, is what lets it in.
//
// Testing: body { "meetingId": "...", "preview": "you@example.com" } (still
// with the secret) emails that address the meeting's reminder and pushes
// that person's devices if they're staff, and records nothing.
//
// This is the source. supabase/functions/meeting-reminders/index.ts is
// generated from it by `npm run build:functions`.
//
// Deploy: `supabase functions deploy meeting-reminders --no-verify-jwt`, or
// paste the generated index.ts into the web editor and turn off JWT
// verification in the function's Details.
// Uses the same GMAIL_USER, GMAIL_APP_PASSWORD, VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY and APP_URL secrets as notify-volunteering.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';
import webpush from 'npm:web-push@3.6.7';
import { dueReminders, meetingRecipients, nightStaffIds } from '../functions/_shared/meetingAudience.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_USER = Deno.env.get('GMAIL_USER');
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD');
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const APP_URL = (Deno.env.get('APP_URL') || 'https://ruralroster.github.io/roster-app/').replace(/\/?$/, '/');

type Person = { staff_id: string; name: string; email: string | null; rank: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Today's date and the minutes since midnight in Brisbane (UTC+10, no
// daylight saving), whatever the server's clock zone.
function brisbaneNow() {
  const d = new Date(Date.now() + 10 * 3600 * 1000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const secret = req.headers.get('x-cron-secret') || '';
  const { data: ok } = await admin.rpc('coffee_cron_secret_ok', { p_secret: secret });
  if (!secret || !ok) return json({ error: 'Not allowed' }, 401);

  let body: { meetingId?: string; preview?: string } = {};
  try {
    body = await req.json();
  } catch {
    // The timer sends {}; nothing else is needed.
  }

  if (body.meetingId && body.preview) return json(await preview(admin, body.meetingId, body.preview));

  const { date, minutes } = brisbaneNow();
  const { data: meetings, error } = await admin.from('meetings').select('*, locations(name)').eq('date', date);
  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const meeting of meetings ?? []) {
    const due = dueReminders(meeting, minutes);
    if (due.length === 0) continue;
    try {
      const { people, nightIds } = await recipients(admin, meeting);
      for (const kind of due) {
        const to = kind === 'push' ? people.filter((p) => !nightIds.has(p.staff_id)) : people;
        const sentTo = to.map((p) => p.name);
        const { error: claimError } = await admin.from('meeting_sends').insert({
          meeting_id: meeting.meeting_id, kind, department_id: meeting.department_id, sent_to: sentTo,
        });
        if (claimError) {
          if (claimError.code === '23505') continue; // already sent
          throw claimError;
        }
        if (kind === 'push') await sendPushes(admin, meeting, to);
        else await sendEmails(admin, meeting, to);
        results.push({ meeting: meeting.name, kind, people: to.length });
      }
    } catch (err) {
      console.error(`meeting-reminders failed for ${meeting.name} (${meeting.meeting_id}):`, err);
      results.push({ meeting: meeting.name, error: String(err) });
    }
  }
  return json({ data: results });
});

// Everyone the meeting's audience covers on its day, and which of them are
// on nights (no push).
// deno-lint-ignore no-explicit-any
async function recipients(admin: SupabaseClient, meeting: any): Promise<{ people: Person[]; nightIds: Set<string> }> {
  const dept = meeting.department_id;
  const yesterday = new Date(Date.parse(`${meeting.date}T00:00:00Z`) - 86400 * 1000).toISOString().slice(0, 10);
  const [staffRes, ranksRes, assignRes, dutiesRes, awayRes] = await Promise.all([
    admin.from('staff').select('staff_id, name, email, rank').eq('department_id', dept).eq('active', true),
    admin.from('rank_supervision_rules').select('rank, requires_supervision').eq('department_id', dept),
    admin.from('staff_assignments').select('staff_id, date, shifts(start_time, end_time)')
      .eq('department_id', dept).gte('date', yesterday).lte('date', meeting.date),
    admin.from('duty_assignments').select('staff_id').eq('department_id', dept).eq('date', meeting.date),
    admin.from('staff_availability').select('staff_id, staff!inner(department_id)')
      .eq('staff.department_id', dept).eq('date', meeting.date).eq('available', false),
  ]);
  const firstError = [staffRes, ranksRes, assignRes, dutiesRes, awayRes].find((r) => r.error)?.error;
  if (firstError) throw firstError;

  const assignments = assignRes.data ?? [];
  const today = assignments.filter((a) => a.date === meeting.date);
  const workingIds = new Set([...today, ...(dutiesRes.data ?? [])].map((r) => r.staff_id).filter(Boolean));
  const awayIds = new Set((awayRes.data ?? []).map((r) => r.staff_id));
  const people = meetingRecipients(meeting.audience, { staff: staffRes.data ?? [], rankRows: ranksRes.data ?? [], workingIds, awayIds });
  return { people, nightIds: nightStaffIds(assignments, meeting.date) };
}

const hhmm = (t: string) => (t || '').slice(0, 5);
const telHref = (dialIn: string) => `tel:${dialIn.replace(/[^\d+,;#*]/g, '')}`;

// "Junior teaching at 08:00, ICU seminar room"
// deno-lint-ignore no-explicit-any
function headline(meeting: any) {
  const where = meeting.locations?.name ? `, ${meeting.locations.name}` : '';
  return `${meeting.name} at ${hhmm(meeting.start_time)}${where}`;
}

// deno-lint-ignore no-explicit-any
async function sendPushes(admin: SupabaseClient, meeting: any, people: Person[]) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || people.length === 0) return;
  webpush.setVapidDetails(`mailto:${GMAIL_USER || 'ruralroster@gmail.com'}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('push_subscription_id, endpoint, p256dh, auth')
    .in('staff_id', people.map((p) => p.staff_id));
  const join = meeting.join_url ? ' Tap to join.' : meeting.dial_in ? ` Dial in: ${meeting.dial_in}` : '';
  const payload = JSON.stringify({
    title: headline(meeting),
    body: `Starts at ${hhmm(meeting.start_time)}.${join}`,
    url: meeting.join_url || APP_URL,
    tag: `meeting-${meeting.meeting_id}`,
  });
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('push_subscription_id', sub.push_subscription_id);
      } else {
        console.error('Meeting push failed:', err);
      }
    }
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const FONT = 'font-family: Arial, sans-serif;';

function firstName(name: string | null) {
  return (name || '').replace(/^\s*(dr|prof|a\/prof)\.?\s+/i, '').trim().split(/\s+/)[0] || 'there';
}

// deno-lint-ignore no-explicit-any
async function sendEmails(admin: SupabaseClient, meeting: any, people: Person[]) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set');
  const { data: department } = await admin.from('departments').select('name').eq('department_id', meeting.department_id).single();
  const deptName = (department?.name || 'Rstar').replace(/\s+hospital$/i, '');
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  for (const p of people) {
    if (!p.email) continue;
    try {
      await transporter.sendMail({
        from: `"${deptName} Rstar" <${GMAIL_USER}>`,
        to: p.email,
        subject: `Today: ${headline(meeting)}`,
        ...emailBody(meeting, p, deptName),
      });
    } catch (err) {
      console.error(`Meeting email to ${p.email} failed:`, err);
    }
  }
}

// deno-lint-ignore no-explicit-any
function emailBody(meeting: any, p: { name: string | null }, deptName: string) {
  const when = `${hhmm(meeting.start_time)}–${hhmm(meeting.end_time)}`;
  const where = meeting.locations?.name || null;
  const html = [
    `<p style="${FONT}">Good morning ${escapeHtml(firstName(p.name))},</p>`,
    `<p style="${FONT}">A reminder that <strong>${escapeHtml(meeting.name)}</strong> is on today, ${when}${where ? ` in ${escapeHtml(where)}` : ''}.</p>`,
    meeting.join_url ? `<p style="${FONT}"><a href="${escapeHtml(meeting.join_url)}">Join online</a></p>` : '',
    meeting.dial_in ? `<p style="${FONT}">Dial in: <a href="${escapeHtml(telHref(meeting.dial_in))}">${escapeHtml(meeting.dial_in)}</a></p>` : '',
    `<p style="${FONT}">Cheers,<br>${escapeHtml(deptName)} Team</p>`,
  ].join('\n');
  const text = [
    `Good morning ${firstName(p.name)},`,
    '',
    `A reminder that ${meeting.name} is on today, ${when}${where ? ` in ${where}` : ''}.`,
    ...(meeting.join_url ? ['', `Join online: ${meeting.join_url}`] : []),
    ...(meeting.dial_in ? ['', `Dial in: ${meeting.dial_in}`] : []),
    '',
    'Cheers,',
    `${deptName} Team`,
  ].join('\n');
  return { html, text };
}

// Sends one meeting's reminders to a test address now, recording nothing.
async function preview(admin: SupabaseClient, meetingId: string, email: string) {
  const { data: meeting, error } = await admin.from('meetings').select('*, locations(name)').eq('meeting_id', meetingId).single();
  if (error) return { error: error.message };
  const { data: who } = await admin
    .from('staff')
    .select('staff_id, name, email, rank')
    .eq('department_id', meeting.department_id)
    .ilike('email', email)
    .limit(1)
    .maybeSingle();
  const person: Person = who ?? { staff_id: '', name: '', email, rank: null };
  await sendEmails(admin, meeting, [{ ...person, email }]);
  if (who) await sendPushes(admin, meeting, [who]);
  const { people, nightIds } = await recipients(admin, meeting);
  return {
    preview: true,
    emailTo: people.map((p) => p.name),
    pushTo: people.filter((p) => !nightIds.has(p.staff_id)).map((p) => p.name),
  };
}
