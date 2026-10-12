// Job B: a product-specific outreach angle plus a fit rating, for the products being shown only.
// Anything Gemini cannot deliver cleanly falls back to a labelled template (never invented text).
import type { CategoryKey } from "./categories";
import type { GeminiFn } from "./gemini";
import { angleSystem, dataBlock, sourceText } from "./prompts";
import type { ClassifiedProduct } from "./types";
import { checkAngle, sameAngle, type Fit } from "./validate";

export type Angle = { angle: string; angleSource: "gemini" | "template"; fit: Fit | null };

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      fit: { type: "STRING", enum: ["strong", "partial", "weak"] },
      angle: { type: "STRING" },
    },
    required: ["id", "fit", "angle"],
  },
};

const TEMPLATES: Record<CategoryKey | "none", string> = {
  project_management:
    "{name} ({tagline}) sits close to how teams plan and track work. Async standup updates could sit alongside its task views, so an integration or co-marketing note may be worth exploring.",
  hr_tech:
    "{name} ({tagline}) serves people and hiring teams, which often work remotely. A joint note for distributed teams may be worth exploring.",
  developer_productivity:
    "{name} ({tagline}) helps developers work faster. Engineering teams already run daily check-ins, so a standup integration or joint content piece may be worth exploring.",
  team_communication:
    "{name} ({tagline}) is part of how teams communicate. Async standups are a natural neighbour, so a cross-promotion or integration conversation may be worth exploring.",
  none: "{name} ({tagline}) launched recently on Product Hunt. Check whether remote teams use it before reaching out.",
};

export function templateAngle(p: Pick<ClassifiedProduct, "name" | "tagline" | "categories">): string {
  const template = TEMPLATES[p.categories[0] ?? "none"];
  const tagline = p.tagline.trim().replace(/[.!?]+$/, "");
  // Function replacers insert the text literally, so a product name like "A$&B" cannot garble the template.
  return template
    .replace("{name}", () => p.name)
    .replace(" ({tagline})", () => (tagline ? ` (${tagline})` : ""))
    .replace("{tagline}", () => tagline);
}

type Options = { retryDelayMs?: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Two tries at most: the second only asks again for the items that failed their checks. */
export async function writeAngles(
  products: ClassifiedProduct[],
  kavyaProduct: string,
  gen: GeminiFn | null,
  options: Options = {},
): Promise<Map<string, Angle>> {
  const out = new Map<string, Angle>();
  const partialFit = new Map<string, { angle: string; fit: Fit | null }>(); // good angle, bad fit
  const sources = new Map(products.map((p) => [p.id, sourceText(p)]));
  const used: string[] = []; // angles accepted so far, to catch duplicates
  let todo = products;

  for (let attempt = 0; gen && attempt < 2 && todo.length > 0; attempt++) {
    if (attempt > 0) await sleep(options.retryDelayMs ?? 1500);
    let raw: unknown;
    try {
      raw = await gen({
        system: angleSystem(kavyaProduct),
        user: `Write angles for these products.\n${dataBlock(todo)}`,
        schema: SCHEMA,
        attempt,
      });
    } catch {
      continue; // nothing usable this round
    }
    const byId = new Map<string, unknown>();
    for (const item of Array.isArray(raw) ? raw : []) {
      const id = String((item as { id?: unknown })?.id ?? "");
      if (!byId.has(id)) byId.set(id, item);
    }
    for (const p of todo) {
      const check = checkAngle(byId.get(p.id), sources.get(p.id) ?? "");
      if (!check.angle) continue;
      if (used.some((u) => sameAngle(u, check.angle as string))) continue; // duplicate: ask again
      if (check.problems.length === 0) {
        out.set(p.id, { angle: check.angle, angleSource: "gemini", fit: check.fit });
        used.push(check.angle);
      } else {
        partialFit.set(p.id, { angle: check.angle, fit: null }); // only the fit was bad
      }
    }
    todo = todo.filter((p) => !out.has(p.id));
  }

  for (const p of todo) {
    const half = partialFit.get(p.id);
    // After the retry, a clean angle with an unusable fit is kept and the fit is left empty (D3.3).
    if (half && !used.some((u) => sameAngle(u, half.angle))) {
      out.set(p.id, { angle: half.angle, angleSource: "gemini", fit: null });
      used.push(half.angle);
    } else {
      out.set(p.id, { angle: templateAngle(p), angleSource: "template", fit: null });
    }
  }
  return out;
}
