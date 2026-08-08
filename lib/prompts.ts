import type { RunConfig, Turn } from './types';

export const CONVERGED_RE = /CONVERGED:\s*(yes|no)\b\s*(?:[—-]\s*(.*))?/gi;

/**
 * "Reply inline" is load-bearing, not politeness. The spike caught Claude putting a 700-word
 * answer into an artifact and leaving a 278-character summary in the thread. A panel that
 * trades summaries instead of arguments looks like it's working and isn't.
 */
const INLINE_RULE =
  'Reply INLINE in this conversation as plain markdown. Do NOT create an artifact, canvas, ' +
  'document, or file — even for long or structured answers. If you would normally use one, ' +
  'write the content directly in your message instead.';

export function participantSeed(
  config: RunConfig,
  selfName: string,
  otherNames: string[],
): string {
  return [
    `You are "${selfName}", one of ${otherNames.length + 1} participants in a collaborative brainstorming panel.`,
    `The other participants are: ${otherNames.join(', ')}.`,
    '',
    `TOPIC: ${config.topic}`,
    '',
    'HOW THIS WORKS',
    'Each round, you will be shown what every other participant said in the previous round.',
    'You respond to all of them at once. This is collaborative refinement, not a debate to win —',
    'the goal is the best possible thinking on the topic, not victory.',
    '',
    'RULES',
    `- ${INLINE_RULE}`,
    `- Keep every response under ${config.wordBudget} words. Be concrete; skip preamble and pleasantries.`,
    '- Build explicitly on good ideas from others, crediting them by name.',
    '- Disagree explicitly and say why. Unexamined agreement is worth nothing here.',
    '- Do not repeat points already made unless you are adding something new to them.',
    '',
    'REQUIRED LAST LINE',
    'End every message with exactly this line and nothing after it:',
    'CONVERGED: yes|no — <one short reason>',
    'Say "yes" only when you genuinely have nothing further worth adding.',
    '',
    `ROUND 1: Give your initial thinking on the topic.`,
  ].join('\n');
}

export function participantRound(
  config: RunConfig,
  round: number,
  others: Turn[],
): string {
  const blocks = others
    .map((t) => `--- ${t.displayName} said ---\n${t.text.trim()}`)
    .join('\n\n');

  return [
    `ROUND ${round}. Here is what the other participants said in round ${round - 1}:`,
    '',
    blocks,
    '',
    'Now respond to all of them: what you agree with and why, what you would push back on,',
    'and what genuinely refines the idea. Add something new — do not summarise what was said.',
    `Under ${config.wordBudget} words. ${INLINE_RULE}`,
    'End with the CONVERGED line.',
  ].join('\n');
}

export function narratorSeed(config: RunConfig, participantNames: string[]): string {
  return [
    'You are the NARRATOR for a multi-model brainstorming panel. You are an observer.',
    'You never contribute ideas of your own and you never take a side.',
    '',
    `TOPIC: ${config.topic}`,
    `PARTICIPANTS: ${participantNames.join(', ')}`,
    '',
    'Each round I will paste every participant\'s response. You reply with ONLY a single fenced',
    'json code block — no prose before or after it, no artifact, no canvas:',
    '',
    '```json',
    '{',
    '  "keyPoints": [{ "agent": "<name>", "points": ["<short point>", "..."] }],',
    '  "agreements": ["<point the panel converged on>"],',
    '  "disagreements": ["<point still contested, and who is on which side>"],',
    '  "openQuestions": ["<what nobody has resolved>"],',
    '  "converged": false,',
    '  "rationale": "<one sentence on whether the panel has stopped making progress>"',
    '}',
    '```',
    '',
    'Set "converged" to true only when the participants are genuinely no longer refining the',
    'idea — repetition, mutual agreement, or purely cosmetic differences. Disagreement that is',
    'still producing new distinctions is NOT convergence.',
    '',
    'Acknowledge with the word READY and nothing else.',
  ].join('\n');
}

export function narratorRound(round: number, turns: Turn[]): string {
  const blocks = turns
    .map((t) => `--- ${t.displayName} ---\n${t.text.trim()}`)
    .join('\n\n');
  return [`ROUND ${round} RESPONSES:`, '', blocks, '', 'Reply with the json block only.'].join('\n');
}

/** Reads the participant's self-reported convergence footer. Null when absent/unparseable. */
export function parseConverged(text: string): boolean | null {
  const matches = Array.from(text.matchAll(CONVERGED_RE));
  const last = matches[matches.length - 1];
  if (!last?.[1]) return null;
  return last[1].toLowerCase() === 'yes';
}

/** Strips the footer so it doesn't clutter what the other models are shown. */
export function stripConverged(text: string): string {
  return text.replace(CONVERGED_RE, '').trimEnd();
}
