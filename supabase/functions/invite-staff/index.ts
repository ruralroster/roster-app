// Creates (or links) a login and makes them a member of `departmentId`.
// Runs server-side because creating an auth.users row needs the
// service_role key, which must never reach the browser — the anon key the
// rest of the app uses can't do this.
//
// Two modes, both keyed off whether `staffId` is present in the request:
//  - Creating a brand new staff record (StaffAccountsTab's invite form):
//    staffId omitted, name required, a new `staff` row is inserted.
//  - Linking an EXISTING staff row that has no account yet (the "Invite"
//    action next to a "Not linked" row in the Staff Accounts list): staffId
//    provided, name not required, the existing row is updated in place
//    (email + user_id) rather than a second, duplicate row being created.
//
// Deploy: `supabase functions deploy invite-staff`
// Required secrets (never committed, set via the Supabase CLI or dashboard):
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service role key>
//   GMAIL_USER / GMAIL_APP_PASSWORD, the same ones notify-volunteering uses
// SUPABASE_URL is provided automatically to every Edge Function.
//
// The invite email is Rstar's own, sent through Gmail, with a sign-up link
// from Supabase (generateLink), written like the one-time password email
// (StaffAccountsTab's tempPasswordMailto). That avoids Supabase's built-in
// email limit of a few an hour, and its invite template, which is shared
// with DR App.
//
// Request body: { departmentId, name, email, rank, role, redirectTo, staffId? }
// Response:     { data: { staffId, invited } } | { error }

import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GMAIL_USER = Deno.env.get('GMAIL_USER');
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD');
const ROSTER_APP_URL = 'https://ruralroster.github.io/roster-app/';

// Called from the browser (not server-to-server), so it needs to answer
// the CORS preflight OPTIONS request and set these headers on every
// response — without them the browser blocks the response before
// supabase-js ever sees it, surfacing only a generic "Failed to send a
// request to the Edge Function" with no real error message.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  let body: { departmentId?: string; name?: string; email?: string; rank?: string; role?: string; redirectTo?: string; staffId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { departmentId, name, email, rank, role, redirectTo, staffId } = body;
  if (!departmentId || !email || !rank || !role || (!staffId && !name)) {
    return json({ error: 'departmentId, email, rank, and role are required (plus name, unless linking an existing staffId)' }, 400);
  }
  if (role !== 'staff' && role !== 'officer' && role !== 'intern') {
    return json({ error: "role must be 'staff', 'officer', or 'intern'" }, 400);
  }

  // User-scoped client: identifies the caller from their own JWT, and lets
  // us reuse the exact same is_department_officer() check the database
  // policies use, instead of re-deriving officer status here.
  const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const { data: isOfficer, error: officerCheckError } = await userClient.rpc('is_department_officer', {
    dept_id: departmentId,
  });
  if (officerCheckError) {
    return json({ error: `Officer check failed: ${officerCheckError.message}` }, 500);
  }
  if (!isOfficer) {
    return json({ error: 'Only officers can invite staff for this department' }, 403);
  }

  // Admin client: only from here on, and only holds the service_role key
  // as an Edge Function secret — never sent to or readable by the browser.
  const adminClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  const { data: existingProfile } = await adminClient
    .from('profiles')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();

  let invited = false;
  let targetUserId: string;

  if (existingProfile) {
    // Same person, another department — link without sending a second invite.
    targetUserId = existingProfile.user_id;
  } else {
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      return json({ error: 'GMAIL_USER / GMAIL_APP_PASSWORD not set' }, 500);
    }
    const { data: link, error: inviteError } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (inviteError) {
      return json({ error: `Invite failed: ${inviteError.message}` }, 500);
    }
    targetUserId = link.user.id;
    invited = true;

    // Their name (the form's, or the existing row's) and the department, for
    // the email. If it can't be sent, the new login is removed again, so
    // trying later starts afresh rather than finding a login nobody was told
    // about.
    const [{ data: dept }, { data: row }] = await Promise.all([
      adminClient.from('departments').select('name').eq('department_id', departmentId).maybeSingle(),
      staffId
        ? adminClient.from('staff').select('name').eq('staff_id', staffId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    try {
      await sendInvite(email, link.properties.action_link, name || row?.name, dept?.name);
    } catch (e) {
      await adminClient.auth.admin.deleteUser(targetUserId).catch(() => {});
      return json({ error: `Invite email failed: ${e.message ?? e}` }, 500);
    }

    const { error: profileError } = await adminClient
      .from('profiles')
      .upsert({ user_id: targetUserId, email });
    if (profileError) {
      return json({ error: `Profile link failed: ${profileError.message}` }, 500);
    }
  }

  if (staffId) {
    // Link an existing, previously-unlinked staff row rather than creating
    // a duplicate one — scoped to this department so a caller can't use a
    // staffId from a department they don't officer.
    const { data: linkedStaff, error: linkError } = await adminClient
      .from('staff')
      .update({ email, user_id: targetUserId })
      .eq('staff_id', staffId)
      .eq('department_id', departmentId)
      .select('staff_id')
      .single();

    if (linkError) {
      return json({ error: `Staff link failed: ${linkError.message}` }, 500);
    }
    if (!linkedStaff) {
      return json({ error: 'No matching unlinked staff row in this department' }, 404);
    }

    return json({ data: { staffId: linkedStaff.staff_id, invited } });
  }

  const { data: staffRow, error: staffError } = await adminClient
    .from('staff')
    .insert([{ department_id: departmentId, name, rank, email, user_id: targetUserId, role }])
    .select('staff_id')
    .single();

  if (staffError) {
    return json({ error: `Staff record failed: ${staffError.message}` }, 500);
  }

  await seedDefaultAvailability(adminClient, departmentId, staffRow.staff_id);

  return json({ data: { staffId: staffRow.staff_id, invited } });
});

// New staff default to available (rather than "unset", which the rest of
// the app treats as NOT available — see getStaffAvailabilityForDate/
// getAvailableShiftsForStaff in src/supabaseClient.js) for the 5 years
// following their creation — same rule and horizon as createStaff in
// src/supabaseClient.js (the client-side "Add Staff" / Excel-import path);
// this function is the equivalent for staff created via this invite flow.
// Sent in ~1-year chunks rather than one ~1800-row upsert, matching the
// largest batch size the client-side path already uses.
async function seedDefaultAvailability(adminClient: ReturnType<typeof createClient>, departmentId: string, staffId: string) {
  const start = new Date();
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 5);

  const dates: string[] = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  for (let i = 0; i < dates.length; i += 365) {
    const chunk = dates.slice(i, i + 365);
    const { error } = await adminClient
      .from('staff_availability')
      .upsert(
        chunk.map((date) => ({ department_id: departmentId, staff_id: staffId, date, available: true })),
        { onConflict: 'staff_id,date' },
      );
    if (error) console.error('seedDefaultAvailability chunk failed:', error);
  }
}

// "Dear Sam," from "Dr Sam Smith"; "there" if there's no name.
function firstNameOf(name?: string) {
  const words = (name || '').split(' ').filter(Boolean).filter((w) => !/^(Dr|Mr|Mrs|Ms|Prof)\.?$/i.test(w));
  return words[0] || 'there';
}

let transporter;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function sendInvite(to: string, link: string, name?: string, departmentName?: string) {
  transporter ??= nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  const where = departmentName ? ` at ${departmentName}` : '';
  const intro = `You've been invited to Rstar, the roster app${where}. It shows your shifts, on call and leave, and lets you swap shifts, pick up extra ones and order your coffee from your phone.`;
  const signIn = `After that, sign in at ${ROSTER_APP_URL} using this email address as your username and the password you chose.`;
  const iphone = 'iPhone: open ' + ROSTER_APP_URL + ' in Safari (not Chrome or the Gmail browser), tap the Share button (the square with an arrow), then "Add to Home Screen" and "Add". Open Rstar from your Home Screen from then on: phone notifications only work from there.';
  const android = 'Android: open ' + ROSTER_APP_URL + ' in Chrome and tap "Install App" on the sign-in screen. If it isn\'t there, tap the ⋮ menu (top right), then "Install app" or "Add to Home screen".';
  const help = "If there are any issues, or anything you'd like changed or added to the app, please don't hesitate to get in touch at ruralroster@gmail.com.";
  const text = [
    `Dear ${firstNameOf(name)},`,
    '',
    intro,
    '',
    'Tap the link below to choose your password:',
    '',
    link,
    '',
    signIn,
    '',
    'To put Rstar on your phone like an app:',
    '',
    iphone,
    '',
    android,
    '',
    help,
    '',
    'Cheers,',
    'Rural Roster Team',
  ].join('\n');
  const html = [
    `<p>Dear ${escapeHtml(firstNameOf(name))},</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#1f6fb2;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Choose your password</a></p>`,
    `<p>${escapeHtml(signIn)}</p>`,
    '<p>To put Rstar on your phone like an app:</p>',
    `<p>${escapeHtml(iphone)}</p>`,
    `<p>${escapeHtml(android)}</p>`,
    `<p>${escapeHtml(help)}</p>`,
    '<p>Cheers,<br>Rural Roster Team</p>',
  ].join('\n');
  await transporter.sendMail({ from: `"Rstar" <${GMAIL_USER}>`, to, subject: "You're invited to Rstar", text, html });
}
