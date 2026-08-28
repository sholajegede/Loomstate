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

/**
 * Comparing prices.
 *
 * A page states its price in whatever wrapper its markup happens to use, and
 * that wrapper changes without the price changing. "₦65,000.00 NGN" and
 * "Sale price₦65,000.00 NGN" are the same money. Comparing the strings reports
 * a change every time a site relabels a field, which wakes the agent for
 * nothing and fills the loop with news that is not news.
 *
 * So Loomstate compares what the price actually is: the amounts and the
 * currency, not the text around them.
 */

/** The money in a price string, separated from the words around it. */
export type ParsedPrice = {
  /**
   * The distinct amounts stated, smallest first. Distinct, because a page that
   * prints its price twice states one price, not two. A range states two.
   */
  amounts: number[];
  /** The currency, when the string names one. */
  currency: string | null;
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  "₦": "NGN",
  $: "USD",
  "£": "GBP",
  "€": "EUR",
  "¥": "JPY",
  "₹": "INR",
  "₽": "RUB",
  "₩": "KRW",
  "R$": "BRL",
};

const CURRENCY_CODES =
  /\b(NGN|USD|GBP|EUR|JPY|INR|RUB|KRW|BRL|CAD|AUD|CHF|CNY|ZAR|GHS|KES)\b/i;

/**
 * Reads one number that a page wrote for a person, with whatever separators
 * that page uses. Returns null when the token is not a number.
 */
function toAmount(token: string): number | null {
  let text = token.replace(/\s/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  // Whichever separator comes last is the decimal point, unless exactly three
  // digits follow it, which makes it a thousands group instead.
  let decimal: "," | "." | null = null;
  if (lastComma > lastDot) decimal = ",";
  else if (lastDot > lastComma) decimal = ".";
  if (decimal !== null) {
    const trailing = text.length - text.lastIndexOf(decimal) - 1;
    if (trailing === 3) decimal = null;
  }

  if (decimal === ",") text = text.replace(/\./g, "").replace(",", ".");
  else if (decimal === ".") text = text.replace(/,/g, "");
  else text = text.replace(/[.,]/g, "");

  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** A number written beside a currency, which is what makes it a price. */
const PRICED =
  /(?:[₦$£€¥₹₽₩]|\b(?:NGN|USD|GBP|EUR|JPY|INR|RUB|KRW|BRL|CAD|AUD|CHF|CNY|ZAR|GHS|KES)\b)\s*(\d[\d.,\s]*\d|\d)|(\d[\d.,\s]*\d|\d)\s*(?:[₦$£€¥₹₽₩]|\b(?:NGN|USD|GBP|EUR|JPY|INR|RUB|KRW|BRL|CAD|AUD|CHF|CNY|ZAR|GHS|KES)\b)/g;

/** Dates and clock times are not prices. */
const TIMESTAMPS =
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g;

/** Pulls the money out of a price string. Returns null when it states none. */
export function parsePrice(value: string | undefined): ParsedPrice | null {
  if (value === undefined || value.trim() === "") return null;
  const text = value.replace(/\u00a0/g, " ").replace(TIMESTAMPS, " ");

  // A number beside a currency is a price. Anything else in the string is the
  // size, the quantity, or part of the product name.
  const found = new Set<number>();
  for (const match of text.matchAll(PRICED)) {
    const token = match[1] ?? match[2];
    const amount = token === undefined ? null : toAmount(token);
    if (amount !== null) found.add(amount);
  }

  // A page that names no currency still names a price, so read every number.
  if (found.size === 0) {
    for (const match of text.matchAll(/\d[\d.,\s]*\d|\d/g)) {
      const amount = toAmount(match[0]);
      if (amount !== null) found.add(amount);
    }
  }
  if (found.size === 0) return null;
  const amounts = [...found].sort((x, y) => x - y);

  let currency: string | null = null;
  const code = text.match(CURRENCY_CODES);
  if (code !== null) currency = code[1].toUpperCase();
  else {
    for (const [symbol, iso] of Object.entries(CURRENCY_SYMBOLS)) {
      if (text.includes(symbol)) {
        currency = iso;
        break;
      }
    }
  }

  return { amounts, currency };
}

/**
 * True when two price strings state the same money.
 *
 * When either string states no amount at all, Loomstate falls back to
 * comparing the text with its spacing and case removed, so an unreadable
 * price is still compared rather than silently treated as unchanged.
 */
export function samePrice(a: string | undefined, b: string | undefined): boolean {
  const left = parsePrice(a);
  const right = parsePrice(b);

  if (left === null || right === null) {
    return normalizeField(a) === normalizeField(b);
  }

  // A page that starts naming its currency has not changed its price.
  if (
    left.currency !== null &&
    right.currency !== null &&
    left.currency !== right.currency
  ) {
    return false;
  }

  if (left.amounts.length !== right.amounts.length) return false;
  return left.amounts.every((amount, i) => amount === right.amounts[i]);
}

/** Strips spacing and case so two renderings of one value compare equal. */
export function normalizeField(value: string | undefined): string | null {
  if (value === undefined) return null;
  const clean = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
  return clean === "" ? null : clean;
}
