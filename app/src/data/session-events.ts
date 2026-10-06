/**
 * Tells the session store when the stored sign-in on this device ends without the app asking: signed out in another
 * tab, or the server refused to refresh the session. Kept apart from the Supabase source so it has no dependencies.
 */
const listeners = new Set<() => void>();

/** Be told when the signed-in session on this device ends. Returns an unsubscribe function. */
export function onSessionEnded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by a data source when its stored session has ended. */
export function emitSessionEnded(): void {
  listeners.forEach((listener) => listener());
}
