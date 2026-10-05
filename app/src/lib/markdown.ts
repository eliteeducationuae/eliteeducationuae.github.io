/**
 * A deliberately small Markdown parser for the tutor handbook: headings (#, ##, ###), bullets (- or *),
 * numbered items (1.), paragraphs separated by blank lines, and inline **bold**. Pure and dependency-free.
 */

export interface Segment {
  text: string;
  bold: boolean;
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; segments: Segment[] }
  | { kind: 'paragraph'; segments: Segment[] }
  | { kind: 'bullets'; items: Segment[][] }
  | { kind: 'numbered'; items: Segment[][]; start: number };

/** Splits text on `**bold**` markers. An unmatched `**` is kept as literal text. */
export function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  let rest = text;
  while (rest.length) {
    const open = rest.indexOf('**');
    const close = open >= 0 ? rest.indexOf('**', open + 2) : -1;
    if (open < 0 || close < 0) {
      segments.push({ text: rest, bold: false });
      break;
    }
    if (open > 0) segments.push({ text: rest.slice(0, open), bold: false });
    const inner = rest.slice(open + 2, close);
    if (inner) segments.push({ text: inner, bold: true });
    rest = rest.slice(close + 2);
  }
  // Merge neighbours with the same weight so renderers get the fewest pieces.
  return segments.reduce<Segment[]>((out, s) => {
    const last = out[out.length - 1];
    if (last && last.bold === s.bold) last.text += s.text;
    else out.push({ ...s });
    return out;
  }, []);
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^(\d+)[.)]\s+(.*)$/;

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', segments: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, segments: parseInline(heading[2].trim()) });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'bullets') last.items.push(parseInline(bullet[1]));
      else blocks.push({ kind: 'bullets', items: [parseInline(bullet[1])] });
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'numbered') last.items.push(parseInline(numbered[2]));
      else blocks.push({ kind: 'numbered', items: [parseInline(numbered[2])], start: Number(numbered[1]) });
      continue;
    }
    // A wrapped line directly after a list item continues that item.
    const last = blocks[blocks.length - 1];
    if (!paragraph.length && raw.startsWith(' ') && (last?.kind === 'bullets' || last?.kind === 'numbered')) {
      const item = last.items[last.items.length - 1];
      last.items[last.items.length - 1] = parseInline(`${item.map((s) => (s.bold ? `**${s.text}**` : s.text)).join('')} ${line}`);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** Plain text of a block's segments, e.g. for accessibility labels and tests. */
export function plainText(segments: Segment[]): string {
  return segments.map((s) => s.text).join('');
}
