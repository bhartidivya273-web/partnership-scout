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

/** Only plain web links are ever rendered as links: a launch listing is outside data and may hold anything. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A Twitter/X handle becomes a link only if it is a plain handle. */
export const twitterUrl = (handle: string | null | undefined): string | null => (handle && /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `https://x.com/${handle}` : null);

export function ageText(minutes: number): string {
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
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
