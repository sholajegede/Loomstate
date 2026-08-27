/**
 * Near-duplicate detection for outbound email.
 *
 * The agent writes a fresh sentence every run, so two messages that ask the
 * same thing rarely match character for character. Comparing the words they
 * share catches a re-ask that an exact comparison would let through.
 */

const BORING = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "so", "to", "of", "in",
  "on", "at", "for", "with", "from", "by", "is", "are", "was", "were", "be",
  "been", "it", "this", "that", "these", "those", "i", "you", "we", "they",
  "my", "your", "our", "their", "me", "us", "them", "as", "can", "could",
  "will", "would", "shall", "should", "may", "might", "do", "does", "did",
  "have", "has", "had", "please", "thanks", "thank", "hi", "hello", "regards",
]);

/** The meaningful words in a message, lowercased and de-duplicated. */
export function wordSet(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !BORING.has(w));
  return new Set(words);
}

/**
 * How much two messages overlap, from 0 to 1. Jaccard over meaningful words:
 * shared words divided by all words either message uses.
 */
export function similarity(a: string, b: string): number {
  const left = wordSet(a);
  const right = wordSet(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Above this, two messages are asking the same thing again. */
export const DUPLICATE_THRESHOLD = 0.6;

/** Turns the agent's step label into a stable key. */
export function stepKeyOf(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
