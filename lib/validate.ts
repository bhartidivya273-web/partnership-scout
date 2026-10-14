// Code-side checks on Gemini output, on top of the JSON schema (test spec section D).
// Model output is never trusted: every item is checked on its own, and only the bad ones are retried.
import { CATEGORY_KEYS, isCategoryKey, type CategoryKey } from "./categories";

export type Fit = "strong" | "partial" | "weak";


// ---------- category sorting (D2) ----------

export type CategoryItem = { categories: CategoryKey[]; reason: string };

export function validateCategories(raw: unknown, requestedIds: string[]): { valid: Map<string, CategoryItem>; badIds: string[] } {
  const valid = new Map<string, CategoryItem>();
  const wanted = new Set(requestedIds);
  const items = Array.isArray(raw) ? raw : [];
  for (const item of items) {
    const o = item as { id?: unknown; categories?: unknown; reason?: unknown };
    const id = typeof o?.id === "string" || typeof o?.id === "number" ? String(o.id) : "";
    if (!wanted.has(id) || valid.has(id)) continue; // extra or repeated ids are ignored
    const cats = o.categories;
    if (!Array.isArray(cats) || cats.length > 2 || !cats.every(isCategoryKey)) continue;
    const reason = words(typeof o.reason === "string" ? o.reason : "").slice(0, 15).join(" ");
    valid.set(id, { categories: CATEGORY_KEYS.filter((k) => (cats as string[]).includes(k)), reason });
  }
  return { valid, badIds: requestedIds.filter((id) => !valid.has(id)) };
}

// ---------- shared text checks for everything Gemini writes (fit reasons and outreach) ----------

/** Empty compliments and hype that make outreach read as machine-written. */
const BANNED = [
  "synergy",
  "synergize",
  "game changer",
  "revolutionary",
  "cutting edge",
  "best in class",
  "world class",
  "next level",
  "unlock",
  "leverage",
  "touch base",
  "circle back",
  "let's partner",
  "lets partner",
  "excited to",
  "thrilled",
  "delighted",
  "hope this email",
  "hope this finds",
  "i was impressed",
  "impressed by",
  "innovative",
  "love what you",
  "big fan",
  "reaching out",
  "seamless",
  "disrupt",
];

/** Claims the model cannot know from a Product Hunt listing: goals, needs, traction, existing integrations. */
const CLAIM_PATTERNS: RegExp[] = [
  /\byou(?:'|’)?re (?:currently )?(?:looking|seeking|searching|hiring|raising)\b/,
  /\byou are (?:currently )?(?:looking|seeking|searching)\b/,
  /\b(?:seeking|looking for) (?:a |an )?(?:distribution )?partner/,
  /\b(?:we|our product) (?:already )?(?:integrates?|connects?) with (?:you|your)\b/,
  /\bour (?:existing|current) integration with (?:you|your)\b/,
  /\byour (?:goal|mission) is\b/,
  /\byou want to\b/,
  /\byou(?:'|’)ve (?:raised|grown|scaled)\b/,
  /\bcongrat(?:ulation)?s on (?:your )?(?:funding|raise|round)\b/,
];

const normalise = (s: string) => s.toLowerCase().replace(/[-\u2010-\u2015]/g, " ").replace(/[\u2019\u2018]/g, "'");

export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** First banned phrase found, or null. */
export function bannedHit(text: string): string | null {
  const t = normalise(text);
  return BANNED.find((b) => t.includes(b)) ?? null;
}

export const claimsHit = (text: string): boolean => CLAIM_PATTERNS.some((rx) => rx.test(normalise(text)));

/** Digits, currency amounts and percentages must also appear in the text the model was shown. */
export function inventedNumber(text: string, source: string): boolean {
  const tokens = text.match(/[$\u20ac\u00a3]\s?\d[\d,.]*|\d[\d,.]*%?/g) ?? [];
  const src = source.replace(/,/g, "");
  return tokens.some((t) => {
    const digits = t.replace(/[^\d.]/g, "").replace(/\.$/, "");
    return digits !== "" && !src.includes(digits);
  });
}

export function mostlyNotEnglish(s: string): boolean {
  const letters = s.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const nonLatin = letters.filter((c) => !/[A-Za-z\u00C0-\u00FF]/.test(c)).length;
  return nonLatin / letters.length > 0.3;
}

/** Strips emoji, turns exclamation marks into full stops and tidies spaces. */
export const tidy = (s: string) =>
  s.replace(/\p{Extended_Pictographic}\uFE0F?/gu, "").replace(/!/g, ".").replace(/\.{2,}/g, ".").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();

const COMMON = new Set([
  "about", "async", "asynchronous", "build", "built", "builds", "daily", "their", "there", "these", "those", "which", "while", "would", "could",
  "should", "teams", "team", "remote", "standup", "standups", "software", "platform", "product", "products", "tool", "tools", "helps", "using",
  "workflow", "workflows", "other", "every", "makes", "make", "better", "simple", "easy", "with", "from", "that", "this", "your", "have", "just",
  "into", "more", "most", "work", "works", "working", "company", "companies", "business", "users", "people", "launch", "launched", "world",
]);

export const contentWords = (s: string): Set<string> =>
  new Set((normalise(s).match(/[a-z][a-z0-9]{4,}/g) ?? []).filter((w) => !COMMON.has(w)));

/**
 * Grounded means it names the product, or uses at least one distinctive word from the product's
 * own text. A line that could be pasted under any product fails this.
 */
export function isGrounded(text: string, source: string, name: string): boolean {
  const t = normalise(text);
  if (name.trim().length >= 3 && t.includes(normalise(name.trim()))) return true;
  const own = contentWords(source);
  return [...contentWords(text)].some((w) => own.has(w));
}

/** Shortest prefix of whole sentences within the word limit, or null if even one sentence is too long. */
export function trimToSentences(text: string, limit: number): string | null {
  if (words(text).length <= limit) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const sentence of sentences) {
    if (words(out + sentence).length > limit) break;
    out += sentence;
  }
  return out.trim() ? out.trim() : null;
}

export const sameText = (a: string, b: string) => normalise(a).replace(/\W+/g, " ").trim() === normalise(b).replace(/\W+/g, " ").trim();
