import type { ProbeRequest, ProviderId } from './types';

const SHORT_PROMPT = 'Reply with exactly one short sentence: what is 2+2?';

/**
 * Long enough to stream for a while and contain natural pauses (the thing that causes false
 * "done" fires), and structured enough to answer E3 — if code blocks, lists and tables don't
 * survive extraction, we'll see it here.
 */
const LONG_PROMPT = [
  'Write roughly 700 words comparing optimistic and pessimistic concurrency control.',
  'Include: a bulleted list of trade-offs, a markdown table of at least 3 rows,',
  'and one fenced code block showing a compare-and-swap loop.',
].join(' ');

export interface ExperimentPlan {
  name: string;
  prompt: string;
  runs: number;
  windowState: ProbeRequest['windowState'];
  purpose: string;
}

/**
 * E1 and E3 are not separate executions — they are observations made during E2's runs
 * (E1 = which selectors/overrides were needed, E3 = what extraction returned). Running them
 * as distinct passes would triple the rate-limit cost for no extra information.
 */
export const EXPERIMENTS: ExperimentPlan[] = [
  {
    name: 'E2-short',
    prompt: SHORT_PROMPT,
    runs: 3,
    windowState: 'focused',
    purpose: 'Baseline: does the pipeline work at all, and does detection fire correctly on a fast reply?',
  },
  {
    name: 'E2-long',
    prompt: LONG_PROMPT,
    runs: 3,
    windowState: 'focused',
    purpose: 'Detection reliability across a long stream with natural pauses. Also feeds E3 extraction fidelity.',
  },
  {
    name: 'E4-unfocused',
    prompt: LONG_PROMPT,
    runs: 2,
    windowState: 'unfocused',
    purpose: 'Does driving still work when the window is behind another window?',
  },
  {
    name: 'E4-minimized',
    prompt: LONG_PROMPT,
    runs: 2,
    windowState: 'minimized',
    purpose: 'The one most likely to fail. Decides whether the dedicated-window design is viable.',
  },
];

/** Pace between runs so we don't trip rate limits any harder than necessary. */
export const PACING_MS = 4000;
export const PACING_JITTER_MS = 2000;
