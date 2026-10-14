import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Detail } from "@/app/ui/Detail";
import { Results } from "@/app/ui/Results";
import { Row } from "@/app/ui/Row";
import { RunDetails } from "@/app/ui/RunDetails";
import { Status } from "@/app/ui/Status";
import { PRESETS } from "@/lib/priority";
import type { ResultItem, ScoutResult } from "@/lib/result";
import { NO_FILTERS, type Filters } from "@/lib/workspace";
import { item } from "./items";

const T0 = Date.parse("2026-10-14T12:00:00Z");
const result = (over: Partial<ScoutResult> = {}, items: ResultItem[] = [item("1")]): ScoutResult => ({
  source: "live",
  dataAsOf: "2026-10-14T12:00:00Z",
  windowStart: "2026-10-07T12:00:00Z",
  windowEnd: "2026-10-14T12:00:00Z",
  scanned: 242,
  inCategories: 60,
  shown: items.length,
  categories: ["project_management", "team_communication"],
  preset: "balanced",
  weights: PRESETS.balanced,
  items,
  notes: [],
  refreshAfterSeconds: 300,
  run: { pages: 13, seconds: 40, quotaRemaining: 3000, categoryMethod: "ai", outreachMethod: "ai", model: "gemini-test", store: "supabase", shortlisted: 40, timings: { fetch: 8000, fit: 10000 } },
  ...over,
});
const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => {};

describe("status line and banners (every data state is communicated)", () => {
  const status = (r: ScoutResult, now = T0 + 60_000) => html(<Status result={r} now={now} />);
  it("live data says so and shows when it was last updated", () => {
    const h = status(result());
    expect(h).toContain("Live from Product Hunt");
    expect(h).toContain("Data last updated");
    expect(h).toContain("242 featured launches scanned, 60 in your categories, showing the top 1");
    expect(h).not.toContain("banner");
  });
  it("a cached result says how old it is", () => expect(status(result({ source: "cached" }), T0 + 7 * 60_000)).toContain("updated 7 min ago"));
  it("stale data (an hour or older) is flagged and points to Refresh", () => {
    const h = status(result({ source: "cached" }), T0 + 3 * 3600_000);
    expect(h).toContain("This data is 3 hours old");
    expect(h).toContain("Use Refresh data");
  });
  it("stale data that could not be refreshed says Product Hunt could not be reached", () => {
    expect(status(result({ source: "saved", notes: ["live_failed"] }), T0 + 3 * 3600_000)).toContain("Product Hunt could not be reached to update it");
  });
  it("a saved result after a failed fetch shows the plain fallback banner with its time", () => {
    const h = status(result({ source: "saved", notes: ["live_failed"] }));
    expect(h).toContain("Saved result from");
    expect(h).toContain("Product Hunt could not be reached just now, so this is the last real result");
  });
  it("a snapshot is labelled as a snapshot", () => expect(status(result({ source: "snapshot", notes: ["live_failed"] }))).toContain("Snapshot from"));
  it("partial data warns that the list may be incomplete", () => expect(status(result({ notes: ["partial"] }))).toContain("this list may be incomplete"));
  it("a failed AI step is explained, with what to do next", () => {
    const h = status(result({ notes: ["category_topic", "fit_unrated", "outreach_template"] }));
    expect(h).toContain("Categories for some products come from Product Hunt tags");
    expect(h).toContain("could not rate the fit");
    expect(h).toContain("labelled template");
    expect(h).toContain("Press Find partners again to retry");
  });
  it("refresh states are explained: throttled, in progress, quota low", () => {
    const h = status(result({ notes: ["refresh_throttled", "refresh_in_progress", "quota_low"] }));
    expect(h).toContain("under 5 minutes old");
    expect(h).toContain("Another refresh is running");
    expect(h).toContain("shared request limit is low");
  });
});

describe("a result row", () => {
  const row = (i: ResultItem, decision?: Parameters<typeof Row>[0]["decision"]) =>
    html(<Row item={i} decision={decision} onOpen={noop} onToggleShortlist={noop} />);
  it("shows the required fields with the fixed labels", () => {
    const h = row(item("1", { name: "TaskLane", tagline: "Boards for teams", upvotes: 1234, makerComments: 12, daysSinceLaunch: 3, daysLeft: 4 }));
    for (const s of ["TaskLane", "Boards for teams", "Votes (Product Hunt score)", "1,234", "Maker comments (per Product Hunt)", "Launched", "3 days ago", "Closes in 4 days", "Product Hunt page", "Copy message", "Open details"]) expect(h).toContain(s);
  });
  it("shows founder responsiveness and evidence completeness at a glance", () => {
    const h = row(item("1", { makerComments: 60, responsiveness: { level: "high", note: "n (per Product Hunt)" }, evidence: { checks: [], count: 4, total: 5 } }));
    expect(h).toContain("very active");
    expect(h).toContain("Evidence 4/5");
    expect(row(item("1", { makerComments: 0, responsiveness: { level: "none", note: "n" } }))).toContain("no replies yet");
  });
  it("missing maker information is stated plainly", () => {
    const h = row(item("1", { founder: { label: "Founder not listed", founderSource: "none", hiddenCount: 3, totalMakers: 3, makers: [] } }));
    expect(h).toContain("Founder not listed");
    expect(h).toContain("Find the maker on the product page first");
    expect(h.toUpperCase()).not.toContain("REDACTED");
  });
  it("a visible founder links to their Product Hunt profile and shows followers", () => {
    const h = row(item("1", { founder: { label: "Iris Tu +1 more", founderSource: "named", hiddenCount: 1, totalMakers: 2, makers: [{ name: "Iris Tu", username: "iris", headline: null, profileUrl: "https://www.producthunt.com/@iris", followersCount: 1500, twitterUsername: null, websiteUrl: null }] } }));
    expect(h).toContain('href="https://www.producthunt.com/@iris"');
    expect(h).toContain("1,500 followers");
    expect(h).toContain("+1 more");
  });
  it("an unrated product is labelled as such and the next step says to check by hand", () => {
    const h = row(item("1", { fit: null, relevance: null }));
    expect(h).toContain("Fit not rated");
    expect(h).toContain("Check the fit yourself");
  });
  it("closing-soon and decision states are visible", () => {
    const h = row(item("1", { daysLeft: 1 }), { productId: "1", name: "n", url: "u", status: "contacted", note: "", updatedAt: "" });
    expect(h).toContain("Closing soon");
    expect(h).toContain("Contacted");
  });
  it("the shortlist button reflects the saved decision", () => {
    expect(row(item("1"))).toContain("☆ Shortlist");
    expect(row(item("1"), { productId: "1", name: "n", url: "u", status: "shortlisted", note: "", updatedAt: "" })).toContain("★ Shortlisted");
  });
  it("text from the listing is escaped, never run as markup", () => {
    const h = row(item("1", { name: "<img src=x onerror=alert(1)>", tagline: "<script>alert(1)</script>" }));
    expect(h).not.toContain("<img src=x");
    expect(h).not.toContain("<script>");
  });
});

describe("the results workspace", () => {
  const view = (r: ScoutResult, extra: { grouped?: boolean; filters?: Filters } = {}) =>
    html(<Results result={r} decisions={{}} sort="priority" setSort={noop} filters={extra.filters ?? NO_FILTERS} setFilters={noop} grouped={extra.grouped ?? true} setGrouped={noop} onOpen={noop} onToggleShortlist={noop} />);
  const rows = [item("1", { fit: "strong" }), item("2", { fit: "partial" }), item("3", { fit: "weak" }), item("4", { fit: null })];
  it("groups by fit with weak fits folded away but counted", () => {
    const h = view(result({}, rows));
    expect(h).toContain("Strong fit");
    expect(h).toContain("Partial fit");
    expect(h).toContain("Fit not rated");
    expect(h).toMatch(/<details class="group"><summary/); // closed by default: no `open` attribute
    expect(h).not.toMatch(/<details class="group" open/);
  });
  it("shows the overview counts", () => {
    const h = view(result({}, rows));
    expect(h).toMatch(/<strong>1<\/strong> strong fit/);
    expect(h).toContain("not rated");
    expect(h).toContain("shortlisted");
  });
  it("offers a real choice of sorts, filters and an ungrouped list", () => {
    const h = view(result({}, rows), { grouped: false });
    for (const s of ["Priority (default)", "Relevance to async standups", "Upvotes", "Maker engagement", "Most recent launch", "Closing soon", "All categories", "Last 24 hours", "At least 3 of 5 checks", "Shortlisted", "Contacted"]) expect(h).toContain(s);
    expect(h).not.toContain("group-head");
  });
  it("filters that match nothing say so and offer to clear them", () => {
    const h = view(result({}, rows), { filters: { ...NO_FILTERS, evidence: "5" } });
    expect(h).toContain("No products match these filters");
    expect(h).toContain("Clear filters");
  });
  it("only the categories that were searched can be filtered on", () => {
    const h = view(result({ categories: ["hr_tech"] }, rows));
    expect(h).toContain("HR tech");
    expect(h).not.toContain("Developer productivity</option>");
  });
});

describe("the detail view", () => {
  const detail = (i: ResultItem, decision?: Parameters<typeof Detail>[0]["decision"], saveInfo: Parameters<typeof Detail>[0]["saveInfo"] = { saved: "server", storage: "supabase", error: null }) =>
    html(<Detail item={i} result={result({}, [i])} decision={decision} saveInfo={saveInfo} candidates={60} onClose={noop} onUpdate={noop} />);
  it("has every section the brief asks for", () => {
    const h = detail(item("1", { name: "TaskLane" }));
    for (const s of ["Your decision", "Partnership idea", "The connection", "The partnership hypothesis", "Opening message", "The question", "Check before sending", "Why it is ranked here", "Score breakdown", "Evidence", "Missing or uncertain", "Founder and contact path", "Source", "Copy message", "Save note"]) expect(h).toContain(s);
  });
  it("the score breakdown lists every signal with its weight and points", () => {
    const h = detail(item("1"));
    for (const s of ["Votes (Product Hunt score)", "Maker comments (per Product Hunt)", "Momentum", "Relevance to async standups", "Time left in the 7-day window", "Evidence completeness", "Assignment score"]) expect(h).toContain(s);
  });
  it("template outreach is labelled as not AI-written", () => {
    const h = detail(item("1", { outreach: { connection: "c", hypothesis: "h", message: "m", question: "q?", caveat: "v", source: "template" } }));
    expect(h).toContain("Template (not AI-written)");
    expect(h).toContain("Nothing is sent for you");
  });
  it("saving states are honest: server, browser only, database not connected, error", () => {
    const d = { productId: "1", name: "n", url: "u", status: "shortlisted" as const, note: "x", updatedAt: "" };
    expect(detail(item("1"), d)).toContain("Saved.");
    expect(detail(item("1"), d, { saved: "browser", storage: "browser", error: null })).toContain("Saved in this browser only.");
    expect(detail(item("1"), d, { saved: "server", storage: "memory", error: null })).toContain("database is not connected");
    expect(detail(item("1"), d, { saved: "browser", storage: "browser", error: "Saved in this browser only: the server could not be reached." })).toContain("the server could not be reached");
    expect(detail(item("1"))).toContain("Nothing saved yet.");
  });
  it("a website with an unsafe scheme is never rendered as a link", () => {
    const h = detail(item("1", { websiteUrl: "javascript:alert(1)" }));
    expect(h).not.toContain("javascript:");
  });
  it("every missing or uncertain item is listed", () => {
    const h = detail(item("1", { missing: ["Founder not listed: x", "No product website is listed."] }));
    expect(h).toContain("Founder not listed: x");
    expect(h).toContain("No product website is listed.");
  });
});

describe("run details", () => {
  it("shows the stage timings, the storage and the method used", () => {
    const h = html(<RunDetails result={result({ notes: ["quota_low", "category_topic"] })} />);
    for (const s of ["Pages fetched", "Rated for fit (shortlist)", "Fetch / cache 8 s", "Fit ratings 10 s", "Shared (Supabase)", "gemini-test", "Quota was low", "tags were used"]) expect(h.replace(/&#x27;/g, "'")).toContain(s);
  });
  it("says memory when the database is not connected", () => {
    expect(html(<RunDetails result={result({ run: { ...result().run, store: "memory" } })} />)).toContain("Server memory");
  });
});
