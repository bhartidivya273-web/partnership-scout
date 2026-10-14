// Job B1: how well does each candidate fit Kavya's product, and why. Runs on the shortlist BEFORE the
// final ranking, because relevance is one component of the priority score. Output is a label plus one
// grounded sentence; the arithmetic that turns the label into points lives in priority.ts.
import type { GeminiFn } from "./gemini";
import type { FitInfo } from "./priority";
import { dataBlock, fitSystem, sourceText } from "./prompts";
import type { ClassifiedProduct } from "./types";
import { bannedHit, claimsHit, inventedNumber, isGrounded, mostlyNotEnglish, tidy, trimToSentences, words, type Fit } from "./validate";

const FITS: Fit[] = ["strong", "partial", "weak"];
const MAX_RELEVANCE_WORDS = 32;

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { id: { type: "STRING" }, fit: { type: "STRING", enum: FITS }, relevance: { type: "STRING" } },
    required: ["id", "fit", "relevance"],
  },
};

/** A fit rating is accepted only with a label from the list and a clean, grounded one-sentence reason. */
export function checkFit(raw: unknown, source: string, name: string): { fit: Fit; relevance: string } | null {
  const o = (raw ?? {}) as { fit?: unknown; relevance?: unknown };
  if (!FITS.includes(o.fit as Fit)) return null;
  let relevance = tidy(typeof o.relevance === "string" ? o.relevance : "");
  if (!relevance) return null;
  if (words(relevance).length > MAX_RELEVANCE_WORDS) {
    const trimmed = trimToSentences(relevance, MAX_RELEVANCE_WORDS);
    if (!trimmed) return null;
    relevance = trimmed;
  }
  if (bannedHit(relevance) || claimsHit(relevance) || inventedNumber(relevance, source) || mostlyNotEnglish(relevance)) return null;
  if (!isGrounded(relevance, source, name)) return null;
  return { fit: o.fit as Fit, relevance };
}

type Options = { retryDelayMs?: number; batchSize?: number; concurrency?: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Returns only the ratings that passed their checks; the rest stay unrated (never guessed). */
export async function rateFit(
  products: ClassifiedProduct[],
  kavyaProduct: string,
  gen: GeminiFn | null,
  options: Options = {},
): Promise<Map<string, FitInfo>> {
  const out = new Map<string, FitInfo>();
  if (!gen) return out;
  const sources = new Map(products.map((p) => [p.id, sourceText(p)]));
  const size = options.batchSize ?? 20;
  let todo = products;

  for (let attempt = 0; attempt < 2 && todo.length > 0; attempt++) {
    if (attempt > 0) await sleep(options.retryDelayMs ?? 1500);
    const batches: ClassifiedProduct[][] = [];
    for (let i = 0; i < todo.length; i += size) batches.push(todo.slice(i, i + size));
    await Promise.all(
      batches.map(async (batch) => {
        let raw: unknown;
        try {
          raw = await gen({
            system: fitSystem(kavyaProduct),
            user: `Rate these products.\n${dataBlock(batch.map((p) => ({ ...p, categories: p.categories })))}`,
            schema: SCHEMA,
            attempt,
          });
        } catch {
          return; // nothing usable from this batch this round
        }
        const byId = new Map<string, unknown>();
        for (const item of Array.isArray(raw) ? raw : []) {
          const id = String((item as { id?: unknown })?.id ?? "");
          if (!byId.has(id)) byId.set(id, item);
        }
        for (const p of batch) {
          const ok = checkFit(byId.get(p.id), sources.get(p.id) ?? "", p.name);
          if (ok) out.set(p.id, ok);
        }
      }),
    );
    todo = todo.filter((p) => !out.has(p.id));
  }
  return out;
}
