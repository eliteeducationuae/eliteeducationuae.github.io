import { DEFAULT_HANDBOOK_BODY } from '@/domain/handbook';

import { parseInline, parseMarkdown, plainText } from '../markdown';

describe('parseInline', () => {
  it('returns plain text as one segment', () => {
    expect(parseInline('Hello there')).toEqual([{ text: 'Hello there', bold: false }]);
  });

  it('splits bold segments', () => {
    expect(parseInline('Be **on time** and **prepared**.')).toEqual([
      { text: 'Be ', bold: false },
      { text: 'on time', bold: true },
      { text: ' and ', bold: false },
      { text: 'prepared', bold: true },
      { text: '.', bold: false },
    ]);
  });

  it('keeps an unmatched marker as literal text', () => {
    expect(parseInline('2 ** 3')).toEqual([{ text: '2 ** 3', bold: false }]);
  });

  it('drops empty bold markers', () => {
    expect(parseInline('a****b')).toEqual([{ text: 'ab', bold: false }]);
  });
});

describe('parseMarkdown', () => {
  it('parses headings of three levels', () => {
    const blocks = parseMarkdown('# One\n## Two\n### Three');
    expect(blocks.map((b) => (b.kind === 'heading' ? b.level : 0))).toEqual([1, 2, 3]);
    expect(blocks[1].kind === 'heading' && plainText(blocks[1].segments)).toBe('Two');
  });

  it('treats four hashes as a paragraph', () => {
    expect(parseMarkdown('#### Not a heading')[0].kind).toBe('paragraph');
  });

  it('joins paragraph lines and splits on blank lines', () => {
    const blocks = parseMarkdown('First line\nsecond line\n\nNext paragraph');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind === 'paragraph' && plainText(blocks[0].segments)).toBe('First line second line');
  });

  it('groups bullets written with - or *', () => {
    const blocks = parseMarkdown('- one\n* two\n- **three**');
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.kind).toBe('bullets');
    if (b.kind === 'bullets') {
      expect(b.items.map(plainText)).toEqual(['one', 'two', 'three']);
      expect(b.items[2][0].bold).toBe(true);
    }
  });

  it('groups numbered items and keeps the first number', () => {
    const blocks = parseMarkdown('3. three\n4. four');
    expect(blocks[0]).toMatchObject({ kind: 'numbered', start: 3 });
    expect(blocks[0].kind === 'numbered' && blocks[0].items.map(plainText)).toEqual(['three', 'four']);
  });

  it('separates a paragraph from a following list', () => {
    const blocks = parseMarkdown('Intro text\n- item');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'bullets']);
  });

  it('continues an indented wrapped line onto the previous list item', () => {
    const blocks = parseMarkdown('- first part\n  second part\n- next');
    expect(blocks[0].kind === 'bullets' && blocks[0].items.map(plainText)).toEqual(['first part second part', 'next']);
  });

  it('handles Windows line endings and empty input', () => {
    expect(parseMarkdown('# A\r\n\r\nB')).toHaveLength(2);
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n  \n')).toEqual([]);
  });

  it('parses the default handbook', () => {
    const blocks = parseMarkdown(DEFAULT_HANDBOOK_BODY);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks.filter((b) => b.kind === 'heading' && b.level === 2).length).toBeGreaterThanOrEqual(3);
    expect(blocks.some((b) => b.kind === 'bullets')).toBe(true);
    const last = blocks[blocks.length - 1];
    expect(last.kind === 'paragraph' && last.segments[0]).toEqual({ text: 'Excellence. Discretion. Results.', bold: true });
  });
});
