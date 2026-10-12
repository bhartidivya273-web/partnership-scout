// Product Hunt hides most makers from outside apps (name and username come back as
// "[REDACTED]" and the id as 0). This module decides who counts as visible and what to show.
export type RawMaker = {
  id?: string | number | null;
  name?: string | null;
  username?: string | null;
  headline?: string | null;
  twitterUsername?: string | null;
  websiteUrl?: string | null;
};

export type VisibleMaker = {
  name: string;
  username: string | null;
  headline: string | null;
  twitterUsername: string | null;
  websiteUrl: string | null;
};

export type Founder = {
  label: string; // exactly what the page shows
  founderSource: "named" | "none";
  visibleMakers: VisibleMaker[];
  hiddenCount: number;
  totalMakers: number;
};

const isRedacted = (v: string | null | undefined) => (v ?? "").trim().toUpperCase() === "[REDACTED]";

export function isHiddenMaker(m: RawMaker): boolean {
  const name = (m.name ?? "").trim();
  if (!name || isRedacted(name)) return true;
  if (isRedacted(m.username)) return true;
  return String(m.id ?? "").trim() === "0";
}

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s && !isRedacted(s) ? s : null;
}

/** First visible maker (not first listed) plus "+N more"; "Founder not listed" if none is visible. */
export function resolveFounder(makers: RawMaker[] | null | undefined): Founder {
  const list = makers ?? [];
  const visibleMakers: VisibleMaker[] = list
    .filter((m) => !isHiddenMaker(m))
    .map((m) => ({
      name: (m.name as string).trim(),
      username: clean(m.username),
      headline: clean(m.headline),
      twitterUsername: clean(m.twitterUsername),
      websiteUrl: clean(m.websiteUrl),
    }));
  const hiddenCount = list.length - visibleMakers.length;

  if (visibleMakers.length === 0) {
    return { label: "Founder not listed", founderSource: "none", visibleMakers, hiddenCount, totalMakers: list.length };
  }
  const more = list.length - 1;
  const label = more > 0 ? `${visibleMakers[0].name} +${more} more` : visibleMakers[0].name;
  return { label, founderSource: "named", visibleMakers, hiddenCount, totalMakers: list.length };
}
