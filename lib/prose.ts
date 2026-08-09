/**
 * A deliberately tiny markdown subset, parsed into blocks a Svelte template can render.
 *
 * The output is structured data, not HTML — nothing here reaches `{@html}`, so model output
 * can never inject markup into the console. That matters more than fidelity: this text comes
 * from a third party and is rendered inside a privileged extension page.
 *
 * Handles what a narrator actually uses: headings, bullets, numbered items, paragraphs, and
 * **bold**. Everything else is left as literal text.
 */

export interface Span {
  text: string;
  bold: boolean;
  /** Set when this span names a seated participant, so the console can colour it. */
  agent?: string;
}

export type Block =
  | { kind: 'heading'; level: 2 | 3; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'list'; ordered: boolean; items: Span[][] };

const BOLD = /\*\*([^*]+)\*\*/g;
const ESCAPE_RX = /[.*+?^${}()|[\]\\]/g;

/**
 * Split out mentions of seated participants so each can be coloured by its channel.
 *
 * Rather than asking the narrator to mark up attributions — a format it would eventually
 * break — this recognises the names we already gave it. Longest first, so "Claude Opus 4.5"
 * wins over "Claude", and on word boundaries so possessives ("Kimi's") still match while
 * substrings inside other words do not.
 */
function splitAgents(text: string, bold: boolean, agents: string[]): Span[] {
  const named = agents.filter((a) => a.trim().length > 1).sort((a, b) => b.length - a.length);
  if (!named.length) return [{ text, bold }];

  // Explicit lookarounds rather than \b: a display name may legitimately end in a non-word
  // character ("GPT-5 (thinking)"), where \b would refuse to match at all.
  const alternation = named.map((a) => a.replace(ESCAPE_RX, '\\$&')).join('|');
  const rx = new RegExp(`(?<![A-Za-z0-9_])(${alternation})(?![A-Za-z0-9_])`, 'g');
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(rx)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold });
    out.push({ text: m[0], bold, agent: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold });
  return out.length ? out : [{ text, bold }];
}

export function parseSpans(line: string, agents: string[] = []): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of line.matchAll(BOLD)) {
    if (m.index > last) spans.push(...splitAgents(line.slice(last, m.index), false, agents));
    spans.push(...splitAgents(m[1]!, true, agents));
    last = m.index + m[0].length;
  }
  if (last < line.length) spans.push(...splitAgents(line.slice(last), false, agents));
  return spans.length ? spans : [{ text: line, bold: false }];
}

export function parseProse(text: string, agents: string[] = []): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ kind: 'paragraph', spans: parseSpans(paragraph.join(' '), agents) });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map((i) => parseSpans(i, agents)) });
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length === 2 ? 2 : 3,
        spans: parseSpans(heading[2]!, agents),
      });
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }

    // A continuation line inside a list item, rather than a new paragraph.
    if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushAll();
  return blocks;
}
