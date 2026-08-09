import { describe, expect, it } from 'vitest';
import { parseProse, parseSpans } from '../../lib/prose';

describe('parseSpans', () => {
  it('splits bold from plain text', () => {
    expect(parseSpans('a **b** c')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c', bold: false },
    ]);
  });

  it('leaves unmatched asterisks as literal text', () => {
    expect(parseSpans('2 ** 3 is not bold')).toEqual([{ text: '2 ** 3 is not bold', bold: false }]);
  });

  it('never emits markup — output is data, not HTML', () => {
    // The console is a privileged extension page and this text comes from a model, so the
    // parser must not be a route to injecting markup.
    const spans = parseSpans('<img src=x onerror=alert(1)> **bold**');
    expect(spans[0]!.text).toContain('<img');
    expect(spans[0]!.bold).toBe(false);
    expect(spans[1]).toEqual({ text: 'bold', bold: true });
  });
});

describe('agent attribution', () => {
  const agents = ['Claude', 'Kimi', 'Claude Opus 4.5'];

  it('marks participant mentions so the console can colour them', () => {
    const spans = parseSpans('Kimi showed the flaw.', agents);
    expect(spans[0]).toEqual({ text: 'Kimi', bold: false, agent: 'Kimi' });
    expect(spans[1]!.agent).toBeUndefined();
  });

  it('prefers the longest matching name', () => {
    // Otherwise "Claude Opus 4.5" would be attributed to a different seat named "Claude".
    const spans = parseSpans('Claude Opus 4.5 disagreed', agents);
    expect(spans[0]!.agent).toBe('Claude Opus 4.5');
  });

  it('matches possessives but not substrings inside other words', () => {
    expect(parseSpans("Kimi's point", agents)[0]!.agent).toBe('Kimi');
    expect(parseSpans('Kimiko said so', agents).every((s) => !s.agent)).toBe(true);
  });

  it('keeps attribution inside bold text', () => {
    const spans = parseSpans('**Kimi** was right', agents);
    expect(spans[0]).toEqual({ text: 'Kimi', bold: true, agent: 'Kimi' });
  });

  it('is inert when no agents are supplied', () => {
    expect(parseSpans('Kimi showed the flaw.').every((s) => !s.agent)).toBe(true);
  });

  it('does not break on names containing regex characters', () => {
    const spans = parseSpans('GPT-5 (thinking) replied', ['GPT-5 (thinking)']);
    expect(spans[0]!.agent).toBe('GPT-5 (thinking)');
  });
});

describe('parseProse', () => {
  it('reads headings, paragraphs and both list kinds', () => {
    const blocks = parseProse(
      ['## The question', '', 'It is hard.', '', '- one', '- two', '', '1. first', '2. second'].join('\n'),
    );

    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list']);
    expect(blocks[2]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[3]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('joins wrapped lines into one paragraph', () => {
    const blocks = parseProse('a line\nand its continuation\n\nsecond para');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      kind: 'paragraph',
      spans: [{ text: 'a line and its continuation', bold: false }],
    });
  });

  it('folds an indented continuation into the list item above it', () => {
    const blocks = parseProse('- first point\n  continued here\n- second point');
    expect(blocks).toHaveLength(1);
    const list = blocks[0] as { items: Array<Array<{ text: string }>> };
    expect(list.items[0]![0]!.text).toBe('first point continued here');
    expect(list.items).toHaveLength(2);
  });

  it('starts a new list when the kind changes', () => {
    const blocks = parseProse('- bullet\n1. numbered');
    expect(blocks).toHaveLength(2);
  });

  it('returns nothing for empty input rather than an empty paragraph', () => {
    expect(parseProse('')).toEqual([]);
    expect(parseProse('\n\n  \n')).toEqual([]);
  });
});
