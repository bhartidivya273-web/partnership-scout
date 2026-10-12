// Job A: sort the featured pool into Kavya's four categories. Gemini decides because Product Hunt
// has no topic for two of the four; if Gemini fails for a product, the topic table fills in.
import { categoriesFromTopics, CATEGORY_KEYS, type CategoryKey } from "./categories";
import type { GeminiFn } from "./gemini";
import { CLASSIFY_SYSTEM, dataBlock } from "./prompts";
import type { Product } from "./types";
import { validateCategories } from "./validate";

export type Classification = { categories: CategoryKey[]; source: "gemini" | "topic"; reason: string | null };

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      categories: { type: "ARRAY", items: { type: "STRING", enum: [...CATEGORY_KEYS] } },
      reason: { type: "STRING" },
    },
    required: ["id", "categories", "reason"],
  },
};

type Options = { batchSize?: number; retryDelayMs?: number; concurrency?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function classifyBatch(batch: Product[], gen: GeminiFn, delayMs: number) {
  const done = new Map<string, Classification>();
  let todo = batch;
  for (let attempt = 0; attempt < 2 && todo.length > 0; attempt++) {
    if (attempt > 0) await sleep(delayMs);
    try {
      const raw = await gen({
        system: CLASSIFY_SYSTEM,
        user: `Sort these products.\n${dataBlock(todo)}`,
        schema: SCHEMA,
        attempt,
      });
      const { valid } = validateCategories(raw, todo.map((p) => p.id));
      for (const [id, v] of valid) done.set(id, { categories: v.categories, source: "gemini", reason: v.reason || null });
    } catch {
      // A failed call counts as "nothing usable this round"; the retry or the topic table takes over.
    }
    todo = todo.filter((p) => !done.has(p.id));
  }
  return { done, failed: todo };
}

/**
 * Returns a classification for every product. `usedFallback` is true when any product had to use the
 * topic table, so the page can say so. With no Gemini function at all, everything uses the table.
 */
export async function classifyProducts(
  products: Product[],
  gen: GeminiFn | null,
  options: Options = {},
): Promise<{ results: Map<string, Classification>; usedFallback: boolean }> {
  const results = new Map<string, Classification>();
  const size = options.batchSize ?? 45;
  const delay = options.retryDelayMs ?? 1500;
  const batches: Product[][] = [];
  for (let i = 0; i < products.length; i += size) batches.push(products.slice(i, i + size));

  const failed: Product[] = [];
  if (gen) {
    // Batches run side by side (6 at a time at most) to stay quick without flooding the rate limit.
    const limit = options.concurrency ?? 6;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, batches.length) }, async () => {
        while (next < batches.length) {
          const batch = batches[next++];
          const r = await classifyBatch(batch, gen, delay);
          r.done.forEach((v, k) => results.set(k, v));
          failed.push(...r.failed);
        }
      }),
    );
  } else {
    failed.push(...products);
  }

  for (const p of failed) {
    results.set(p.id, { categories: categoriesFromTopics(p.topics), source: "topic", reason: null });
  }
  return { results, usedFallback: failed.length > 0 };
}
