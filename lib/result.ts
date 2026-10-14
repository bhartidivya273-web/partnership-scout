// What the server sends to the browser. Deliberately small: no descriptions and nothing secret, so the
// whole object is safe to show.
import type { CategoryKey } from "./categories";
import type { EvidenceCheck, Responsiveness } from "./evidence";
import type { Outreach } from "./outreach";
import type { PresetName, PriorityKey, PriorityWeights } from "./priority";
import type { Fit } from "./validate";

export type Source = "live" | "cached" | "saved" | "snapshot";
export type Note =
  | "partial"
  | "category_topic"
  | "fit_unrated"
  | "outreach_template"
  | "refresh_in_progress"
  | "refresh_throttled"
  | "quota_low"
  | "live_failed";
export type Step = "fetch" | "categorize" | "rank" | "fit" | "outreach";
export type ErrorCode = "no_category" | "no_data" | "token" | "generic";

export type MakerInfo = {
  name: string;
  username: string | null;
  headline: string | null;
  profileUrl: string | null;
  followersCount: number | null;
  twitterUsername: string | null;
  websiteUrl: string | null;
};

export type PriorityPartView = { value: number; weight: number; points: number };

export type ResultItem = {
  rank: number;
  id: string;
  name: string;
  tagline: string;
  productHuntUrl: string;
  websiteUrl: string | null;
  founder: { label: string; founderSource: "named" | "none"; hiddenCount: number; totalMakers: number; makers: MakerInfo[] };
  upvotes: number;
  makerComments: number;
  daysSinceLaunch: number;
  daysLeft: number;
  launchedAt: string;
  phRank: { daily: number | null; weekly: number | null };
  reviews: { count: number; rating: number | null };
  categories: CategoryKey[];
  categorySource: "gemini" | "topic";
  fit: Fit | null;
  relevance: string | null;
  priority: { total: number; parts: Record<PriorityKey, PriorityPartView> };
  core: { votesPart: number; makerPart: number; total: number };
  votesRank: number;
  makerRank: number;
  evidence: { checks: EvidenceCheck[]; count: number; total: number };
  responsiveness: Responsiveness;
  missing: string[];
  why: string[];
  outreach: Outreach;
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
  preset: PresetName | "custom";
  weights: PriorityWeights;
  items: ResultItem[];
  notes: Note[];
  /** Seconds until a forced refresh is allowed again (0 means it is allowed now). */
  refreshAfterSeconds: number;
  run: {
    pages: number | null;
    seconds: number;
    quotaRemaining: number | null;
    categoryMethod: "ai" | "tags" | "mixed";
    outreachMethod: "ai" | "template" | "mixed";
    model: string;
    store: "supabase" | "memory";
    shortlisted: number;
    timings: Partial<Record<Step, number>>;
  };
};

export type ScoutEvent =
  | { type: "step"; step: Step }
  | { type: "result"; result: ScoutResult }
  | { type: "error"; code: ErrorCode; message: string };
