import { describe, expect, it } from 'vitest';
import { adapterForUrl } from '../../lib/adapters';
import {
  narratorSeed,
  parseConverged,
  participantRound,
  participantSeed,
  stripConverged,
} from '../../lib/prompts';
import type { RunConfig, Turn } from '../../lib/types';

const config: RunConfig = {
  topic: 'Best way to price a SaaS',
  maxRounds: 5,
  convergence: 'self-report',
  autoDrop: false,
  wordBudget: 400,
};

const turn = (name: string, text: string): Turn => ({
  round: 1,
  seatId: name,
  displayName: name,
  text,
  html: '',
  converged: false,
  via: 'message',
  wordCount: text.split(/\s+/).length,
  at: '2026-08-08T00:00:00Z',
});

describe('parseConverged', () => {
  it('reads yes and no', () => {
    expect(parseConverged('blah\nCONVERGED: yes — nothing left')).toBe(true);
    expect(parseConverged('blah\nCONVERGED: no — more to say')).toBe(false);
  });

  it('is case insensitive and tolerates a missing reason', () => {
    expect(parseConverged('converged: YES')).toBe(true);
  });

  it('returns null when the footer is absent', () => {
    expect(parseConverged('I have thoughts but no footer.')).toBeNull();
  });

  it('takes the LAST occurrence, so quoting another model does not flip the vote', () => {
    // A model quoting a peer's "CONVERGED: yes" must not be read as its own verdict.
    const text = 'Claude said CONVERGED: yes but I disagree.\nCONVERGED: no — still refining';
    expect(parseConverged(text)).toBe(false);
  });
});

describe('stripConverged', () => {
  it('removes the footer from what other models are shown', () => {
    expect(stripConverged('My point.\nCONVERGED: no — more to say')).toBe('My point.');
  });

  it('leaves text without a footer alone', () => {
    expect(stripConverged('Just a point.')).toBe('Just a point.');
  });
});

describe('participantSeed', () => {
  it('names the other participants and forbids artifacts', () => {
    const p = participantSeed(config, 'Claude', ['GPT', 'Grok']);
    expect(p).toContain('GPT, Grok');
    expect(p).toContain(config.topic);
    expect(p).toMatch(/do not create an artifact/i);
    expect(p).toContain('400 words');
  });
});

describe('participantRound', () => {
  it('includes every other turn verbatim', () => {
    const p = participantRound(config, 2, [turn('GPT', 'gpt view'), turn('Grok', 'grok view')]);
    expect(p).toContain('GPT said');
    expect(p).toContain('gpt view');
    expect(p).toContain('Grok said');
    expect(p).toContain('grok view');
  });

  it('shows only what it is given — excluding self is the caller\'s job, verified in L2', () => {
    const p = participantRound(config, 2, [turn('GPT', 'gpt view')]);
    expect(p).not.toContain('Claude');
  });
});

describe('narratorSeed', () => {
  it('demands a json-only reply and lists participants', () => {
    const n = narratorSeed(config, ['Claude', 'GPT']);
    expect(n).toContain('Claude, GPT');
    expect(n).toContain('```json');
    expect(n).toMatch(/observer/i);
  });
});

describe('adapterForUrl', () => {
  it('matches known providers', () => {
    expect(adapterForUrl('https://claude.ai/chat/abc')?.id).toBe('claude');
    expect(adapterForUrl('https://claude.ai/cowork/xyz')?.id).toBe('claude');
    expect(adapterForUrl('https://chatgpt.com/')?.id).toBe('chatgpt');
    expect(adapterForUrl('https://gemini.google.com/app')?.id).toBe('gemini');
    expect(adapterForUrl('https://grok.com/')?.id).toBe('grok');
  });

  it('ignores the port, as Chrome match patterns do', () => {
    // Chrome patterns have no port component, so a pattern must match any port on that host.
    expect(adapterForUrl('https://claude.ai:443/chat/abc')?.id).toBe('claude');
  });

  it('does not match lookalike hosts', () => {
    expect(adapterForUrl('https://notclaude.ai/chat')).toBeUndefined();
    expect(adapterForUrl('https://claude.ai.evil.com/')).toBeUndefined();
    expect(adapterForUrl('https://example.com/')).toBeUndefined();
  });
});
