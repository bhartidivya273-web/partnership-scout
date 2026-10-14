// The explainable priority score. Two parts, kept visibly separate on purpose:
//   1. the assignment's CORE score: votes and maker comments (log-scaled, 50/50), from scoring.ts;
//   2. documented ENHANCEMENTS: relevance, launch momentum, time left in the window, evidence.
// All arithmetic is plain code. The only AI input is the fit rating, which is a label, not a number.
import { evidenceChecks, evidenceCount, EVIDENCE_TOTAL, type EvidenceCheck } from "./evidence";
import { rankPool } from "./scoring";
import type { ClassifiedProduct } from "./types";
import type { Fit } from "./validate";

export type PriorityKey = "votes" | "maker" | "momentum" | "relevance" | "window" | "evidence";
export type PriorityWeights = Record<PriorityKey, number>;

export const PRIORITY_KEYS: PriorityKey[] = ["votes", "maker", "momentum", "relevance", "window", "evidence"];

export const PRIORITY_LABELS: Record<PriorityKey, string> = {
  votes: "Votes (Product Hunt score)",
  maker: "Maker comments (per Product Hunt)",
  momentum: "Momentum (votes per day since launch)",
  relevance: "Relevance to async standups",
  window: "Time left in the 7-day window",
  evidence: "Evidence completeness",
};

/** Weights are points out of 100 and always sum to 100. */
export const PRESETS = {
  balanced: { votes: 20, maker: 20, momentum: 10, relevance: 30, window: 10, evidence: 10 },
  engagement: { votes: 35, maker: 35, momentum: 15, relevance: 5, window: 5, evidence: 5 },
  fit: { votes: 12, maker: 12, momentum: 6, relevance: 50, window: 10, evidence: 10 },
} as const satisfies Record<string, PriorityWeights>;

export type PresetName = keyof typeof PRESETS;
export const DEFAULT_PRESET: PresetName = "balanced";
export const isPreset = (v: unknown): v is PresetName => typeof v === "string" && v in PRESETS;

/** Relevance value per fit label. Unrated is neutral-low, never a free pass. */
export const RELEVANCE_VALUE: Record<Fit, number> = { strong: 1, partial: 0.6, weak: 0.2 };
export const UNRATED_RELEVANCE = 0.4;

/** Custom weights are clamped to non-negative numbers and rescaled to 100; anything unusable becomes the default. */
export function normaliseWeights(w: Partial<Record<PriorityKey, unknown>> | null | undefined): PriorityWeights {
  const clean = PRIORITY_KEYS.map((k) => {
    const n = Number(w?.[k]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const sum = clean.reduce((a, b) => a + b, 0);
  if (sum === 0) return { ...PRESETS[DEFAULT_PRESET] };
  return Object.fromEntries(PRIORITY_KEYS.map((k, i) => [k, (clean[i] / sum) * 100])) as PriorityWeights;
}

export type FitInfo = { fit: Fit; relevance: string };

export type PriorityPart = { value: number; weight: number; points: number };

export type PriorityScore = {
  /** 0 to 100, one decimal: exactly what the page shows. */
  total: number;
  parts: Record<PriorityKey, PriorityPart>;
  weights: PriorityWeights;
};

export type CoreScore = { votesPart: number; makerPart: number; total: number };

export type PrioritisedProduct<T> = T & {
  rank: number;
  priority: PriorityScore;
  core: CoreScore;
  votesRank: number;
  makerRank: number;
  evidence: EvidenceCheck[];
  evidenceCount: number;
  fitInfo: FitInfo | null;
};

const logShare = (x: number, max: number) => (max <= 0 ? 0 : Math.log1p(Math.max(0, x)) / Math.log1p(max));
const tenths = (n: number) => Math.round(n * 10);
const competitionRank = (mine: number, all: number[]) => 1 + all.filter((v) => v > mine).length;

/**
 * Ranks the candidate pool. Maxima are taken over this pool, so a priority score is only comparable
 * inside one run and one category selection (same rule as the core score).
 */
export function rankByPriority<T extends ClassifiedProduct>(
  pool: T[],
  fits: Map<string, FitInfo>,
  weightsInput?: Partial<Record<PriorityKey, unknown>> | PresetName | null,
): Array<PrioritisedProduct<T>> {
  const weights = typeof weightsInput === "string" ? { ...PRESETS[isPreset(weightsInput) ? weightsInput : DEFAULT_PRESET] } : normaliseWeights(weightsInput);
  const core = new Map(rankPool(pool).map((p) => [p.id, p.score]));
  const velocity = (p: T) => p.upvotes / (p.daysSinceLaunch + 1);
  const maxVelocity = pool.reduce((m, p) => Math.max(m, velocity(p)), 0);
  const allVotes = pool.map((p) => p.upvotes);
  const allMaker = pool.map((p) => p.makerComments);

  const scored = pool.map((p) => {
    const c = core.get(p.id)!;
    const fitInfo = fits.get(p.id) ?? null;
    const evidence = evidenceChecks(p, Boolean(fitInfo));
    const values: Record<PriorityKey, number> = {
      votes: c.votesPart,
      maker: c.makerPart,
      momentum: logShare(velocity(p), maxVelocity),
      relevance: fitInfo ? RELEVANCE_VALUE[fitInfo.fit] : UNRATED_RELEVANCE,
      window: Math.min(1, Math.max(0, p.daysLeft / 7)),
      evidence: evidenceCount(evidence) / EVIDENCE_TOTAL,
    };
    const parts = Object.fromEntries(
      PRIORITY_KEYS.map((k) => [k, { value: values[k], weight: weights[k], points: weights[k] * values[k] }]),
    ) as Record<PriorityKey, PriorityPart>;
    const total = tenths(PRIORITY_KEYS.reduce((sum, k) => sum + parts[k].points, 0)) / 10;
    return {
      ...p,
      rank: 0,
      priority: { total, parts, weights },
      core: { votesPart: c.votesPart, makerPart: c.makerPart, total: c.total },
      votesRank: competitionRank(p.upvotes, allVotes),
      makerRank: competitionRank(p.makerComments, allMaker),
      evidence,
      evidenceCount: evidenceCount(evidence),
      fitInfo,
    };
  });

  // Ties are decided on the one-decimal score the user sees, then the assignment's own signals.
  scored.sort(
    (a, b) =>
      tenths(b.priority.total) - tenths(a.priority.total) ||
      tenths(b.core.total) - tenths(a.core.total) ||
      b.makerComments - a.makerComments ||
      b.upvotes - a.upvotes ||
      Date.parse(b.launchedAt) - Date.parse(a.launchedAt) ||
      a.id.localeCompare(b.id),
  );
  return scored.map((p, i) => ({ ...p, rank: i + 1 }));
}
