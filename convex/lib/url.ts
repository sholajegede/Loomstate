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
