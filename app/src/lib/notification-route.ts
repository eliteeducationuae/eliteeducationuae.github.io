/**
 * The in-app route a push notification should open, from its `data.url` (set by send-notifications from
 * notification_outbox.url). Only app paths such as `/invoice/<id>` are accepted, optionally with simple query
 * parameters (`/manage/family-edit?id=<id>`, `/parent/progress?tab=homework`); anything else, including full web
 * addresses and protocol-relative `//host` links, is ignored so a notification can never send someone off the app.
 */
export function notificationRoute(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const url = (data as { url?: unknown }).url;
  if (typeof url !== 'string') return null;
  const path = url.trim();
  if (!/^\/(?!\/)[A-Za-z0-9\-_/]*(\?[A-Za-z0-9\-_]+=[A-Za-z0-9\-_.]*(&[A-Za-z0-9\-_]+=[A-Za-z0-9\-_.]*)*)?$/.test(path)) return null;
  return path;
}
