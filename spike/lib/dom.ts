import type { ElementSketch } from './types';

export function isVisible(el: Element): boolean {
  const he = el as HTMLElement;
  if (!he.isConnected) return false;
  const rect = he.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(he);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

/**
 * Query across open shadow roots as well as the light DOM. Gemini in particular puts real
 * controls inside shadow roots, and a plain querySelectorAll silently misses them — which
 * would make E1 report a false "config can't express this".
 */
export function deepQueryAll(selector: string, root: ParentNode = document): Element[] {
  const out: Element[] = [];
  try {
    out.push(...Array.from(root.querySelectorAll(selector)));
  } catch {
    return out; // invalid selector — treat as no match rather than exploding
  }
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as Element | null;
  while (node) {
    const sr = (node as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
    if (sr) out.push(...deepQueryAll(selector, sr));
    node = walker.nextNode() as Element | null;
  }
  return out;
}

/** First visible match for the first selector that matches anything. Returns the winner too. */
export function firstVisible(
  selectors: string[],
): { el: HTMLElement; selector: string } | undefined {
  for (const selector of selectors) {
    const matches = deepQueryAll(selector).filter(isVisible);
    if (matches.length) {
      return { el: matches[matches.length - 1] as HTMLElement, selector };
    }
  }
  return undefined;
}

/** Last visible match across all selectors — used for "the newest assistant message". */
export function lastVisible(
  selectors: string[],
): { el: HTMLElement; selector: string } | undefined {
  for (const selector of selectors) {
    const matches = deepQueryAll(selector).filter(isVisible);
    if (matches.length) return { el: matches[matches.length - 1] as HTMLElement, selector };
  }
  return undefined;
}

export function anyVisible(selectors: string[] | undefined): string | null {
  if (!selectors) return null;
  for (const s of selectors) {
    if (deepQueryAll(s).some(isVisible)) return s;
  }
  return null;
}

export function anyEnabled(selectors: string[] | undefined): string | null {
  if (!selectors) return null;
  for (const s of selectors) {
    const hit = deepQueryAll(s).find(
      (e) => isVisible(e) && !(e as HTMLButtonElement).disabled && e.getAttribute('aria-disabled') !== 'true',
    );
    if (hit) return s;
  }
  return null;
}

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? '';
}

/**
 * Build a selector we could paste straight into a provider config. Preference order matches
 * what actually survives a redeploy: test ids and aria labels outlive hashed class names.
 */
export function suggestSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const testId = attr(el, 'data-testid');
  if (testId) return `${tag}[data-testid="${testId}"]`;
  const aria = attr(el, 'aria-label');
  if (aria) return `${tag}[aria-label="${aria}"]`;
  if (el.id && !/\d{3,}/.test(el.id)) return `${tag}#${el.id}`;
  const role = attr(el, 'role');
  if (role) return `${tag}[role="${role}"]`;
  const stable = Array.from(el.classList).filter(
    (c) => c.length < 30 && !/[_-]?[0-9a-f]{5,}/i.test(c) && !/^(css|sc)-/.test(c),
  );
  if (stable.length) return `${tag}.${stable.slice(0, 2).join('.')}`;
  return tag;
}

export function sketch(el: Element): ElementSketch {
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id ?? '',
    classes: Array.from(el.classList).slice(0, 8).join(' '),
    ariaLabel: attr(el, 'aria-label'),
    testId: attr(el, 'data-testid'),
    role: attr(el, 'role'),
    contentEditable: attr(el, 'contenteditable'),
    disabled: Boolean((el as HTMLButtonElement).disabled) || attr(el, 'aria-disabled') === 'true',
    visible: isVisible(el),
    textLength: (el as HTMLElement).innerText?.length ?? 0,
    suggestedSelector: suggestSelector(el),
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
