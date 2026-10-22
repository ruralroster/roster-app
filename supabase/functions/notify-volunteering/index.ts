// Email + push notifications for the volunteering flow (GitHub issue #1):
//
//   event 'offer'     - an officer just offered a shift. Every staff member
//                       eligible for it (isEligibleForOffer — the same rules
//                       as their Available Shifts list, including being
//                       marked available that day) is told.
//   event 'volunteer' - a staff member just volunteered. The department's
//                       officers are told.
//   event 'test'      - sends the caller a test, from Settings →
//                       Notifications, to check their setup.
//   event 'sick'      - a staff member just pressed Notify Sick. Of the
//                       report's sick_call_alerts rows (written by their
//                       app, see getSickCallRecipients), rostering
//                       officers are emailed — always, whatever their email
//                       setting, since covering a sick call is their job —
//                       and whoever's on call now gets a phone
//                       notification. Everyone on the list still gets the
//                       in-app pop-up too.
//
// Each person chooses in Settings → Notifications: email unless they've
// turned it off (staff.notify_email), and push on each device they've
// turned it on for (a push_subscriptions row).
//
// Called from the browser straight after the row is written
// (supabase.functions.invoke, with the caller's own login), not from a
// database webhook — so there's no extra webhook secret to manage. The
// caller has to be allowed to have written the row: an officer of the
// offer's department, or the staff member who volunteered. Each offer and
// request is only ever notified once (notified_at is claimed before
// sending), so a retried or repeated call can't email everyone twice.
//
// Email goes through Gmail SMTP on port 465, from the same account as the
// district app (rural-rosters-v3). Push uses Web Push with this app's own
// VAPID keys. Either is skipped if its secrets aren't set.
//
// Deploy: `supabase functions deploy notify-volunteering`
// Secrets (never committed — `supabase secrets set NAME=value`):
//   GMAIL_USER           ruralroster@gmail.com
//   GMAIL_APP_PASSWORD   a Gmail app password for that account
//   VAPID_PUBLIC_KEY     from `npx web-push generate-vapid-keys`
//   VAPID_PRIVATE_KEY    "
//   APP_URL              optional, defaults to the GitHub Pages address
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
// provided automatically to every Edge Function.
//
// Request body: { event, theatreActivityId?, role?, departmentId? }
// Response:     { data: { emailed, pushed, failed, skipped? } } | { error }

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';
import webpush from 'npm:web-push@3.6.7';
import { isEligibleForOffer } from '../_shared/offerEligibility.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_USER = Deno.env.get('GMAIL_USER');
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD');
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const APP_URL = (Deno.env.get('APP_URL') || 'https://ruralroster.github.io/roster-app/').replace(/\/?$/, '/');
const APP_NAME = 'Roster';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

type Recipient = { staff_id: string; name: string | null; email: string | null; notify_email: boolean };
type Message = { title: string; body: string; path: string; tag: string };
type Card = {
  date: string;
  required_grade: string | null;
  locations: { name: string } | null;
  shifts: { name: string; start_time: string | null; end_time: string | null } | null;
  activity_types: { name: string; required_advanced_skills: string[] | null } | null;
};

const CARD_COLUMNS = 'date, required_grade, locations(name), shifts(name, start_time, end_time), activity_types(name, required_advanced_skills)';
const ROLE_LABEL: Record<string, string> = { consultant: 'Consultant', registrar: 'Registrar' };
const GRADE_LABEL: Record<string, string> = { smo: 'SMO', registrar: 'Registrar', intern: 'Intern' };

function describeCard(card: Card, role: string) {
  const date = new Date(`${card.date}T00:00:00Z`).toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
  const where = [card.locations?.name, card.activity_types?.name].filter(Boolean).join(' — ');
  const shift = card.shifts
    ? ` ${card.shifts.name} (${card.shifts.start_time?.slice(0, 5)}–${card.shifts.end_time?.slice(0, 5)})`
    : '';
  const level = card.required_grade && ((card.required_grade === 'smo') === (role === 'consultant'))
    ? GRADE_LABEL[card.required_grade]
    : ROLE_LABEL[role] || role;
  return { date, where, shift, level };
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

// channels narrows a send to just email or just push (the sick call);
// either way each person's own settings still apply to what's left.
async function send(
  admin: SupabaseClient,
  recipients: Recipient[],
  message: Message,
  channels: { email?: boolean; push?: boolean } = {},
) {
  const { email: useEmail = true, push: usePush = true } = channels;
  const url = `${APP_URL}${message.path}`;
  let emailed = 0;
  let pushed = 0;
  let failed = 0;

  if (useEmail && GMAIL_USER && GMAIL_APP_PASSWORD) {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
    // One email each, so nobody sees who else was told. Gmail's Sent
    // folder keeps the record.
    for (const r of recipients) {
      if (!r.email || !r.notify_email) continue;
      try {
        await transporter.sendMail({
          from: `"${APP_NAME}" <${GMAIL_USER}>`,
          to: r.email,
          subject: `[${APP_NAME}] ${message.title}`,
          text: `Hi ${r.name || 'there'},\n\n${message.body}\n\n${url}\n`,
          html: `<p>Hi ${escapeHtml(r.name || 'there')},</p>
<p>${escapeHtml(message.body)}</p>
<p><a href="${url}" style="background:#2563eb;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;">Open ${APP_NAME}</a></p>`,
        });
        emailed += 1;
      } catch (err) {
        failed += 1;
        console.error(`Email to ${r.email} failed:`, err);
      }
    }
  }

  if (usePush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && recipients.length > 0) {
    webpush.setVapidDetails(`mailto:${GMAIL_USER || 'ruralroster@gmail.com'}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    const { data: subs, error } = await admin
      .from('push_subscriptions')
      .select('push_subscription_id, endpoint, p256dh, auth')
      .in('staff_id', recipients.map(r => r.staff_id));
    if (error) console.error('Loading push subscriptions failed:', error);

    const payload = JSON.stringify({ title: message.title, body: message.body, url, tag: message.tag });
    for (const sub of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        pushed += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The browser has dropped this subscription — it'll never work again.
          await admin.from('push_subscriptions').delete().eq('push_subscription_id', sub.push_subscription_id);
        } else {
          failed += 1;
          console.error('Push failed:', err);
        }
      }
    }
  }

  return { emailed, pushed, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  let body: { event?: string; theatreActivityId?: string; role?: string; departmentId?: string; sickReportId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const { event, theatreActivityId, role, departmentId, sickReportId } = body;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Not signed in' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: myStaffRows, error: meError } = await admin
    .from('staff')
    .select('staff_id, department_id, name, email, notify_email')
    .eq('user_id', user.id)
    .eq('active', true);
  if (meError) return json({ error: meError.message }, 500);
  const myStaffIds = new Set((myStaffRows || []).map(s => s.staff_id));

  try {
    if (event === 'test') {
      const me = (myStaffRows || []).find(s => s.department_id === departmentId);
      if (!me) return json({ error: 'You are not a member of that department' }, 403);
      const result = await send(admin, [me], {
        title: 'Test notification',
        body: 'Notifications are working on this account. You will be told about shifts you can volunteer for.',
        path: '',
        tag: 'test',
      });
      return json({ data: result });
    }

    if (event === 'sick') {
      if (!sickReportId) return json({ error: 'sickReportId is required' }, 400);
      const { data: report, error } = await admin
        .from('sick_reports')
        .select('sick_report_id, staff_id, staff(name)')
        .eq('sick_report_id', sickReportId)
        .maybeSingle();
      if (error) throw error;
      if (!report || !myStaffIds.has(report.staff_id)) return json({ error: 'No sick report of yours with that id' }, 403);

      const { data: claimed, error: claimError } = await admin
        .from('sick_reports')
        .update({ notified_at: new Date().toISOString() })
        .eq('sick_report_id', sickReportId)
        .is('notified_at', null)
        .select('sick_report_id');
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) return json({ data: { skipped: 'already notified' } });

      const { data: alerts, error: alertsError } = await admin
        .from('sick_call_alerts')
        .select('reason, message, staff:recipient_staff_id(staff_id, name, email, notify_email, role, active)')
        .eq('sick_report_id', sickReportId);
      if (alertsError) throw alertsError;

      type AlertStaff = Recipient & { role: string; active: boolean };
      const rows = (alerts || [])
        .map(a => ({ reasons: (a.reason as string).split(','), staff: a.staff as unknown as AlertStaff | null }))
        .filter(a => a.staff?.active);
      // The reporter's app picked these reasons, so the officer email is
      // checked against the staff record rather than taken on trust.
      const officers = rows
        .filter(a => a.reasons.includes('officer') && a.staff!.role === 'officer')
        .map(a => ({ ...a.staff!, notify_email: true }));
      const onCall = rows.filter(a => a.reasons.includes('on_call')).map(a => a.staff!);

      const reporterName = (report.staff as unknown as { name: string } | null)?.name || 'Someone';
      const message = {
        title: `${reporterName} has called in sick`,
        body: alerts?.[0]?.message || `${reporterName} has called in sick for their shift.`,
        path: '',
        tag: `sick-${sickReportId}`,
      };
      const [emailResult, pushResult] = await Promise.all([
        send(admin, officers, message, { push: false }),
        send(admin, onCall, message, { email: false }),
      ]);
      return json({
        data: {
          emailed: emailResult.emailed,
          pushed: pushResult.pushed,
          failed: emailResult.failed + pushResult.failed,
          recipients: officers.length + onCall.length,
        },
      });
    }

    if (!theatreActivityId || (role !== 'consultant' && role !== 'registrar')) {
      return json({ error: 'theatreActivityId and role are required' }, 400);
    }

    if (event === 'offer') {
      const { data: offer, error } = await admin
        .from('volunteer_offers')
        .select(`volunteer_offer_id, department_id, theatre_activities(${CARD_COLUMNS})`)
        .eq('theatre_activity_id', theatreActivityId)
        .eq('role', role)
        .maybeSingle();
      if (error) throw error;
      if (!offer) return json({ data: { skipped: 'offer not found' } });

      const { data: isOfficer } = await userClient.rpc('is_department_officer', { dept_id: offer.department_id });
      if (!isOfficer) return json({ error: 'Only an officer of this department can do that' }, 403);

      const { data: claimed, error: claimError } = await admin
        .from('volunteer_offers')
        .update({ notified_at: new Date().toISOString() })
        .eq('volunteer_offer_id', offer.volunteer_offer_id)
        .is('notified_at', null)
        .select('volunteer_offer_id');
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) return json({ data: { skipped: 'already notified' } });

      const card = offer.theatre_activities as unknown as Card;
      const [staffRes, ranksRes, availRes, filledRes] = await Promise.all([
        admin.from('staff')
          .select('staff_id, name, email, notify_email, rank, activity_restrictions, advanced_skills')
          .eq('department_id', offer.department_id)
          .eq('active', true),
        admin.from('rank_supervision_rules').select('*').eq('department_id', offer.department_id),
        admin.from('staff_availability').select('staff_id').eq('date', card.date).eq('available', true),
        admin.from('staff_assignments').select('assignment_id').eq('theatre_activity_id', theatreActivityId).eq('role', role).limit(1),
      ]);
      for (const res of [staffRes, ranksRes, availRes, filledRes]) if (res.error) throw res.error;

      const availableIds = new Set((availRes.data || []).map(a => a.staff_id));
      const roleFilled = (filledRes.data || []).length > 0;
      const recipients = (staffRes.data || []).filter(s => !myStaffIds.has(s.staff_id) && isEligibleForOffer({
        offerRole: role,
        rankRow: (ranksRes.data || []).find(r => r.rank === s.rank) || null,
        requiredGrade: card.required_grade,
        roleFilled,
        isAvailable: availableIds.has(s.staff_id),
        activityName: card.activity_types?.name || null,
        restrictions: s.activity_restrictions || [],
        requiredSkills: card.activity_types?.required_advanced_skills || [],
        skills: s.advanced_skills || [],
      }));

      const { date, where, shift, level } = describeCard(card, role);
      const result = await send(admin, recipients, {
        title: `Shift available ${date}`,
        body: `${where}${shift} on ${date} needs a ${level}. Open Variation → Available Shifts to volunteer.`,
        path: '?tab=volunteer',
        tag: `offer-${theatreActivityId}-${role}`,
      });
      return json({ data: { ...result, recipients: recipients.length } });
    }

    if (event === 'volunteer') {
      const { data: request, error } = await admin
        .from('volunteer_requests')
        .select('staff_id, staff(name)')
        .eq('theatre_activity_id', theatreActivityId)
        .eq('role', role)
        .in('staff_id', [...myStaffIds])
        .maybeSingle();
      if (error) throw error;
      if (!request) return json({ error: 'No volunteer request of yours for that shift' }, 403);

      const { data: claimed, error: claimError } = await admin
        .from('volunteer_requests')
        .update({ notified_at: new Date().toISOString() })
        .eq('theatre_activity_id', theatreActivityId)
        .eq('role', role)
        .eq('staff_id', request.staff_id)
        .is('notified_at', null)
        .select('staff_id');
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) return json({ data: { skipped: 'already notified' } });

      const { data: cardRow, error: cardError } = await admin
        .from('theatre_activities')
        .select(`department_id, ${CARD_COLUMNS}`)
        .eq('theatre_activity_id', theatreActivityId)
        .single();
      if (cardError) throw cardError;

      const { data: officers, error: officersError } = await admin
        .from('staff')
        .select('staff_id, name, email, notify_email')
        .eq('department_id', cardRow.department_id)
        .eq('role', 'officer')
        .eq('active', true)
        .neq('staff_id', request.staff_id);
      if (officersError) throw officersError;

      const volunteerName = (request.staff as unknown as { name: string } | null)?.name || 'Someone';
      const { date, where, shift, level } = describeCard(cardRow as unknown as Card, role);
      const result = await send(admin, officers || [], {
        title: `${volunteerName} volunteered for ${date}`,
        body: `${volunteerName} has volunteered as ${level} for ${where}${shift} on ${date}. Open the Calendar to review and accept.`,
        path: '?tab=calendar',
        tag: `volunteer-${theatreActivityId}-${role}`,
      });
      return json({ data: { ...result, recipients: (officers || []).length } });
    }

    return json({ error: "event must be 'offer', 'volunteer', 'sick' or 'test'" }, 400);
  } catch (err) {
    console.error('notify-volunteering error:', err);
    return json({ error: (err as Error).message || String(err) }, 500);
  }
});
