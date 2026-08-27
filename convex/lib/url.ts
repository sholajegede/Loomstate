/** Splits a URL into the parts Loomstate stores. Returns null when unusable. */
export function parseUrl(
  raw: string,
): { url: string; host: string; path: string; query: string | null } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const searchTerm =
    parsed.searchParams.get("q") ??
    parsed.searchParams.get("query") ??
    parsed.searchParams.get("k") ??
    parsed.searchParams.get("search_query");

  return {
    url: `${parsed.origin}${parsed.pathname}${parsed.search}`,
    host: parsed.hostname.replace(/^www\./, ""),
    path: parsed.pathname,
    query: searchTerm,
  };
}

/** True when the host matches a blocklist pattern such as `*.bank` or `chase.com`. */
export function matchesPattern(host: string, pattern: string): boolean {
  const clean = pattern.trim().toLowerCase();
  if (clean === "") return false;
  const escaped = clean.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(host.toLowerCase());
}

/**
 * Hosts that answer a question but never hold a loop's subject. Loomstate does
 * not watch these, because a search page changes for reasons the loop does not
 * care about.
 */
const NOT_WORTH_WATCHING = [
  "google.com",
  "google.co.uk",
  "bing.com",
  "duckduckgo.com",
  "search.yahoo.com",
  "facebook.com",
  "web.facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "reddit.com",
  "youtube.com",
  "tiktok.com",
  "linkedin.com",
  "mail.google.com",
  "chatgpt.com",
  "claude.ai",
];

/**
 * True when a page is worth re-reading for a loop: a listing, a product, a
 * booking, a specific document. A search result page is not.
 */
export function isWatchable(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (NOT_WORTH_WATCHING.some((h) => host === h || host.endsWith(`.${h}`))) {
    return false;
  }
  // A bare home page rarely carries the thing the loop is about.
  if (parsed.pathname === "/" || parsed.pathname === "") return false;
  // Search and account paths change for reasons unrelated to the loop.
  if (/\/(search|login|signin|signup|account|cart|checkout)(\/|$)/i.test(parsed.pathname)) {
    return false;
  }
  return true;
}

/** Pulls the first plausible contact address out of page text. */
export function findContactEmail(text: string): string | null {
  const matches = text.match(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  );
  if (matches === null) return null;

  // Addresses a site uses for itself, not for the person behind the listing.
  const noise =
    /^(no-?reply|do-?not-?reply|postmaster|abuse|privacy|legal|dmca|webmaster|admin|hello|info|support|help|press|careers|jobs|security)@/i;
  const assetLike = /\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i;

  for (const candidate of matches) {
    const clean = candidate.trim().toLowerCase();
    if (noise.test(clean)) continue;
    if (assetLike.test(clean)) continue;
    if (clean.endsWith("@sentry.io") || clean.includes("example.com")) continue;
    return clean;
  }
  return null;
}
