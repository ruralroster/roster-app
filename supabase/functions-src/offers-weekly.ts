// The weekly volunteering email (confirmed 2026-11-23): instead of an email
// every time a shift is offered, each staff member gets one email a week
// listing every offered shift in the next fortnight they could take — the
// same rules as their Available Shifts list (isEligibleForOffer: their
// grade and skills, the role not yet filled, and marked available that
// day). Nobody with nothing to take is emailed, nor anyone who's turned
// email off (staff.notify_email). Offers still go to phones straight away
// (notify-volunteering).
//
// Called by the pg_cron job in migrations/2026-11-23_offers_weekly.sql,
// Mondays 07:00 Brisbane. The timer proves itself with the x-cron-secret
// header, the same Vault secret as coffee-order (coffee_cron_secret_ok), so
// it's deployed with JWT verification off.
//
// Testing: body { "preview": "you@example.com" } (still with the secret)
// sends every summary to that address instead, with the staff member's
// name in the subject.
//
// This is the source. supabase/functions/offers-weekly/index.ts is
// generated from it by `npm run build:functions`: paste that into the web
// editor as a function named exactly offers-weekly, and turn off JWT
// verification in its Details. Uses the GMAIL_USER, GMAIL_APP_PASSWORD and
// APP_URL secrets notify-volunteering already has.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';
import { isEligibleForOffer, offerIsFilled } from '../functions/_shared/offerEligibility.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_USER = Deno.env.get('GMAIL_USER');
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD');
const APP_URL = (Deno.env.get('APP_URL') || 'https://ruralroster.github.io/roster-app/').replace(/\/?$/, '/');
const APP_NAME = 'Rstar';
const DAYS_AHEAD = 14;

const ROLE_LABEL: Record<string, string> = { consultant: 'Consultant', registrar: 'Registrar' };
const GRADE_LABEL: Record<string, string> = { smo: 'SMO', registrar: 'Registrar', intern: 'Intern' };
const CARD_COLUMNS = 'date, required_grade, locations(name), shifts(name, start_time, end_time), activity_types(name, required_advanced_skills)';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function brisbaneToday() {
  return new Date(Date.now() + 10 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Card = {
  date: string;
  required_grade: string | null;
  locations: { name: string } | null;
  shifts: { name: string; start_time: string | null; end_time: string | null } | null;
  activity_types: { name: string; required_advanced_skills: string[] | null } | null;
};

function describe(card: Card, role: string, disruption: boolean) {
  const date = new Date(`${card.date}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const where = [card.locations?.name, card.activity_types?.name].filter(Boolean).join(' — ');
  const hours = card.shifts?.start_time ? ` ${card.shifts.start_time.slice(0, 5)}–${card.shifts.end_time?.slice(0, 5)}` : '';
  const level = card.required_grade && ((card.required_grade === 'smo') === (role === 'consultant'))
    ? GRADE_LABEL[card.required_grade] : ROLE_LABEL[role] || role;
  return { sortKey: `${card.date}${hours}`, line: `${date}${hours} · ${where} · ${level}${disruption ? ' · service closes if unfilled' : ''}` };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: ok } = await admin.rpc('coffee_cron_secret_ok', { p_secret: req.headers.get('x-cron-secret') || '' });
  if (!ok) return json({ error: 'Not allowed' }, 403);
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return json({ error: 'GMAIL_USER / GMAIL_APP_PASSWORD not set' }, 500);
  let body: { preview?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }

  const from = brisbaneToday();
  const to = addDays(from, DAYS_AHEAD - 1);
  const { data: offers, error } = await admin
    .from('volunteer_offers')
    .select(`volunteer_offer_id, department_id, role, filled_baseline, service_disruption, theatre_activity_id, theatre_activities!inner(${CARD_COLUMNS})`)
    .gte('theatre_activities.date', from)
    .lte('theatre_activities.date', to);
  if (error) return json({ error: error.message }, 500);

  // Each staff member's list: staff_id -> { staff, lines }.
  const lists = new Map<string, { staff: { name: string; email: string | null; notify_email: boolean }; lines: { sortKey: string; line: string }[] }>();
  const departments = [...new Set((offers || []).map(o => o.department_id))];
  for (const departmentId of departments) {
    const deptOffers = (offers || []).filter(o => o.department_id === departmentId);
    const dates = [...new Set(deptOffers.map(o => (o.theatre_activities as unknown as Card).date))];
    const [staffRes, ranksRes, availRes, filledRes] = await Promise.all([
      admin.from('staff').select('staff_id, name, email, notify_email, rank, activity_restrictions, advanced_skills').eq('department_id', departmentId).eq('active', true),
      admin.from('rank_supervision_rules').select('*').eq('department_id', departmentId),
      admin.from('staff_availability').select('staff_id, date').in('date', dates).eq('available', true),
      admin.from('staff_assignments').select('theatre_activity_id, role').in('theatre_activity_id', deptOffers.map(o => o.theatre_activity_id)),
    ]);
    for (const res of [staffRes, ranksRes, availRes, filledRes]) if (res.error) return json({ error: res.error.message }, 500);

    for (const offer of deptOffers) {
      const card = offer.theatre_activities as unknown as Card;
      const held = (filledRes.data || []).filter(a => a.theatre_activity_id === offer.theatre_activity_id && a.role === offer.role).length;
      const roleFilled = offerIsFilled(offer, held);
      if (roleFilled) continue;
      const available = new Set((availRes.data || []).filter(a => a.date === card.date).map(a => a.staff_id));
      const described = describe(card, offer.role, !!offer.service_disruption);
      for (const s of staffRes.data || []) {
        const eligible = isEligibleForOffer({
          offerRole: offer.role,
          rankRow: (ranksRes.data || []).find(r => r.rank === s.rank) || null,
          requiredGrade: card.required_grade,
          roleFilled,
          isAvailable: available.has(s.staff_id),
          activityName: card.activity_types?.name || null,
          restrictions: s.activity_restrictions || [],
          requiredSkills: card.activity_types?.required_advanced_skills || [],
          skills: s.advanced_skills || [],
        });
        if (!eligible) continue;
        if (!lists.has(s.staff_id)) lists.set(s.staff_id, { staff: s, lines: [] });
        lists.get(s.staff_id)!.lines.push(described);
      }
    }
  }

  const transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
  const url = `${APP_URL}?tab=volunteer`;
  let emailed = 0;
  let failed = 0;
  for (const { staff, lines } of lists.values()) {
    if (!body.preview && (!staff.email || !staff.notify_email)) continue;
    lines.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const count = `${lines.length} shift${lines.length === 1 ? '' : 's'}`;
    try {
      await transporter.sendMail({
        from: `"${APP_NAME}" <${GMAIL_USER}>`,
        to: body.preview || staff.email!,
        subject: `[${APP_NAME}] ${count} you can volunteer for${body.preview ? ` (preview for ${staff.name})` : ''}`,
        text: `Hi ${staff.name || 'there'},\n\nThese shifts in the next fortnight are looking for someone, and you could take them:\n\n${lines.map(l => `- ${l.line}`).join('\n')}\n\nOpen Variation → Available Shifts to volunteer:\n${url}\n`,
        html: `<p>Hi ${escapeHtml(staff.name || 'there')},</p>
<p>These shifts in the next fortnight are looking for someone, and you could take them:</p>
<ul>${lines.map(l => `<li>${escapeHtml(l.line)}</li>`).join('')}</ul>
<p><a href="${url}" style="background:#2563eb;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;">Open Available Shifts</a></p>`,
      });
      emailed += 1;
    } catch (err) {
      failed += 1;
      console.error(`Weekly email to ${staff.email} failed:`, err);
    }
  }
  return json({ data: { offers: (offers || []).length, people: lists.size, emailed, failed } });
});
