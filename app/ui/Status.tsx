"use client";

import { bannerSaved, COPY, statusLine } from "@/lib/copy";
import { ageText, formatDate, formatDateTime, minutesAgo } from "@/lib/format";
import type { ScoutResult } from "@/lib/result";

/** Data older than this is called stale on screen, whichever layer it came from. */
export const STALE_MINUTES = 60;

export function Status({ result, now }: { result: ScoutResult; now: number }) {
  const time = formatDateTime(result.dataAsOf);
  const age = now > 0 ? minutesAgo(result.dataAsOf, new Date(now)) : 0;
  const stale = now > 0 && age >= STALE_MINUTES;
  const badge =
    result.source === "live"
      ? COPY.STATUS_LIVE
      : result.source === "cached"
        ? `Recent result, updated ${ageText(age)} ago`
        : result.source === "saved"
          ? `Saved result from ${time}`
          : `Snapshot from ${time}`;
  const n = result.notes;
  const fallback = (result.source === "saved" || result.source === "snapshot") && n.includes("live_failed");
  return (
    <div className="status">
      <p>
        <span className={`source source-${result.source}`}>{badge}</span>{" "}
        <span className="muted">Data last updated {time}.</span>
      </p>
      <p>
        {statusLine({
          time,
          start: formatDate(result.windowStart),
          end: formatDate(result.windowEnd),
          scanned: result.scanned,
          inCategories: result.inCategories,
          shown: result.shown,
        })}
      </p>
      {stale && (
        <p className="banner" role="status">
          This data is {ageText(age)} old, so newer launches may be missing. {result.source === "live" || result.source === "cached" ? "Use Refresh data to fetch new ones." : "Product Hunt could not be reached to update it."}
        </p>
      )}
      {fallback && <p className="banner">{bannerSaved(time)}</p>}
      {n.includes("quota_low") && <p className="banner">{COPY.NOTE_QUOTA}</p>}
      {n.includes("refresh_in_progress") && <p className="banner">{COPY.NOTE_REFRESH}</p>}
      {n.includes("refresh_throttled") && <p className="banner">{COPY.NOTE_REFRESH_THROTTLED}</p>}
      {n.includes("partial") && <p className="banner">{COPY.NOTE_PARTIAL}</p>}
      {n.includes("category_topic") && <p className="banner">{COPY.NOTE_CATEGORY_TOPIC}</p>}
      {n.includes("fit_unrated") && <p className="banner">{COPY.NOTE_FIT_UNRATED}</p>}
      {n.includes("outreach_template") && <p className="banner">{COPY.NOTE_OUTREACH_TEMPLATE}</p>}
    </div>
  );
}
