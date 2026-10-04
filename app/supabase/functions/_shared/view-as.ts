// Refuses Edge Function calls made from an admin "View as" session (read only).
// The PostgREST guard does not cover Edge Functions, so every function a signed-in user can call to change something,
// spend money or reach an outside service checks this first.
import { json, userClient } from './supabase.ts';
import { VIEW_ONLY_MESSAGE } from './view-as-core.ts';

/**
 * Returns a 403 response when the caller's session belongs to a view (active, ended or expired), otherwise null.
 * Fails closed: if the check itself errors (for example because the view has expired and the guard refuses the
 * request), the call is refused. Requests without an Authorization header are left to the function's own checks.
 */
export async function refuseViewAs(req: Request): Promise<Response | null> {
  if (!req.headers.get('Authorization')) return null;
  const { data, error } = await userClient(req).rpc('is_view_as_session');
  if (error || data === true) return json({ error: VIEW_ONLY_MESSAGE }, 403);
  return null;
}
