// Small text helpers for the page, kept pure so they can be tested.
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const launchedText = (days: number) => (days <= 0 ? "Launched today" : `Launched ${plural(days, "day")} ago`);
export const closesText = (daysLeft: number) => (daysLeft <= 0 ? "Closes today" : `Closes in ${plural(daysLeft, "day")}`);
export const isClosingSoon = (daysLeft: number) => daysLeft <= 2;

export const minutesAgo = (iso: string, now: Date): number => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));

export const formatDateTime = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(iso));

export const formatInt = (n: number): string => new Intl.NumberFormat("en-US").format(Math.round(n));
export const oneDecimal = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/** The two contributions that add up to the score, so the breakdown can be checked by eye. */
export function breakdownParts(score: { votesPart: number; makerPart: number }, weights: { votes: number; maker: number }) {
  return { votes: 100 * weights.votes * score.votesPart, maker: 100 * weights.maker * score.makerPart };
}

export type SortMode = "score" | "closing" | "newest";

/** Re-orders the rows already on screen; ranks stay as the score order set by the server. */
export function sortRows<T extends { rank: number; daysLeft: number; daysSinceLaunch: number }>(rows: T[], mode: SortMode): T[] {
  const copy = [...rows];
  if (mode === "closing") copy.sort((a, b) => a.daysLeft - b.daysLeft || a.rank - b.rank);
  else if (mode === "newest") copy.sort((a, b) => a.daysSinceLaunch - b.daysSinceLaunch || a.rank - b.rank);
  else copy.sort((a, b) => a.rank - b.rank);
  return copy;
}

/** Reads the server's line-by-line JSON stream, however the bytes happen to be chunked. */
export function createLineParser(onLine: (line: string) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (line) onLine(line);
      }
    },
    end() {
      if (buffer.trim()) onLine(buffer.trim());
      buffer = "";
    },
  };
}

export type FitKey = "strong" | "partial" | "weak" | null;
const FIT_ORDER: FitKey[] = ["strong", "partial", "weak", null];

/** Bunches rows by fit (strong first), keeping the chosen order inside each bunch; empty bunches are left out. */
export function groupByFit<T extends { fit: FitKey }>(rows: T[]): Array<{ fit: FitKey; rows: T[] }> {
  return FIT_ORDER.map((fit) => ({ fit, rows: rows.filter((r) => r.fit === fit) })).filter((g) => g.rows.length > 0);
}

/** The one-line overview: how many of each fit, and how many windows close within 2 days. */
export function summaryCounts(rows: Array<{ fit: FitKey; daysLeft: number }>) {
  return {
    strong: rows.filter((r) => r.fit === "strong").length,
    partial: rows.filter((r) => r.fit === "partial").length,
    weak: rows.filter((r) => r.fit === "weak").length,
    unrated: rows.filter((r) => r.fit === null).length,
    closing: rows.filter((r) => isClosingSoon(r.daysLeft)).length,
  };
}
