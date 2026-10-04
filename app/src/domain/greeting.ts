export type Greeting = 'Good morning' | 'Good afternoon' | 'Good evening';

/** Before 12:00 is morning, 12:00 to 17:59 is afternoon, and 18:00 onwards is evening. */
export function greeting(date: Date): Greeting {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** e.g. `Good afternoon, Craig`. Without a name, just the greeting. */
export function greetingLine(date: Date, name?: string): string {
  const who = name?.trim();
  return who ? `${greeting(date)}, ${who}` : greeting(date);
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** Counts in words for prose, as the house style prefers: `three lessons`, `one item`, `no lessons`, `12 lessons`. */
export function countWords(n: number, word: string, many = `${word}s`): string {
  const num = n >= 0 && n < WORDS.length && Number.isInteger(n) ? WORDS[n] : String(n);
  return `${num} ${n === 1 ? word : many}`;
}

/** The admin dashboard's one-line summary of the day. */
export function adminSummary(lessonsToday: number, attention: number): string {
  const lessons = `You have ${countWords(lessonsToday, 'lesson')} today`;
  if (!attention) return `${lessons}, and nothing needs your attention.`;
  return `${lessons} and ${countWords(attention, 'item')} that ${attention === 1 ? 'needs' : 'need'} your attention.`;
}

/** Names joined for prose: `Aisha`, `Aisha and Omar`, `Aisha, Omar and Layla`. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
