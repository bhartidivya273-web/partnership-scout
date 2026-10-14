// Job B2: structured outreach for the final top products: the connection, a partnership hypothesis,
// an opening message, one question and a caveat. Every field is checked in code; anything that fails
// after one retry becomes a clearly labelled template built only from the product's own listing.
import type { CategoryKey } from "./categories";
import type { GeminiFn } from "./gemini";
import { dataBlock, outreachSystem, sourceText } from "./prompts";
import type { ClassifiedProduct } from "./types";
import { bannedHit, claimsHit, inventedNumber, isGrounded, mostlyNotEnglish, sameText, tidy, trimToSentences, words, type Fit } from "./validate";

export type Outreach = {
  connection: string;
  hypothesis: string;
  message: string;
  question: string;
  caveat: string;
  source: "gemini" | "template";
};

export type OutreachInput = ClassifiedProduct & { fit: Fit | null; founderName: string | null };

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      connection: { type: "STRING" },
      hypothesis: { type: "STRING" },
      message: { type: "STRING" },
      question: { type: "STRING" },
      caveat: { type: "STRING" },
    },
    required: ["id", "connection", "hypothesis", "message", "question", "caveat"],
  },
};

// [min words, max words] per field (a little slack over the prompt's limits before we act)
const LIMITS = { connection: [6, 50], hypothesis: [6, 60], message: [35, 100], question: [4, 30], caveat: [5, 45] } as const;
type Field = keyof typeof LIMITS;
const FIELDS = Object.keys(LIMITS) as Field[];

const firstName = (full: string | null) => (full ? full.trim().split(/\s+/)[0] : null);

export type OutreachCheck = { value: Omit<Outreach, "source"> | null; problems: string[] };

/** `source` is everything the model saw for this product plus Kavya's own description. */
export function checkOutreach(raw: unknown, source: string, input: { name: string; fit: Fit | null; founderName: string | null }): OutreachCheck {
  const o = (raw ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const v = {} as Record<Field, string>;

  for (const f of FIELDS) {
    let text = tidy(typeof o[f] === "string" ? (o[f] as string) : "");
    if (!text) {
      problems.push(`${f}:empty`);
      v[f] = "";
      continue;
    }
    const [min, max] = LIMITS[f];
    if (words(text).length > max) {
      const trimmed = f === "question" ? null : trimToSentences(text, max);
      if (trimmed) text = trimmed;
      else problems.push(`${f}:too_long`);
    }
    if (words(text).length < min) problems.push(`${f}:too_short`);
    if (bannedHit(text)) problems.push(`${f}:banned_phrase`);
    if (claimsHit(text)) problems.push(`${f}:unsupported_claim`);
    if (inventedNumber(text, source)) problems.push(`${f}:invented_number`);
    if (mostlyNotEnglish(text)) problems.push(`${f}:not_english`);
    if (/\[[^\]]*\]|\{[^}]*\}|<[^>]+>/.test(text)) problems.push(`${f}:placeholder`);
    if (/\[redacted\]/i.test(text)) problems.push(`${f}:redacted_text`);
    v[f] = text;
  }

  if (v.question && !(v.question.endsWith("?") && (v.question.match(/\?/g) ?? []).length === 1)) problems.push("question:not_one_question");
  if (!isGrounded(`${v.connection} ${v.message}`, source, input.name)) problems.push("connection:not_grounded");
  if (input.fit === "weak" && v.connection && !/limited|little|loose|light[- ]touch|not (?:a )?(?:direct|obvious)|modest/i.test(v.connection)) {
    problems.push("connection:weak_fit_not_honest");
  }
  // A greeting may use only the founder's real first name (or a neutral word): never an invented one.
  const greeting = v.message.match(/^(?:[Hh]i|[Hh]ello|[Hh]ey)[,\s]+([A-Z][a-z]+)/);
  if (greeting) {
    const ok = ["There", "Team", "Folks"].includes(greeting[1]) || greeting[1] === firstName(input.founderName);
    if (!ok) problems.push("message:invented_name");
  }
  return { value: problems.length === 0 ? { ...v } : null, problems };
}

const CATEGORY_BITS: Record<CategoryKey | "none", { connection: string; hypothesis: string; question: string }> = {
  project_management: {
    connection: "{name} sits close to how teams plan and track work, so async standup updates could sit alongside its task views.",
    hypothesis: "An integration or co-marketing note could show each person's async standup next to the work in {name}.",
    question: "Do your users already run a daily check-in alongside {name}, and how do they do it today?",
  },
  hr_tech: {
    connection: "{name} serves people and hiring teams, which are often remote, so a joint note for distributed teams might fit.",
    hypothesis: "A joint post or webinar for remote people teams could link {name} with async team check-ins.",
    question: "How do your customers keep distributed teams in sync between formal reviews?",
  },
  developer_productivity: {
    connection: "{name} helps developers work faster, and engineering teams already run daily check-ins that could be written instead of spoken.",
    hypothesis: "A standup integration or a joint content piece could show engineering teams how to cut status meetings.",
    question: "Where do your users currently record daily progress and blockers?",
  },
  team_communication: {
    connection: "{name} is part of how teams communicate, and async standups are a natural neighbour for remote teams.",
    hypothesis: "A cross-promotion or a small integration could bring written standups into the flow of {name}.",
    question: "How do your users handle daily status updates today, apart from live meetings?",
  },
  none: {
    connection: "{name} launched recently on Product Hunt; the overlap with async standups is unclear, so keep any contact light.",
    hypothesis: "If remote teams use {name}, a short audience-swap note might be worth testing.",
    question: "Do remote teams make up a large part of your users?",
  },
};

export function templateOutreach(p: Pick<OutreachInput, "name" | "tagline" | "categories" | "founderName">): Outreach {
  const bits = CATEGORY_BITS[p.categories[0] ?? "none"];
  const fill = (t: string) => t.replace(/\{name\}/g, () => p.name);
  const tagline = p.tagline.trim().replace(/[.!?]+$/, "");
  const greet = firstName(p.founderName) ?? "there";
  return {
    connection: fill(bits.connection),
    hypothesis: fill(bits.hypothesis),
    message:
      `Hi ${greet}, I work on an async standup tool for remote teams. ${p.name}${tagline ? ` (${tagline})` : ""} looks related to how your users work. ` +
      `My hypothesis is that a small integration or a joint post could help both of us reach remote teams. Would a short chat make sense? Kavya`,
    question: fill(bits.question),
    caveat: `Template, not AI-written: read ${p.name}'s Product Hunt page first to confirm what it does today and whether it already connects to standup tools.`,
    source: "template",
  };
}

type Options = { retryDelayMs?: number; batchSize?: number; concurrency?: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function writeOutreach(
  products: OutreachInput[],
  kavyaProduct: string,
  gen: GeminiFn | null,
  options: Options = {},
): Promise<Map<string, Outreach>> {
  const out = new Map<string, Outreach>();
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const sources = new Map(products.map((p) => [p.id, `${sourceText(p)} ${kavyaProduct}`]));
  const usedConnections: string[] = [];
  const usedMessages: string[] = [];
  const size = options.batchSize ?? 5; // small parallel batches finish sooner than one long answer
  let todo = products;

  for (let attempt = 0; gen && attempt < 2 && todo.length > 0; attempt++) {
    if (attempt > 0) await sleep(options.retryDelayMs ?? 1500);
    const batches: OutreachInput[][] = [];
    for (let i = 0; i < todo.length; i += size) batches.push(todo.slice(i, i + size));
    const answers = await Promise.all(
      batches.map(async (batch) => {
        try {
          return (await gen({
            system: outreachSystem(kavyaProduct),
            user: `Prepare outreach for these products.\n${dataBlock(batch)}`,
            schema: SCHEMA,
            attempt,
          })) as unknown;
        } catch {
          return null; // nothing usable from this batch this round
        }
      }),
    );
    const byId = new Map<string, unknown>();
    for (const raw of answers) {
      for (const item of Array.isArray(raw) ? raw : []) {
        const id = String((item as { id?: unknown })?.id ?? "");
        if (!byId.has(id)) byId.set(id, item);
      }
    }
    for (const p of todo) {
      const check = checkOutreach(byId.get(p.id), sources.get(p.id) ?? "", p);
      if (!check.value) continue;
      // Two products must never get the same words: ask again for the later one.
      if (usedConnections.some((c) => sameText(c, check.value!.connection)) || usedMessages.some((m) => sameText(m, check.value!.message))) continue;
      usedConnections.push(check.value.connection);
      usedMessages.push(check.value.message);
      out.set(p.id, { ...check.value, source: "gemini" });
    }
    todo = todo.filter((p) => !out.has(p.id));
  }

  for (const p of todo) out.set(p.id, templateOutreach(byProduct.get(p.id)!));
  return out;
}
