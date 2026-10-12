// Scoring engine (PRD Section 8). Pure functions: no network, no clock, so re-ranking with new
// weights is instant and never touches Product Hunt.
import type { Product } from "./types";

export type Weights = { votes: number; maker: number };

export type Score = {
  /** Share of the pool's best votes, 0 to 1 (log-scaled). */
  votesPart: number;
  /** Share of the pool's best maker-comment count, 0 to 1 (log-scaled). */
  makerPart: number;
  /** 0 to 100, rounded to one decimal, exactly what the page shows. */
  total: number;
  /** The normalised weights actually used (they sum to 1). */
  weights: Weights;
};

export type RankedProduct = Product & { rank: number; score: Score };

export const DEFAULT_WEIGHTS: Weights = { votes: 0.5, maker: 0.5 };

const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Slider values in, weights that sum to 1 out. Both at 0 means "no preference", so 50/50. */
export function normaliseWeights(w: Weights): Weights {
  const votes = clean(w.votes);
  const maker = clean(w.maker);
  const sum = votes + maker;
  if (sum === 0) return { ...DEFAULT_WEIGHTS };
  return { votes: votes / sum, maker: maker / sum };
}

/** ln(1+x) / ln(1+max): handles zero, squeezes huge values, and a zero maximum gives 0 for everyone. */
function logShare(x: number, max: number): number {
  if (max <= 0) return 0;
  return Math.log1p(Math.max(0, x)) / Math.log1p(max);
}

const tenths = (score: number) => Math.round(score * 10);

/**
 * Score and rank the whole candidate pool. Maxima come from the whole pool (not only the top 20),
 * so a score is comparable only inside one run and one category selection (PRD A6).
 * Ties are decided on the one-decimal score the user sees, then more maker comments, then more
 * votes, then the newer launch, so the order is always explainable from what is on screen.
 */
export function rankPool(pool: Product[], weights: Weights = DEFAULT_WEIGHTS): RankedProduct[] {
  const w = normaliseWeights(weights);
  const maxVotes = pool.reduce((m, p) => Math.max(m, clean(p.upvotes)), 0);
  const maxMaker = pool.reduce((m, p) => Math.max(m, clean(p.makerComments)), 0);

  const scored = pool.map((p) => {
    const votesPart = logShare(p.upvotes, maxVotes);
    const makerPart = logShare(p.makerComments, maxMaker);
    const total = tenths(100 * (w.votes * votesPart + w.maker * makerPart)) / 10;
    return { ...p, rank: 0, score: { votesPart, makerPart, total, weights: w } };
  });

  scored.sort(
    (a, b) =>
      tenths(b.score.total) - tenths(a.score.total) ||
      b.makerComments - a.makerComments ||
      b.upvotes - a.upvotes ||
      Date.parse(b.launchedAt) - Date.parse(a.launchedAt) ||
      a.id.localeCompare(b.id),
  );
  return scored.map((p, i) => ({ ...p, rank: i + 1 }));
}
