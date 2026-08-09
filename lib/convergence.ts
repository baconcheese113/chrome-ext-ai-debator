import type { ConvergenceStrategy, RoundSummary, Turn } from './types';

export interface ConvergenceVerdict {
  converged: boolean;
  reason: string;
}

/**
 * All three strategies the user asked to keep open, behind one interface. Swapping them is a
 * config value on the run, not a code path anywhere else.
 */
export function evaluateConvergence(
  strategy: ConvergenceStrategy,
  roundTurns: Turn[],
  summary: RoundSummary | undefined,
): ConvergenceVerdict {
  switch (strategy) {
    case 'self-report': {
      const votes = roundTurns.map((t) => t.converged);
      // An unparseable footer is not a yes. Treating null as agreement would end runs early
      // whenever a model forgot the format.
      const unknown = votes.filter((v) => v === null).length;
      const yes = votes.filter((v) => v === true).length;
      if (unknown > 0) {
        return {
          converged: false,
          reason: `${yes}/${votes.length} voted converged, ${unknown} gave no parseable verdict`,
        };
      }
      const all = votes.length > 0 && votes.every((v) => v === true);
      return {
        converged: all,
        reason: all
          ? 'every participant reported nothing further to add'
          : `${yes}/${votes.length} participants reported convergence`,
      };
    }

    case 'moderator': {
      if (!summary) return { converged: false, reason: 'no narrator summary for this round' };
      if (summary.parseError) {
        return { converged: false, reason: `narrator output unparseable: ${summary.parseError}` };
      }
      return {
        converged: summary.converged,
        reason: summary.rationale || 'narrator verdict',
      };
    }

    case 'manual':
      return { converged: false, reason: 'manual mode — waiting for you to stop the run' };
  }
}

/** Lenient parse of the narrator's fenced json. Models add prose no matter what you ask. */
export function parseNarratorSummary(round: number, raw: string): RoundSummary {
  const base: RoundSummary = {
    round,
    plainSummary: '',
    keyPoints: [],
    agreements: [],
    disagreements: [],
    openQuestions: [],
    converged: false,
    rationale: '',
    raw,
  };

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? sliceOutermostObject(raw);
  if (!candidate) return { ...base, parseError: 'no json object found in narrator reply' };

  try {
    const parsed = JSON.parse(candidate) as Partial<RoundSummary>;
    return {
      ...base,
      plainSummary: typeof parsed.plainSummary === 'string' ? parsed.plainSummary : '',
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      agreements: strings(parsed.agreements),
      disagreements: strings(parsed.disagreements),
      openQuestions: strings(parsed.openQuestions),
      converged: parsed.converged === true,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    };
  } catch (err) {
    return { ...base, parseError: String(err) };
  }
}

function sliceOutermostObject(text: string): string | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
