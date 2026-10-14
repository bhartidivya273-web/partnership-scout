// Everything the results workspace does to the list on screen: sort, filter, group, summarise and
// recommend. Pure functions over the rows the server sent, so each control provably has an effect.
import type { CategoryKey } from "./categories";
import type { Decision, DecisionStatus } from "./decisions";
import { isClosingSoon } from "./format";
import type { ResultItem } from "./result";
import type { Fit } from "./validate";

export type SortMode = "priority" | "relevance" | "votes" | "maker" | "newest" | "closing";
export const SORT_LABELS: Record<SortMode, string> = {
  priority: "Priority (default)",
  relevance: "Relevance to async standups",
  votes: "Upvotes",
  maker: "Maker engagement",
  newest: "Most recent launch",
  closing: "Closing soon",
};

const FIT_ORDER: Record<string, number> = { strong: 0, partial: 1, weak: 2, none: 3 };
const fitOrder = (fit: Fit | null) => FIT_ORDER[fit ?? "none"];

/** Re-orders the rows. Ranks never change: they always show the priority order. */
export function sortItems(items: ResultItem[], mode: SortMode): ResultItem[] {
  const byRank = (a: ResultItem, b: ResultItem) => a.rank - b.rank;
  const cmp: Record<SortMode, (a: ResultItem, b: ResultItem) => number> = {
    priority: byRank,
    relevance: (a, b) => fitOrder(a.fit) - fitOrder(b.fit) || b.priority.parts.relevance.value - a.priority.parts.relevance.value || byRank(a, b),
    votes: (a, b) => b.upvotes - a.upvotes || byRank(a, b),
    maker: (a, b) => b.makerComments - a.makerComments || byRank(a, b),
    newest: (a, b) => a.daysSinceLaunch - b.daysSinceLaunch || Date.parse(b.launchedAt) - Date.parse(a.launchedAt) || byRank(a, b),
    closing: (a, b) => a.daysLeft - b.daysLeft || byRank(a, b),
  };
  return [...items].sort(cmp[mode]);
}

export type AgeFilter = "any" | "1" | "3";
export type EvidenceFilter = "0" | "3" | "5";
export type StatusFilter = "all" | "new" | DecisionStatus;

export type Filters = {
  category: CategoryKey | "all";
  age: AgeFilter;
  evidence: EvidenceFilter;
  status: StatusFilter;
};
export const NO_FILTERS: Filters = { category: "all", age: "any", evidence: "0", status: "all" };
export const hasActiveFilters = (f: Filters) => f.category !== "all" || f.age !== "any" || f.evidence !== "0" || f.status !== "all";

export function filterItems(items: ResultItem[], f: Filters, decisions: Record<string, Decision>): ResultItem[] {
  return items.filter((i) => {
    if (f.category !== "all" && !i.categories.includes(f.category)) return false;
    if (f.age !== "any" && i.daysSinceLaunch > Number(f.age)) return false;
    if (i.evidence.count < Number(f.evidence)) return false;
    const status = decisions[i.id]?.status ?? "none";
    if (f.status === "new" && status !== "none") return false;
    if ((f.status === "shortlisted" || f.status === "contacted") && status !== f.status) return false;
    return true;
  });
}

const FIT_KEYS = ["strong", "partial", "weak", null] as const;

/** Bunches rows by fit (strong first), keeping the given order inside each bunch; empty bunches are left out. */
export function groupByFit(items: ResultItem[]): Array<{ fit: Fit | null; items: ResultItem[] }> {
  return FIT_KEYS.map((fit) => ({ fit, items: items.filter((i) => i.fit === fit) })).filter((g) => g.items.length > 0);
}

export function summaryCounts(items: ResultItem[], decisions: Record<string, Decision>) {
  return {
    strong: items.filter((i) => i.fit === "strong").length,
    partial: items.filter((i) => i.fit === "partial").length,
    weak: items.filter((i) => i.fit === "weak").length,
    unrated: items.filter((i) => i.fit === null).length,
    closing: items.filter((i) => isClosingSoon(i.daysLeft)).length,
    shortlisted: items.filter((i) => decisions[i.id]?.status === "shortlisted").length,
    contacted: items.filter((i) => decisions[i.id]?.status === "contacted").length,
  };
}

export type Action = { label: string; tone: "go" | "soon" | "maybe" | "low" | "check" };

/** The one-line recommended next step, from the fit, the time left and what is known about the founder. */
export function recommendedAction(i: ResultItem): Action {
  const find = i.founder.founderSource === "none" ? " Find the maker on the product page first." : "";
  const left = i.daysLeft <= 0 ? "window closes today" : `${i.daysLeft} day${i.daysLeft === 1 ? "" : "s"} left`;
  if (i.fit === "weak") return { label: "Low priority: overlap is limited. Only a light note if you have time." + find, tone: "low" };
  if (i.fit === null) return { label: "Check the fit yourself before contacting: the AI could not rate it." + find, tone: "check" };
  if (isClosingSoon(i.daysLeft)) return { label: `Contact today: ${left} in the outreach window.${find}`, tone: "soon" };
  if (i.fit === "strong") return { label: `Contact this week: strong fit, ${left}.${find}`, tone: "go" };
  return { label: `Worth a short note: partial fit, ${left}.${find}`, tone: "maybe" };
}
