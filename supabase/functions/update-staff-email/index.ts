// Updates a staff member's email — and, critically, keeps it in sync across
// all three places it's stored: `staff.email` (what the app shows/uses to
// contact them), `profiles.email` (the mirror invite-staff checks to detect
// "already has an account"), and `auth.users.email` (what Supabase Auth
// actually checks at login). Editing `staff.email` alone (the old
// updateStaffEmail/update_my_email behaviour) let those drift apart —
// someone's login silently stopped matching what was shown as "their
// email" and every future login attempt failed with "Incorrect email or
// password", with no error at the point the email was edited.
//
// Runs server-side because changing another user's `auth.users.email`
// needs the service_role key, which must never reach the browser — same
// reasoning as invite-staff/generate-temp-password.
//
// Authorization: the caller must be either the staff member themselves
// (staff.user_id = auth.uid(), self-service edits from staffRosterView) or
// an officer of that staff row's department (officer edits from
// StaffProfilesTab/StaffAvailabilityTab) — department_id and user_id are
// both read off the staff row itself rather than trusted from the request,
// so a caller can't point this at a department they don't officer.
//
// Deploy: `supabase functions deploy update-staff-email`
// Required secret (shared with invite-staff/generate-temp-password):
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service role key>
// SUPABASE_URL is provided automatically to every Edge Function.
//
// Request body: { staffId, email }
// Response:     { data: { staffId, email } } | { error }

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

  let body: { staffId?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { staffId } = body;
  const email = body.email?.trim() || null;
  if (!staffId) {
    return json({ error: 'staffId is required' }, 400);
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

  // Admin client: only from here on, and only holds the service_role key
  // as an Edge Function secret — never sent to or readable by the browser.
  const adminClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  const { data: staffRow, error: staffError } = await adminClient
    .from('staff')
    .select('staff_id, department_id, user_id')
    .eq('staff_id', staffId)
    .single();

  if (staffError || !staffRow) {
    return json({ error: 'No matching staff row' }, 404);
  }

  const isSelf = staffRow.user_id === user.id;
  if (!isSelf) {
    const { data: isOfficer, error: officerCheckError } = await userClient.rpc('is_department_officer', {
      dept_id: staffRow.department_id,
    });
    if (officerCheckError) {
      return json({ error: `Officer check failed: ${officerCheckError.message}` }, 500);
    }
    if (!isOfficer) {
      return json({ error: 'Only officers can edit another staff member\'s email' }, 403);
    }
  }

  // The login email (auth.users) and its profiles.email mirror only make
  // sense as a non-empty, unique address — an account can't log in against
  // a blank email. So a cleared email just blanks the staff contact field;
  // only a non-empty email propagates to the login identity. This means
  // clearing it here does NOT unlink or disable the login itself.
  if (email && staffRow.user_id) {
    const { error: authEmailError } = await adminClient.auth.admin.updateUserById(staffRow.user_id, {
      email,
      email_confirm: true,
    });
    if (authEmailError) {
      return json({ error: `Failed to update login email: ${authEmailError.message}` }, 500);
    }

    const { error: profileError } = await adminClient
      .from('profiles')
      .update({ email })
      .eq('user_id', staffRow.user_id);
    if (profileError) {
      return json({ error: `Login email was updated but profile mirror failed: ${profileError.message}` }, 500);
    }
  }

  const { error: staffEmailError } = await adminClient
    .from('staff')
    .update({ email })
    .eq('staff_id', staffId);
  if (staffEmailError) {
    return json({ error: `Failed to update staff email: ${staffEmailError.message}` }, 500);
  }

  return json({ data: { staffId, email } });
});
