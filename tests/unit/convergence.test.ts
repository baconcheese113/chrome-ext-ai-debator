import { describe, expect, it } from 'vitest';
import { evaluateConvergence, parseNarratorSummary } from '../../lib/convergence';
import type { RoundSummary, Turn } from '../../lib/types';

const turn = (name: string, converged: boolean | null): Turn => ({
  round: 1,
  seatId: name,
  displayName: name,
  text: 'x',
  html: '',
  converged,
  via: 'message',
  wordCount: 1,
  at: '2026-08-08T00:00:00Z',
});

const summary = (over: Partial<RoundSummary> = {}): RoundSummary => ({
  round: 1,
  keyPoints: [],
  agreements: [],
  disagreements: [],
  openQuestions: [],
  converged: false,
  rationale: '',
  raw: '',
  ...over,
});

describe('evaluateConvergence — self-report', () => {
  it('converges only when every participant votes yes', () => {
    const all = evaluateConvergence('self-report', [turn('a', true), turn('b', true)], undefined);
    expect(all.converged).toBe(true);

    const some = evaluateConvergence('self-report', [turn('a', true), turn('b', false)], undefined);
    expect(some.converged).toBe(false);
  });

  it('treats an unparseable footer as NOT agreement', () => {
    // A model that forgot the format must never be counted as "nothing further to add" —
    // that would end runs early and silently.
    const v = evaluateConvergence('self-report', [turn('a', true), turn('b', null)], undefined);
    expect(v.converged).toBe(false);
    expect(v.reason).toContain('no parseable verdict');
  });

  it('does not converge on an empty round', () => {
    expect(evaluateConvergence('self-report', [], undefined).converged).toBe(false);
  });
});

describe('evaluateConvergence — moderator', () => {
  it('follows the narrator verdict', () => {
    expect(evaluateConvergence('moderator', [], summary({ converged: true })).converged).toBe(true);
    expect(evaluateConvergence('moderator', [], summary({ converged: false })).converged).toBe(false);
  });

  it('refuses to converge when there is no summary or it failed to parse', () => {
    expect(evaluateConvergence('moderator', [], undefined).converged).toBe(false);
    const broken = summary({ converged: true, parseError: 'bad json' });
    expect(evaluateConvergence('moderator', [], broken).converged).toBe(false);
  });
});

describe('evaluateConvergence — manual', () => {
  it('never converges on its own', () => {
    expect(evaluateConvergence('manual', [turn('a', true)], summary({ converged: true })).converged)
      .toBe(false);
  });
});

describe('parseNarratorSummary', () => {
  const body = {
    keyPoints: [{ agent: 'A', points: ['p1'] }],
    agreements: ['ag'],
    disagreements: ['dis'],
    openQuestions: ['q'],
    converged: true,
    rationale: 'done',
  };

  it('reads a fenced json block', () => {
    const s = parseNarratorSummary(1, '```json\n' + JSON.stringify(body) + '\n```');
    expect(s.parseError).toBeUndefined();
    expect(s.converged).toBe(true);
    expect(s.agreements).toEqual(['ag']);
  });

  it('reads bare json', () => {
    expect(parseNarratorSummary(1, JSON.stringify(body)).converged).toBe(true);
  });

  it('reads json wrapped in prose, which models emit no matter what you ask', () => {
    const s = parseNarratorSummary(1, `Sure! Here you go:\n${JSON.stringify(body)}\nHope that helps.`);
    expect(s.parseError).toBeUndefined();
    expect(s.rationale).toBe('done');
  });

  it('degrades to parseError instead of throwing', () => {
    const s = parseNarratorSummary(1, 'I have no idea what you mean.');
    expect(s.parseError).toBeDefined();
    expect(s.converged).toBe(false);
  });

  it('keeps the raw text when parsing fails, so it stays inspectable', () => {
    const raw = '{ not valid json';
    expect(parseNarratorSummary(1, raw).raw).toBe(raw);
  });

  it('ignores non-string entries rather than trusting the model', () => {
    const s = parseNarratorSummary(1, JSON.stringify({ ...body, agreements: ['ok', 42, null] }));
    expect(s.agreements).toEqual(['ok']);
  });
});
