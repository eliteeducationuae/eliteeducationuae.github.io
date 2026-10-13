/**
 * A one-shot, in-memory draft for the next conversation composer to open (e.g. a parent's "Ask about this invoice").
 * Drafts never travel in the URL, so a crafted link cannot put words in anyone's composer. The draft is taken once:
 * by the conversation that mounts next, or by the one already on screen. Nothing is sent until Send is pressed.
 */
let slot: { text: string; familyId?: string } | null = null;
const listeners = new Set<() => void>();

/** Leave a draft for the next conversation (for one family only, when `familyId` is given). */
export function offerDraft(text: string, familyId?: string): void {
  slot = { text, familyId };
  for (const l of [...listeners]) l();
}

/** Take the waiting draft for this family's conversation, if any. It is cleared once taken. */
export function takeDraft(familyId: string): string | undefined {
  if (!slot || (slot.familyId && slot.familyId !== familyId)) return undefined;
  const { text } = slot;
  slot = null;
  return text;
}

/** Be told when a draft is offered (for a conversation that is already open). */
export function onDraftOffered(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
