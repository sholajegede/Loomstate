/**
 * Firecrawl is the alive-engine. It re-reads the exact page a loop is about, so
 * Loomstate can tell the user what changed instead of guessing.
 */

const ENDPOINTS = [
  "https://api.firecrawl.dev/v2/scrape",
  "https://api.firecrawl.dev/v1/scrape",
];

export type ScrapeResult = {
  ok: boolean;
  markdown: string;
  title: string;
  statusCode: number;
  error?: string;
};

/** Reads one page and returns its markdown. Never throws for a page problem. */
export async function scrape(
  apiKey: string,
  url: string,
): Promise<ScrapeResult> {
  let lastError = "Firecrawl did not answer.";

  for (const endpoint of ENDPOINTS) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ["markdown"],
          onlyMainContent: true,
          timeout: 45000,
        }),
      });
    } catch (caught) {
      lastError = `Firecrawl is unreachable. ${String(caught).slice(0, 200)}`;
      continue;
    }

    if (response.status === 404) {
      // This API version is gone. Try the next one.
      lastError = "Firecrawl returned 404 for this API version.";
      continue;
    }

    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: {
        markdown?: string;
        metadata?: { title?: string; statusCode?: number };
      };
      error?: string;
    } | null;

    if (!response.ok || payload === null || payload.success === false) {
      lastError =
        payload?.error ?? `Firecrawl returned ${response.status}.`;
      // A key or credit problem repeats on every version, so stop.
      if (response.status === 401 || response.status === 402) break;
      continue;
    }

    return {
      ok: true,
      markdown: payload.data?.markdown ?? "",
      title: payload.data?.metadata?.title ?? "",
      statusCode: payload.data?.metadata?.statusCode ?? response.status,
    };
  }

  return { ok: false, markdown: "", title: "", statusCode: 0, error: lastError };
}

/**
 * Strips the parts of a page that change on every read: session ids, view
 * counts, timestamps. Without this every check would report a false change.
 */
export function normalize(markdown: string): string {
  return markdown
    .replace(/\s+/g, " ")
    .replace(/\b\d{1,3}(,\d{3})*\s*(views?|reads?|watching)\b/gi, "")
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/gi, "")
    .replace(/\b(just now|\d+\s*(seconds?|minutes?|hours?|days?)\s*ago)\b/gi, "")
    .replace(/[?&](utm_[a-z]+|fbclid|gclid)=[^\s&]*/gi, "")
    .trim()
    .slice(0, 200_000);
}
