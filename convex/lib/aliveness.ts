/**
 * Aliveness says how live a loop still is, from 0 to 100.
 *
 * The model never picks this number. Loomstate computes it from evidence:
 * how recently the person touched the loop, how much attention they gave it,
 * how many pages it spans, and whether the live web changed under it. The
 * model supplies only `momentum`, which is its read of how committed the
 * person looked.
 */
export function alivenessScore(input: {
  lastActivityAt: number;
  eventCount: number;
  totalDwellMs: number;
  momentum: number;
  unseenDiffs: number;
  now?: number;
}): number {
  const now = input.now ?? Date.now();
  const days = Math.max(0, (now - input.lastActivityAt) / 86_400_000);

  // Attention halves every five days with no new signal.
  const recency = Math.pow(0.5, days / 5);
  // Breadth saturates: eight pages says as much as eighty.
  const breadth = Math.min(1, input.eventCount / 8);
  // Ten minutes of reading is a full-weight signal.
  const attention = Math.min(1, input.totalDwellMs / 600_000);
  const momentum = Math.min(1, Math.max(0, input.momentum));
  // A change on the live web pulls a quiet loop back up.
  const change = Math.min(1, input.unseenDiffs / 2);

  const score =
    100 *
    (0.42 * recency +
      0.16 * breadth +
      0.14 * attention +
      0.18 * momentum +
      0.1 * change);

  return Math.round(Math.min(100, Math.max(0, score)));
}

/** Turns a score into the status shown on the intent map. */
export function statusFor(
  score: number,
  closed: boolean,
): "active" | "stalled" | "dormant" | "closed" {
  if (closed) return "closed";
  if (score >= 55) return "active";
  if (score >= 25) return "stalled";
  return "dormant";
}
