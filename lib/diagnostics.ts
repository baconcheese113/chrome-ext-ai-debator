import { deepQueryAll, isVisible, readText, sketch } from './dom';
import type { Diagnostics, ElementSketch } from './types';

/**
 * The single most important function in the spike.
 *
 * Selectors written from memory WILL be wrong for at least one provider. Without this, a
 * wrong guess produces "fail: composer not found" and we learn nothing. With this, a wrong
 * guess produces a list of pasteable candidate selectors — so one round-trip against live
 * sessions is productive even when every guess misses.
 */
export function collectDiagnostics(note: string): Diagnostics {
  return {
    url: location.href,
    title: document.title,
    candidateComposers: composerCandidates(),
    candidateButtons: buttonCandidates(),
    candidateResponseContainers: responseCandidates(),
    conversationHtml: captureConversationHtml(),
    composerHtml: captureComposerHtml(),
    note,
  };
}

/** Cap on the composer capture. The block around a text box is small; this is generous. */
const COMPOSER_BUDGET = 40_000;

/**
 * The composer and everything sitting with it.
 *
 * Sketching buttons has now failed three times to reveal a send control: on ChatGPT the
 * sidebar's history menus filled the list before the composer was reached, and on Kimi the
 * send control is not a <button> or a [role="button"] at all, so it was never a candidate.
 * Markup does not have that problem. It also carries no conversation text.
 */
function captureComposerHtml(): string | undefined {
  const region = composerRegions()[0];
  if (!region) return undefined;
  const html = (region as HTMLElement).outerHTML ?? '';
  return html.length > COMPOSER_BUDGET
    ? `${html.slice(0, COMPOSER_BUDGET)}\n<!-- truncated at ${COMPOSER_BUDGET} chars -->`
    : html;
}

/** Cap on captured markup. Enough to rebuild selectors from; small enough to paste. */
const HTML_BUDGET = 120_000;

/**
 * Markup of the region that holds the conversation, so a broken provider page can become a
 * permanent test fixture instead of a one-off debugging session. Without this, fixing an
 * adapter costs a round-trip through the user every time a provider redesigns.
 *
 * Attribute values are kept, but text content is not scrubbed — the caller is pasting their
 * own conversation, and they should know that.
 */
function captureConversationHtml(): string | undefined {
  const root =
    document.querySelector('main') ??
    document.querySelector('[role="main"]') ??
    document.body;
  if (!root) return undefined;
  const html = (root as HTMLElement).outerHTML ?? '';
  if (html.length <= HTML_BUDGET) return html;

  // Keep both ends. Taking the first N characters kept only the OLDEST turns and cut the
  // newest — and the newest turn is the one every extraction question is about. The head
  // still shows the container structure the selectors have to match.
  const head = Math.floor(HTML_BUDGET / 3);
  const tail = HTML_BUDGET - head;
  return [
    html.slice(0, head),
    `\n<!-- ${html.length - HTML_BUDGET} chars omitted from the middle -->\n`,
    html.slice(-tail),
  ].join('');
}

function composerCandidates(): ElementSketch[] {
  const els = [
    ...deepQueryAll('textarea'),
    ...deepQueryAll('[contenteditable="true"]'),
    ...deepQueryAll('[role="textbox"]'),
  ];
  return dedupe(els)
    .filter(isVisible)
    .map(sketch)
    .slice(0, 15);
}

/** Words that name the two controls we actually drive, in any provider's vocabulary. */
const CONTROL_WORDS = /\b(send|stop|submit|cancel|halt)\b/i;

/**
 * The block of page around the composer, so buttons that live with it can be recognised.
 *
 * Chat pages put the composer last in the DOM and a conversation sidebar first. A capture
 * that takes the first N buttons therefore returns N history-item menus and drops the two
 * controls that matter — which is exactly what a real ChatGPT capture did, and why Kimi's
 * send button has stayed invisible to us across several rounds of debugging.
 */
/** Anything that could plausibly be a send or stop control, however it is built. */
const CONTROLISH =
  'button, [role="button"], svg, [class*="btn" i], [class*="send" i], [class*="stop" i], [class*="submit" i]';
/**
 * Text length that says we have climbed out of the composer and into the conversation.
 *
 * A fixed number of levels does not work. Kimi's composer sits six levels below a container
 * holding the entire thread, so climbing blind rooted the capture at 40,000 characters of
 * conversation and truncated before ever reaching the send control — the exact thing the
 * capture existed to show.
 */
const REGION_TEXT_LIMIT = 3000;

function composerRegions(): Element[] {
  const composers = dedupe([
    ...deepQueryAll('textarea'),
    ...deepQueryAll('[contenteditable="true"]'),
    ...deepQueryAll('[role="textbox"]'),
  ]).filter(isVisible);

  return dedupe(composers.map(regionFor));
}

/** The smallest block containing the composer and the controls that sit beside it. */
function regionFor(composer: Element): Element {
  const small = (el: Element) => (el.textContent?.length ?? 0) <= REGION_TEXT_LIMIT;

  // Providers that use a form have already drawn this boundary for us.
  const form = composer.closest?.('form');
  if (form && small(form)) return form;

  let node: Element = composer;
  let sawControl = false;

  for (let depth = 0; depth < 8; depth++) {
    const parent = node.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) break;
    if (!small(parent)) break;
    node = parent;

    // Controls inside the composer itself don't count — an icon in the text box is not a
    // send button, and stopping on one would leave the real control outside the capture.
    const controls = Array.from(node.querySelectorAll(CONTROLISH)).filter(
      (e) => e !== composer && !composer.contains(e),
    );
    if (controls.length) {
      // One more level of margin: a send control is sometimes a sibling of the toolbar row
      // rather than inside it, and a level here is cheap.
      if (sawControl) break;
      sawControl = true;
    }
  }
  return node;
}

function buttonCandidates(): ElementSketch[] {
  const regions = composerRegions();
  const els = dedupe([...deepQueryAll('button'), ...deepQueryAll('[role="button"]')])
    .filter(isVisible)
    // Buttons with no label of any kind are almost never the send/stop control.
    .filter((e) => {
      const label = `${e.getAttribute("aria-label") ?? ""} ${e.getAttribute("data-testid") ?? ""} ${readText(e as HTMLElement)}`;
      return label.trim().length > 0;
    });

  const score = (e: Element): number => {
    const label = `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('data-testid') ?? ''} ${e.getAttribute('title') ?? ''}`;
    return (
      (regions.some((r) => r.contains(e)) ? 100 : 0) + (CONTROL_WORDS.test(label) ? 50 : 0)
    );
  };

  return els
    .map((e) => ({ e, s: score(e) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => sketch(x.e))
    .slice(0, 30);
}

/**
 * Guess at which containers hold conversation turns, without knowing the provider. Looks for
 * repeated sibling structures containing substantial text — the shape every chat log has.
 */
function responseCandidates(): ElementSketch[] {
  const scored: Array<{ el: Element; score: number }> = [];
  const all = deepQueryAll('div, article, section, li, message-content, model-response');
  for (const el of all) {
    if (!isVisible(el)) continue;
    const text = readText(el as HTMLElement);
    if (text.length < 80) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    // Siblings sharing this element's tag+class signature => it's one of a repeated series.
    const sig = `${el.tagName}.${Array.from(el.classList).slice(0, 3).join('.')}`;
    const siblings = Array.from(parent.children).filter(
      (c) => `${c.tagName}.${Array.from(c.classList).slice(0, 3).join('.')}` === sig,
    ).length;
    if (siblings < 2) continue;
    // Prefer tight containers: lots of text, not much DOM under them.
    const density = text.length / Math.max(1, el.querySelectorAll('*').length);
    scored.push({ el, score: siblings * 10 + density });
  }
  scored.sort((a, b) => b.score - a.score);
  return dedupe(scored.map((s) => s.el)).map(sketch).slice(0, 12);
}

function dedupe(els: Element[]): Element[] {
  return Array.from(new Set(els));
}
