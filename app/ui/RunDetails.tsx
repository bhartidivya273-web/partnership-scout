"use client";

import { COPY } from "@/lib/copy";
import { formatInt } from "@/lib/format";
import type { ScoutResult } from "@/lib/result";

export function RunDetails({ result }: { result: ScoutResult }) {
  const r = result.run;
  const t = r.timings;
  const secs = (ms?: number) => (ms === undefined ? null : `${Math.round(ms / 100) / 10} s`);
  const stages = [["Fetch / cache", t.fetch], ["Categories", t.categorize], ["Fit ratings", t.fit], ["Outreach", t.outreach]]
    .filter(([, ms]) => ms !== undefined)
    .map(([k, ms]) => `${k} ${secs(ms as number)}`)
    .join(" · ");
  const rows: Array<[string, string]> = [
    ["Pages fetched", r.pages === null ? "none (served from storage)" : String(r.pages)],
    ["Launches scanned", String(result.scanned)],
    ["In your categories", String(result.inCategories)],
    ["Rated for fit (shortlist)", String(r.shortlisted)],
    ["Category method", r.categoryMethod === "ai" ? "AI" : r.categoryMethod === "tags" ? "Product Hunt tags" : "Mixed"],
    ["Outreach method", r.outreachMethod === "ai" ? "AI" : r.outreachMethod === "template" ? "Template" : "Mixed"],
    ["Ranking priorities", result.preset === "custom" ? "Custom" : result.preset],
    ["Time taken", `${r.seconds} s${stages ? ` (${stages})` : ""}`],
    ["Product Hunt quota remaining", r.quotaRemaining === null ? "unknown" : formatInt(r.quotaRemaining)],
    ["Result source", result.source],
    ["Model used", r.model],
    ["Storage", r.store === "supabase" ? "Shared (Supabase)" : "Server memory"],
  ];
  return (
    <details className="run-details">
      <summary>{COPY.RUN_TITLE}</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {result.notes.includes("quota_low") && <p>{COPY.RUN_QUOTA}</p>}
      {result.notes.includes("category_topic") && <p>{COPY.RUN_CATEGORY_FALLBACK}</p>}
    </details>
  );
}
