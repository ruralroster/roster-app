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
// Required secret (never committed, set via the Supabase CLI or dashboard):
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service role key>
// SUPABASE_URL is provided automatically to every Edge Function.
//
// Request body: { departmentId, name, email, rank, role, redirectTo, staffId? }
// Response:     { data: { staffId, invited } } | { error }

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
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
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    );
    if (inviteError) {
      return json({ error: `Invite failed: ${inviteError.message}` }, 500);
    }
    targetUserId = inviteData.user.id;
    invited = true;

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

  return json({ data: { staffId: staffRow.staff_id, invited } });
});
