/** The three prompts of a tutor's handover note, joined into (and split from) the single note the pack stores. */
export const HANDOVER_PROMPTS = ['How {first} learns best', 'Where {first} is now', 'What should come next'] as const;

/** Splits a note written with the three prompts back into its parts; anything else goes in the first box. */
export function splitHandoverNote(note: string, first: string): [string, string, string] {
  const heads = HANDOVER_PROMPTS.map((p) => p.replace('{first}', first));
  const parts: [string, string, string] = ['', '', ''];
  const text = note.trim();
  if (!text) return parts;
  if (!text.startsWith(`${heads[0]}:`)) return [text, '', ''];
  let rest = text;
  for (let i = 0; i < 3; i++) {
    const head = `${heads[i]}:`;
    const at = rest.indexOf(head);
    if (at < 0) continue;
    const after = rest.slice(at + head.length);
    const nextAt = i < 2 ? after.indexOf(`\n\n${heads[i + 1]}:`) : -1;
    parts[i] = (nextAt >= 0 ? after.slice(0, nextAt) : after).trim();
    rest = nextAt >= 0 ? after.slice(nextAt) : '';
  }
  return parts;
}

/** Joins the three prompts into the single handover note the pack stores. */
export function joinHandoverNote(parts: [string, string, string], first: string): string {
  return HANDOVER_PROMPTS.map((p, i) => [p.replace('{first}', first), parts[i].trim()] as const)
    .filter(([, body]) => body)
    .map(([head, body]) => `${head}:\n${body}`)
    .join('\n\n');
}

