// The deterministic "why": plain sentences built from the numbers and labels, never written by AI.
import { launchedText, closesText } from "./format";
import type { PrioritisedProduct } from "./priority";
import type { ClassifiedProduct } from "./types";

export function explain(p: PrioritisedProduct<ClassifiedProduct>, candidates: number): string[] {
  const why: string[] = [];
  why.push(`Priority ${p.priority.total} out of 100: #${p.rank} of ${candidates} candidates in your categories.`);
  why.push(`${p.upvotes.toLocaleString("en-US")} votes (Product Hunt score), #${p.votesRank} of ${candidates} by votes.`);
  why.push(`${p.makerComments.toLocaleString("en-US")} maker comments (per Product Hunt), #${p.makerRank} of ${candidates}.`);
  why.push(`${launchedText(p.daysSinceLaunch)}; ${closesText(p.daysLeft).toLowerCase()}.`);
  if (p.fitInfo) why.push(`AI fit rating: ${p.fitInfo.fit}. ${p.fitInfo.relevance}`);
  else why.push("Fit was not rated, so relevance counts as neutral in the ranking.");
  const rankBits = [p.dailyRank ? `#${p.dailyRank} of the day` : null, p.weeklyRank ? `#${p.weeklyRank} of the week` : null].filter(Boolean);
  if (rankBits.length) why.push(`Product Hunt's own ranking: ${rankBits.join(", ")}.`);
  if (p.reviewsCount > 0 && p.reviewsRating) why.push(`${p.reviewsCount} Product Hunt review${p.reviewsCount === 1 ? "" : "s"}, average ${p.reviewsRating} out of 5.`);
  return why;
}
