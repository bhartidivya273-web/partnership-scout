// What the server sends to the browser. Deliberately small: no descriptions, no raw maker lists,
// and nothing secret, so the whole object is safe to show.
import type { CategoryKey } from "./categories";
import type { Fit } from "./validate";

export type Source = "live" | "cached" | "saved" | "snapshot";
export type Note = "partial" | "category_topic" | "refresh_in_progress" | "quota_low" | "live_failed";
export type Step = "fetch" | "categorize" | "rank" | "angles";
export type ErrorCode = "no_category" | "no_data" | "token" | "generic";

export type ResultItem = {
  rank: number;
  id: string;
  name: string;
  tagline: string;
  productHuntUrl: string;
  websiteUrl: string | null;
  founder: { label: string; founderSource: "named" | "none"; hiddenCount: number; totalMakers: number };
  upvotes: number;
  makerComments: number;
  daysSinceLaunch: number;
  daysLeft: number;
  launchedAt: string;
  score: { votesPart: number; makerPart: number; total: number };
  categories: CategoryKey[];
  categorySource: "gemini" | "topic";
  fit: Fit | null;
  angle: string;
  angleSource: "gemini" | "template";
};

export type ScoutResult = {
  source: Source;
  dataAsOf: string;
  windowStart: string;
  windowEnd: string;
  scanned: number;
  inCategories: number;
  shown: number;
  categories: CategoryKey[];
  weights: { votes: number; maker: number };
  items: ResultItem[];
  notes: Note[];
  run: {
    pages: number | null;
    seconds: number;
    quotaRemaining: number | null;
    categoryMethod: "ai" | "tags" | "mixed";
    angleMethod: "ai" | "template" | "mixed";
    model: string;
    store: "redis" | "memory";
  };
};

export type ScoutEvent =
  | { type: "step"; step: Step }
  | { type: "result"; result: ScoutResult }
  | { type: "error"; code: ErrorCode; message: string };
