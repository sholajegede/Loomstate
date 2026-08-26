/**
 * Convex wraps a thrown server error with its own prefix and a stack trace.
 * The person reading the screen needs the sentence, not the trace.
 */
export function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;

  const withoutPrefix = error.message
    .replace(/^\[CONVEX [^\]]*\]\s*/, "")
    .replace(/^\[Request ID:[^\]]*\]\s*/, "")
    .replace(/^(Server Error\s*)?(Uncaught Error:\s*)+/, "")
    .trim();

  const firstFrame = withoutPrefix.search(/\s+at\s+\S+\s*\(/);
  const sentence = (firstFrame === -1
    ? withoutPrefix
    : withoutPrefix.slice(0, firstFrame)
  ).trim();

  return sentence === "" ? fallback : sentence;
}
