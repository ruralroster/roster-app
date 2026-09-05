// Sets a random temporary password on a staff member's account and flags
// it so they're forced through the SetPassword screen on next login — a
// fallback for when the normal invite/reinvite email (sent via Supabase
// Auth) gets spam-filtered. The officer relays the returned password to
// the person out-of-band (WhatsApp, SMS, in person).
//
// Works two ways depending on whether the staff row is already linked
// (has `user_id`):
//  - Already linked: just resets the password on the existing account.
//  - Not yet linked: an `email` must be supplied in the request body. If
//    that email already has a profile (same person, another department),
//    the account is linked without creating a duplicate; otherwise a new
//    auth user is created directly (unlike invite-staff, this does NOT
//    send a Supabase invite email — the whole point is to hand the officer
//    a password to relay manually instead).
//
// Runs server-side because setting another user's password (or creating
// one) needs the service_role key, which must never reach the browser —
// same reasoning as invite-staff.
//
// Deploy: `supabase functions deploy generate-temp-password`
// Required secret (shared with invite-staff, set once):
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service role key>
// SUPABASE_URL is provided automatically to every Edge Function.
//
// Request body: { departmentId, staffId, email? }  (email required only if not yet linked)
// Response:     { data: { tempPassword, name } } | { error }

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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

// Excludes visually-ambiguous characters (0/O, 1/l/I) since this gets
// retyped by hand off a phone screen after being relayed over WhatsApp/SMS.
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 10;

function generateTempPassword(): string {
  const bytes = new Uint8Array(TEMP_PASSWORD_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => TEMP_PASSWORD_CHARS[b % TEMP_PASSWORD_CHARS.length]).join('');
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

  let body: { departmentId?: string; staffId?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { departmentId, staffId, email } = body;
  if (!departmentId || !staffId) {
    return json({ error: 'departmentId and staffId are required' }, 400);
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
    return json({ error: 'Only officers can reset a staff member\'s password for this department' }, 403);
  }

  // Admin client: only from here on, and only holds the service_role key
  // as an Edge Function secret — never sent to or readable by the browser.
  const adminClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  const { data: staffRow, error: staffError } = await adminClient
    .from('staff')
    .select('staff_id, user_id, name')
    .eq('staff_id', staffId)
    .eq('department_id', departmentId)
    .single();

  if (staffError || !staffRow) {
    return json({ error: 'No matching staff row in this department' }, 404);
  }

  let targetUserId = staffRow.user_id;

  if (!targetUserId) {
    const trimmedEmail = email?.trim();
    if (!trimmedEmail) {
      return json({ error: 'This staff member has no linked account yet — an email address is required' }, 400);
    }

    // Same person, another department — link without creating a second
    // auth user (mirrors invite-staff's existing-profile check).
    const { data: existingProfile, error: profileLookupError } = await adminClient
      .from('profiles')
      .select('user_id')
      .eq('email', trimmedEmail)
      .maybeSingle();
    if (profileLookupError) {
      return json({ error: `Profile lookup failed: ${profileLookupError.message}` }, 500);
    }

    if (existingProfile) {
      targetUserId = existingProfile.user_id;
    } else {
      // Deliberately createUser rather than inviteUserByEmail — this path
      // exists precisely to avoid depending on the invite email arriving,
      // so no email is sent here at all; the temp password below is the
      // only thing the officer relays, out-of-band.
      const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
        email: trimmedEmail,
        email_confirm: true,
      });
      if (createError) {
        return json({ error: `Account creation failed: ${createError.message}` }, 500);
      }
      targetUserId = createData.user.id;

      const { error: profileError } = await adminClient
        .from('profiles')
        .upsert({ user_id: targetUserId, email: trimmedEmail });
      if (profileError) {
        return json({ error: `Profile link failed: ${profileError.message}` }, 500);
      }
    }

    const { error: linkError } = await adminClient
      .from('staff')
      .update({ email: trimmedEmail, user_id: targetUserId })
      .eq('staff_id', staffId)
      .eq('department_id', departmentId);
    if (linkError) {
      return json({ error: `Staff link failed: ${linkError.message}` }, 500);
    }
  }

  const tempPassword = generateTempPassword();

  const { error: pwError } = await adminClient.auth.admin.updateUserById(targetUserId, {
    password: tempPassword,
  });
  if (pwError) {
    return json({ error: `Failed to set temporary password: ${pwError.message}` }, 500);
  }

  const { error: flagError } = await adminClient
    .from('profiles')
    .update({ must_reset_password: true })
    .eq('user_id', targetUserId);
  if (flagError) {
    return json({ error: `Password was set but failed to flag for reset: ${flagError.message}` }, 500);
  }

  return json({ data: { tempPassword, name: staffRow.name } });
});
