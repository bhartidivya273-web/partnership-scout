// Code-side checks on Gemini output, on top of the JSON schema (test spec section D).
// Model output is never trusted: every item is checked on its own, and only the bad ones are retried.
import { CATEGORY_KEYS, isCategoryKey, type CategoryKey } from "./categories";

export type Fit = "strong" | "partial" | "weak";
const FITS: Fit[] = ["strong", "partial", "weak"];

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

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

// ---------- outreach angles (D3) ----------

export const MAX_ANGLE_WORDS = 55; // prompt asks for about 45; a little slack before we act

const BANNED = [
  "synergy",
  "game changer",
  "revolutionary",
  "cutting edge",
  "best in class",
  "unlock",
  "leverage",
  "touch base",
  "circle back",
  "let's partner",
  "lets partner",
  "excited to",
];

const normalise = (s: string) => s.toLowerCase().replace(/[-‐-―]/g, " ").replace(/[’‘]/g, "'");

function trimToSentences(text: string, limit: number): string | null {
  if (words(text).length <= limit) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) {
    if (words(out + s).length > limit) break;
    out += s;
  }
  return out.trim() ? out.trim() : null;
}

/** Digits, currency amounts and percentages in the angle must also appear in the product's own text. */
function inventedNumber(angle: string, source: string): boolean {
  const tokens = angle.match(/[$€£]\s?\d[\d,.]*|\d[\d,.]*%?/g) ?? [];
  const src = source.replace(/,/g, "");
  return tokens.some((t) => {
    const digits = t.replace(/[^\d.]/g, "").replace(/\.$/, "");
    return digits !== "" && !src.includes(digits);
  });
}

function mostlyNotEnglish(s: string): boolean {
  const letters = s.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const nonLatin = letters.filter((c) => !/[A-Za-zÀ-ÿ]/.test(c)).length;
  return nonLatin / letters.length > 0.3;
}

export type AngleCheck = { angle: string | null; fit: Fit | null; problems: string[] };

/** `source` is everything the model saw for this product. */
export function checkAngle(raw: unknown, source: string): AngleCheck {
  const o = (raw ?? {}) as { angle?: unknown; fit?: unknown };
  const problems: string[] = [];

  const fit = FITS.includes(o.fit as Fit) ? (o.fit as Fit) : null;
  if (!fit) problems.push("fit");

  let angle = typeof o.angle === "string" ? o.angle : "";
  // Emoji and exclamation marks are stripped rather than failing the whole answer.
  angle = angle.replace(/\p{Extended_Pictographic}️?/gu, "").replace(/!/g, ".").replace(/\.{2,}/g, ".").replace(/\s+/g, " ").trim();

  if (!angle) {
    problems.push("empty");
    return { angle: null, fit, problems };
  }
  if (words(angle).length > MAX_ANGLE_WORDS) {
    const trimmed = trimToSentences(angle, MAX_ANGLE_WORDS);
    if (trimmed) angle = trimmed;
    else problems.push("too_long");
  }
  const lower = normalise(angle);
  if (BANNED.some((b) => lower.includes(b))) problems.push("banned_phrase");
  if (/\[redacted\]/i.test(angle)) problems.push("redacted_text");
  if (inventedNumber(angle, source)) problems.push("invented_number");
  if (mostlyNotEnglish(angle)) problems.push("not_english");

  return { angle: problems.some((p) => p !== "fit") ? null : angle, fit, problems };
}

export const sameAngle = (a: string, b: string) => normalise(a).replace(/\W+/g, " ").trim() === normalise(b).replace(/\W+/g, " ").trim();
