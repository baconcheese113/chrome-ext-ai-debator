import type { RunState, Seat } from './types';

/**
 * A seat's colour is its identity across the whole console — rail node, chip, turn card.
 * Derived from position among participants so it stays stable for the life of a run.
 */
export function channelColor(run: RunState, seatId: string): string {
  if (run.seats.find((s) => s.seatId === seatId)?.role === 'narrator') return 'var(--ink-dim)';
  const participants = run.seats.filter((s) => s.role === 'participant');
  const i = participants.findIndex((s) => s.seatId === seatId);
  return `var(--ch-${(i < 0 ? 0 : i % 6) + 1})`;
}

export function seatStatusLabel(seat: Seat): string {
  switch (seat.status) {
    case 'idle': return 'standby';
    case 'sending': return 'sending';
    case 'waiting': return 'generating';
    case 'done': return 'received';
    case 'failed': return 'failed';
    case 'dropped': return 'dropped';
  }
}
