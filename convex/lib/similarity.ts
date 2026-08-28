/**
 * Deciding whether the agent is about to send the same email twice.
 *
 * Two messages that ask the same thing rarely match character for character,
 * because the agent writes a fresh sentence every run. So Loomstate compares
 * the words they share.
 *
 * Prose overlap on its own is not enough. Two emails about two different
 * bracelets from the same shop share almost all their vocabulary: the shop, the
 * word bracelet, the word purchase, the currency. Judged on prose alone a
 * genuinely new offer looks like a resend, and the agent refuses to do work it
 * has never done.
 *
 * What separates them is not how they are worded but what they are about: the
 * money on the table and the page being discussed. Loomstate reads those first.
 * When they disagree the messages concern different things, whatever the prose
 * says, and only when they agree does word overlap decide.
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

/**
 * How much wording must agree before a message counts as already sent.
 *
 * The bar falls as the evidence that the two concern the same thing rises. Two
 * messages naming the same price and the same page are almost certainly one
 * message written twice, so they need less wording in common to prove it. Two
 * messages naming neither have only their words to go on.
 */
export const DUPLICATE_THRESHOLD = 0.6;
export const PART_SUBJECT_THRESHOLD = 0.5;
export const SAME_SUBJECT_THRESHOLD = 0.4;

/** What a message is about, as opposed to how it is worded. */
export type Subject = {
  /** Every sum of money named, normalised so 65,000.00 and 65000 agree. */
  amounts: Set<string>;
  /** Every page named, by the part of the address that identifies the thing. */
  pages: Set<string>;
};

/** Dates and clock times are not prices, and every message carries them. */
const TIMESTAMPS =
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?|\d{2}:\d{2}(?::\d{2})?/g;

/** A number written next to a currency, which is what makes it a price. */
const PRICED =
  /(?:[₦$£€¥₹₽₩]|\b(?:NGN|USD|GBP|EUR|JPY|INR|RUB|KRW|BRL|CAD|AUD|CHF|CNY|ZAR|GHS|KES)\b)\s*(\d[\d.,]*\d|\d)|(\d[\d.,]*\d|\d)\s*(?:[₦$£€¥₹₽₩]|\b(?:NGN|USD|GBP|EUR|JPY|INR|RUB|KRW|BRL|CAD|AUD|CHF|CNY|ZAR|GHS|KES)\b)/g;

/** A money amount, whatever separators the writer used. */
function normaliseAmount(token: string): string | null {
  let text = token.replace(/\s/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let decimal: "," | "." | null = null;
  if (lastComma > lastDot) decimal = ",";
  else if (lastDot > lastComma) decimal = ".";
  if (decimal !== null && text.length - text.lastIndexOf(decimal) - 1 === 3) {
    decimal = null;
  }
  if (decimal === ",") text = text.replace(/\./g, "").replace(",", ".");
  else if (decimal === ".") text = text.replace(/,/g, "");
  else text = text.replace(/[.,]/g, "");

  const value = Number(text);
  // Small numbers are quantities, dates, and sizes rather than prices, and
  // treating them as identity would split messages that belong together.
  if (!Number.isFinite(value) || value < 100) return null;
  return String(value);
}

/** Reads what a message is about: the money in it and the pages it names. */
export function subjectOf(text: string): Subject {
  // Strip the dates and clock times first. Every message carries a year and a
  // timestamp, and letting those count as money would make two messages about
  // different things look like they share a price.
  const withoutTimes = text.replace(TIMESTAMPS, " ");

  const amounts = new Set<string>();
  for (const match of withoutTimes.matchAll(PRICED)) {
    const token = match[1] ?? match[2];
    const amount = token === undefined ? null : normaliseAmount(token);
    if (amount !== null) amounts.add(amount);
  }

  const pages = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s)>\]",]+/g)) {
    try {
      const url = new URL(match[0]);
      const path = url.pathname.replace(/\/+$/, "");
      // The last part of the path is what names the product. The bare host is
      // not, because every listing on a shop shares it.
      const tail = path.split("/").filter(Boolean).pop();
      if (tail !== undefined && tail.length > 2) {
        pages.add(`${url.hostname.replace(/^www\./, "")}/${tail.toLowerCase()}`);
      }
    } catch {
      // An address Loomstate cannot read tells it nothing either way.
    }
  }

  return { amounts, pages };
}

function sharesNothing(a: Set<string>, b: Set<string>): boolean {
  for (const item of a) if (b.has(item)) return false;
  return true;
}

/**
 * True when a draft repeats a message already sent.
 *
 * Different money or a different page means a different thing is being
 * discussed, and the agent is allowed to send. Only when the two are about the
 * same thing does the wording decide.
 */
export function isResend(sent: string, draft: string): boolean {
  const before = subjectOf(sent);
  const now = subjectOf(draft);

  const bothPriced = before.amounts.size > 0 && now.amounts.size > 0;
  const bothLinked = before.pages.size > 0 && now.pages.size > 0;

  // A different sum of money is a different offer.
  if (bothPriced && sharesNothing(before.amounts, now.amounts)) return false;

  // A different product page is a different item.
  if (bothLinked && sharesNothing(before.pages, now.pages)) return false;

  // The two are about the same thing, which is itself evidence of a resend, so
  // the wording has less to prove. Where neither names a price or a page there
  // is nothing to go on but the words, and they must agree strongly.
  const agrees = (bothPriced ? 1 : 0) + (bothLinked ? 1 : 0);
  const threshold =
    agrees === 2
      ? SAME_SUBJECT_THRESHOLD
      : agrees === 1
        ? PART_SUBJECT_THRESHOLD
        : DUPLICATE_THRESHOLD;

  return similarity(sent, draft) >= threshold;
}

/** Turns the agent's step label into a stable key. */
export function stepKeyOf(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
