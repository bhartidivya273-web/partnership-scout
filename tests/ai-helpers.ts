import type { GeminiFn } from "@/lib/gemini";
import type { ClassifiedProduct, Product } from "@/lib/types";

export function product(id: string, over: Partial<Product> = {}): Product {
  return {
    id,
    name: `Product ${id}`,
    tagline: `Tagline ${id}`,
    description: `Description of product ${id}`,
    productHuntUrl: "",
    websiteUrl: null,
    launchedAt: "2026-10-10T00:00:00Z",
    daysSinceLaunch: 1,
    daysLeft: 6,
    upvotes: 10,
    totalComments: 1,
    makerComments: 1,
    founder: { label: "Founder not listed", founderSource: "none", visibleMakers: [], hiddenCount: 0, totalMakers: 0 },
    topics: [],
    flags: [],
    ...over,
  };
}

export const classified = (id: string, over: Partial<ClassifiedProduct> = {}): ClassifiedProduct => ({
  ...product(id),
  categories: ["team_communication"],
  categorySource: "gemini",
  categoryReason: null,
  ...over,
});

/** A fake Gemini that answers from a list of canned responses (a function or a value) and counts calls. */
export function scripted(...responses: Array<unknown | ((req: Parameters<GeminiFn>[0]) => unknown)>) {
  const calls: Array<Parameters<GeminiFn>[0]> = [];
  const gen: GeminiFn = async (req) => {
    calls.push(req);
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    const value = typeof r === "function" ? (r as (q: typeof req) => unknown)(req) : r;
    if (value instanceof Error) throw value;
    return value;
  };
  return { gen, calls };
}
