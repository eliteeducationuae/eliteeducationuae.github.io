// Closes an account: anonymises the records (keeping invoices, credit notes, payments and refunds for tax law), removes
// the person's files and deletes their login.
//   {}               the signed-in person closes their own account.
//   { requestId }    a signed-in admin carries out a recorded deletion request (pending or failed).
// Returns 200 { ok: true, requestId, summary: { role, familyAnonymised, studentsAnonymised, futureLessonsCancelled,
//   upcomingLessonsNeedingTutor, invoicesRetained, paymentsRetained, creditNotesRetained, refundsRetained, filesRemoved,
//   loginsRemoved } };
//   401 not signed in; 403 not an admin (with requestId); 404 no such request; 409 the only administrator, or a request
//   already dealt with; 500 when it could not be finished (the request is marked failed so the office can try again).
// The database work happens in perform_account_deletion (migration 20261108000000_launch.sql). No extra secrets.
import { adminClient, corsHeaders, json, userClient } from '../_shared/supabase.ts';
import { errorMessage, logFunctionError, withMonitoring } from '../_shared/monitoring.ts';
import { refuseViewAs } from '../_shared/view-as.ts';
import { GOOGLE_REVOKE_URL } from '../_shared/google-calendar.ts';

const NAME = 'delete-account';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILED = 'We could not finish closing this account. Nothing further is needed from you; our team has been notified and will complete it shortly.';
const LAST_ADMIN = 'You are the only administrator. Please appoint another administrator before deleting this account.';

type Db = ReturnType<typeof adminClient>;
type Summary = {
  role?: string;
  familyAnonymised?: boolean;
  studentsAnonymised?: number;
  futureLessonsCancelled?: number;
  upcomingLessonsNeedingTutor?: number;
  invoicesRetained?: number;
  paymentsRetained?: number;
  creditNotesRetained?: number;
  refundsRetained?: number;
  storagePaths?: string[];
  storageFolders?: string[];
  profileId?: string | null;
  linkedProfileIds?: string[];
};

function isLastAdmin(error: { message?: string; hint?: string } | null) {
  return !!error && (error.hint === 'last_admin' || /only administrator/i.test(error.message ?? ''));
}

/** 'classwork/students/x/a.pdf' → ['classwork', 'students/x/a.pdf']. */
function splitPath(p: string): [string, string] | null {
  const i = p.indexOf('/');
  if (i <= 0 || i === p.length - 1 || p.includes('..')) return null;
  return [p.slice(0, i), p.slice(i + 1)];
}

/** Every file below a folder (folders are listed up to three levels deep). */
async function listFolder(db: Db, bucket: string, folder: string, depth = 0): Promise<string[]> {
  const prefix = folder.replace(/\/+$/, '');
  const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  const files: string[] = [];
  for (const item of data) {
    const path = `${prefix}/${item.name}`;
    // Folders have no id in Supabase Storage listings.
    if (item.id === null && depth < 3) files.push(...(await listFolder(db, bucket, path, depth + 1)));
    else if (item.id !== null) files.push(path);
  }
  return files;
}

/** Removes the person's files. Best effort: failures are logged (without file names) and do not stop the deletion. */
async function removeFiles(db: Db, summary: Summary): Promise<number> {
  const byBucket = new Map<string, Set<string>>();
  const add = (bucket: string, path: string) => {
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Set());
    byBucket.get(bucket)!.add(path);
  };
  for (const p of summary.storagePaths ?? []) {
    const parts = splitPath(p);
    if (parts) add(parts[0], parts[1]);
  }
  for (const f of summary.storageFolders ?? []) {
    const parts = splitPath(f);
    if (!parts) continue;
    try {
      for (const path of await listFolder(db, parts[0], parts[1])) add(parts[0], path);
    } catch (e) {
      await logFunctionError(db, NAME, `Listing files to remove failed: ${errorMessage(e)}`, null);
    }
  }
  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    const list = [...paths];
    for (let i = 0; i < list.length; i += 100) {
      const batch = list.slice(i, i + 100);
      try {
        const { data, error } = await db.storage.from(bucket).remove(batch);
        if (error) await logFunctionError(db, NAME, `Removing ${batch.length} file(s) from ${bucket} failed: ${error.message}`, null);
        else removed += data?.length ?? 0;
      } catch (e) {
        await logFunctionError(db, NAME, `Removing files from ${bucket} failed: ${errorMessage(e)}`, null);
      }
    }
  }
  return removed;
}

/**
 * The Google Calendar tokens of the logins a deletion request covers (the person, or every login of a tutor). Read
 * before perform_account_deletion deletes the rows, so the access can be withdrawn at Google once the deletion is done.
 */
async function googleTokensFor(db: Db, requestId: string): Promise<string[]> {
  try {
    const { data: request } = await db.from('deletion_requests').select('profile_id, tutor_id').eq('id', requestId).maybeSingle();
    const ids = new Set<string>();
    if (request?.profile_id) ids.add(request.profile_id as string);
    if (request?.tutor_id) {
      const { data: tutorLogins } = await db.from('profiles').select('id').eq('tutor_id', request.tutor_id);
      for (const p of tutorLogins ?? []) ids.add(p.id as string);
    }
    if (!ids.size) return [];
    const { data } = await db.from('calendar_connections').select('refresh_token, access_token').in('profile_id', [...ids]);
    return (data ?? []).map((c) => (c.refresh_token as string | null) ?? (c.access_token as string | null)).filter((t): t is string => !!t);
  } catch {
    return [];
  }
}

/** Withdraws this app's access at Google. Best effort: the tokens are already deleted from the database either way. */
async function revokeGoogle(db: Db, tokens: string[]) {
  for (const token of tokens) {
    try {
      const res = await fetch(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
      await res.body?.cancel();
    } catch {
      await logFunctionError(db, NAME, 'Withdrawing Google Calendar access failed (network)', null);
    }
  }
}

async function fail(db: Db, requestId: string, message: string) {
  await db.rpc('fail_account_deletion', { p_request_id: requestId, p_error: message });
  await logFunctionError(db, NAME, message, 500, { requestId });
}

Deno.serve(withMonitoring(NAME, adminClient, async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Please use POST.' }, 405);

  const { data: auth } = await userClient(req).auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return json({ error: 'Please sign in again to close this account.' }, 401);
  // The work below runs with the service role, so the database's View as guard would not see it: refuse here.
  const refused = await refuseViewAs(req);
  if (refused) return refused;
  const body = await req.json().catch(() => ({}));
  const db = adminClient();
  const { data: me } = await db.from('profiles').select('id, role').eq('id', uid).maybeSingle();

  let requestId: string;
  if (body && typeof body === 'object' && 'requestId' in body) {
    if (me?.role !== 'admin') return json({ error: 'Only an administrator can carry out a deletion request.' }, 403);
    if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) {
      return json({ error: 'That deletion request could not be found.' }, 404);
    }
    const { data: request } = await db.from('deletion_requests').select('id, status').eq('id', body.requestId).maybeSingle();
    if (!request) return json({ error: 'That deletion request could not be found.' }, 404);
    if (request.status !== 'pending' && request.status !== 'failed') {
      return json({ error: 'This deletion request has already been dealt with.' }, 409);
    }
    requestId = request.id;
  } else if (!me) {
    // A login that was never linked to a profile holds no records: remove the login itself.
    const { error } = await db.auth.admin.deleteUser(uid);
    if (error) throw new Error(`Deleting an unlinked login failed: ${error.message}`);
    return json({
      ok: true,
      requestId: null,
      summary: { role: null, familyAnonymised: false, studentsAnonymised: 0, futureLessonsCancelled: 0,
        upcomingLessonsNeedingTutor: 0, invoicesRetained: 0, paymentsRetained: 0, filesRemoved: 0, loginsRemoved: 1 },
    });
  } else {
    const { data, error } = await db.rpc('begin_account_deletion', { p_profile_id: uid, p_requested_by: uid });
    if (isLastAdmin(error)) return json({ error: LAST_ADMIN }, 409);
    if (error || !data) throw new Error(`begin_account_deletion failed: ${error?.message ?? 'no request'}`);
    requestId = data as string;
  }

  const googleTokens = await googleTokensFor(db, requestId);
  const { data: performed, error: performError } = await db.rpc('perform_account_deletion', { p_request_id: requestId, p_actor: uid });
  if (isLastAdmin(performError)) {
    await fail(db, requestId, LAST_ADMIN);
    return json({ error: LAST_ADMIN }, 409);
  }
  if (performError || !performed) {
    await fail(db, requestId, `perform_account_deletion failed: ${performError?.message ?? 'no summary'}`);
    return json({ error: FAILED }, 500);
  }
  const summary = performed as Summary;

  const filesRemoved = await removeFiles(db, summary);
  await revokeGoogle(db, googleTokens);

  // Deleting the auth user removes the profile too (profiles cascade). The request itself stays, without personal details.
  const logins = [summary.profileId, ...(summary.linkedProfileIds ?? [])].filter((id): id is string => !!id);
  let loginsRemoved = 0;
  const problems: string[] = [];
  for (const id of new Set(logins)) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (!error || /not.?found/i.test(error.message)) loginsRemoved++;
    else problems.push(error.message);
  }
  if (problems.length) {
    await fail(db, requestId, `${problems.length} login(s) could not be removed: ${problems[0]}`);
    return json({ error: FAILED }, 500);
  }

  return json({
    ok: true,
    requestId,
    summary: {
      role: summary.role ?? null,
      familyAnonymised: !!summary.familyAnonymised,
      studentsAnonymised: summary.studentsAnonymised ?? 0,
      futureLessonsCancelled: summary.futureLessonsCancelled ?? 0,
      upcomingLessonsNeedingTutor: summary.upcomingLessonsNeedingTutor ?? 0,
      invoicesRetained: summary.invoicesRetained ?? 0,
      paymentsRetained: summary.paymentsRetained ?? 0,
      creditNotesRetained: summary.creditNotesRetained ?? 0,
      refundsRetained: summary.refundsRetained ?? 0,
      filesRemoved,
      loginsRemoved,
    },
  });
}));
