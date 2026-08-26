// Domains the extension never reports. This list runs in the browser, so the
// blocked pages never leave the machine. The server enforces the same rules.
export const BLOCKED_PATTERNS = [
  "*bank*",
  "*.bank",
  "chase.com",
  "*.chase.com",
  "wellsfargo.com",
  "bankofamerica.com",
  "citi.com",
  "capitalone.com",
  "americanexpress.com",
  "paypal.com",
  "venmo.com",
  "wise.com",
  "revolut.com",
  "coinbase.com",
  "robinhood.com",
  "fidelity.com",
  "vanguard.com",
  "schwab.com",
  "irs.gov",
  "*.health",
  "*health.gov",
  "mychart.*",
  "*.mychart.com",
  "patient.*",
  "healthcare.gov",
  "zocdoc.com",
  "goodrx.com",
  "*porn*",
  "accounts.google.com",
  "login.*",
  "*.onlinebanking.*",
];

/** True when the host matches a pattern such as `*.bank` or `chase.com`. */
export function isBlockedHost(host, extraPatterns = []) {
  const clean = String(host || "").toLowerCase();
  if (clean === "") return true;
  return [...BLOCKED_PATTERNS, ...extraPatterns].some((pattern) => {
    const escaped = String(pattern)
      .trim()
      .toLowerCase()
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*");
    if (escaped === "") return false;
    return new RegExp(`^${escaped}$`).test(clean);
  });
}

/** True when the URL is a page Loomstate can learn from. */
export function isReportableUrl(rawUrl, extraPatterns = []) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "localhost" || host.endsWith(".local")) return false;
  return !isBlockedHost(host, extraPatterns);
}
