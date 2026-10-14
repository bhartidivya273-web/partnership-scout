# Implementation audit

Audit of the v1 application (git tag `v1-submitted`, commit `e86df34`) before the product upgrade.
Every finding below was checked against the running system on **14 Oct 2026**, not assumed from the code.

## 1. What was tested, and how

| Question | Method | Result |
|---|---|---|
| Does the production build pass? | `npm run check` (type check, lint, 184 tests, production build) | Pass |
| Is the live deployment up and logged-out reachable? | `curl` to the public URL; full click path via `POST /api/scout` | Pass: live run, 242 launches scanned, 62 in the four categories, 20 shown |
| Is Product Hunt data live or hardcoded? | The run above returned `dataAsOf 2026-10-14T13:38Z` (the day of the audit) with 13 live page requests | **Live** |
| Does the seven-day filter work? | Unit tests incl. the exact boundary (inclusive at 7 x 24 h), future, undated and invalid dates; every shown row had 0 to 7 days since launch | Pass |
| Are votes and maker comments real? | Product Hunt GraphQL `votesCount` and `makerReplies` read per post; schema introspection (below) | **Real, with caveats** (see 2) |
| Are founders verified or guessed? | Founders come only from Product Hunt's `makers` field; hidden makers are never named | Verified where visible; none guessed |
| Is Gemini Flash integrated correctly? | `/api/health` Gemini ping = ok on Vercel; structured JSON output, per-item validation, retry once, labelled template fallback; drills with the key removed | Pass |
| Are results genuinely ranked? | Deterministic log-scaled score, 19 tests incl. the worked example | Pass |
| Does the button handle loading, empty results and errors? | Browser drills: progress, empty state (HR tech), setup error, no-internet snapshot | Pass |
| Does the GitHub repository exist? | `gh repo view`, logged-out HTTP 200 | Public |
| Does a Components Map exist? | File exists outside the repository only (`Final_Pack/`) | **Gap: not in the repo** |

## 2. Product Hunt facts verified live (14 Oct 2026)

* `Post` exposes 31 fields. Relevant and unused in v1: `dailyRank`, `weeklyRank`, `reviewsCount`, `reviewsRating`, `productLinks`.
* `User` exposes 19 fields. Relevant and unused in v1: `url` (profile link), `followersCount`, plus `headline`, `twitterUsername`, `websiteUrl` which v1 already read.
* In a 20-post sample: 53 makers, **25 visible (47%)**; all 25 visible makers have a profile URL, 18 have followers, 18 a headline, 6 a Twitter handle, 6 a website. Hidden makers come back as `[REDACTED]` (their follower counts leak but cannot be attributed, so they are not used).
* **Maker-comment attribution through comment authors is impossible**: in a sample thread, 0 of 8 comment authors were visible and `isMaker` was `false` for all. `makerReplies` (the API's own count of comments authored by the post's makers) is therefore the only reliable maker-comment source. It is exact on small threads and can be a few higher on busy ones (documented in `DATA_SOURCES.md`).
* `votesCount` is documented by the API as a formula-weighted score, not a raw tally. It is labelled that way.
* Quota: 6,250 points per 15 minutes shared by everyone, flat 100 points per request.

## 3. Findings and fixes

| # | Finding (evidence) | Severity | Fix in this upgrade | Status |
|---|---|---|---|---|
| F1 | Founder evidence is thin: only a name is shown. Profile link, headline, followers, Twitter and website are fetched for some fields but not surfaced; followers and profile URL are not fetched | High | Fetch and show verified maker details (visible makers only) with a canonical profile link | Done |
| F2 | Relevance to async standups does not influence rank; the fit badge is decoration | High | Composite priority score with a relevance component; fit rated before the final ranking | Done |
| F3 | Votes accumulate with time, so older launches have an advantage; only a "Closing soon" sort mitigates it | Medium | Age-adjusted momentum component and a visible time-in-window component | Done |
| F4 | Outreach is one two-sentence angle: no opening message, question or caveat | High | Structured outreach (connection, hypothesis, message, question, caveat) with grounding checks | Done |
| F5 | The score breakdown shows two numbers; nothing explains why a product is relevant, how responsive the founder looks, or what is missing | High | Deterministic "why", responsiveness note and a "missing or uncertain" list per product | Done |
| F6 | No way to act on results: no detail view, shortlist, contacted state or notes; decisions are lost on refresh | High | Detail view plus persisted decisions (Supabase, per browser workspace) | Done |
| F7 | No refresh: the button returns a cached result for up to 12 minutes; staleness is only a label | Medium | Refresh action (throttled to protect the shared quota), stale-data banner | Done |
| F8 | Only three sorts and no filters | Medium | Sort by priority, relevance, upvotes, maker engagement, recency, closing soon; filters for category, launch age, minimum evidence and decision status, each applied for real | Done |
| F9 | Ranking weights are fixed in code, not configurable | Medium | Documented, validated weight configuration with presets | Done |
| F10 | Product Hunt rank, review rating and review count are available but unused | Low | Fetched, shown as evidence and counted in the evidence score | Done |
| F11 | No structured logging; failures inside Gemini retries are invisible | Medium | Structured JSON events for runs, source and AI failures (never secrets) | Done |
| F12 | Nothing tests that synthetic fixtures cannot reach production results, or that secrets stay out of client code | Medium | Guard in the pool builder (only Product Hunt URLs), snapshot validation, source scans in tests | Done |
| F13 | Documentation lives outside the repository (PRD, decision log, Components Map) | Medium | `docs/` with scoring, data sources, test plan, deployment guide, Components Map and acceptance report | Done |
| F14 | Only the top 20 are generated and shown, so filters act on 20 rows | Low | Documented limit; filters operate on the shown set and say so | Accepted |

## 4. Risks noted, not changed

* The public endpoint is unauthenticated by design (no accounts are in scope). It is protected by the shared cache, the single-flight lock, the quota guard and input limits. Saved decisions are keyed by a random per-browser workspace id, which is a capability token, not authentication.
* Free Supabase projects pause after 7 days without use. The app falls back to memory and the committed snapshot; documented in the deployment guide.
* The exam build deadline (12 Oct) has passed; `v1-submitted` is tagged so that exact version can always be restored.

## 5. Resolution (14 Oct 2026, after the upgrade)

Every finding F1 to F13 is fixed and verified (details and evidence in `TEST_PLAN.md` and `FINAL_ACCEPTANCE_REPORT.md`); F14 stays an accepted, documented limit.

Defects found **while** upgrading, by tests, reviews of real output and the stress test of the deployed site, and fixed:

| # | Defect | How it was found | Fix |
|---|---|---|---|
| D1 | The same request gave different results cold versus warm: the shortlist for fit rating depended on which ratings happened to be cached | Reloading the live page and comparing the summary counts | Shortlist chosen from fit-independent signals only; regression tests prove cold and warm runs are identical (and a live comparison of all 20 rows) |
| D2 | Relevance was under-weighted: 8 of the first 14 rows of a real review run were weak-fit developer tools | Reading real output | Relevance raised from 20 to 30 points in the balanced preset |
| D3 | A cached outreach message could greet a maker other than the founder shown on the card (Product Hunt's maker order changes between fetches) | An independent audit script over the live responses | Cache key includes the shown founder; every reused message (saved result, cache, snapshot) is re-checked and rewritten on mismatch; regression tests that fail without the fix |
| D4 | Five simultaneous saves kept only three decisions (all decisions shared one database row) | The stress test on the deployed site | One row per decision; verified with 12 parallel saves against the real database and 10 simultaneous saves on production |
| D5 | Junk custom weights were labelled "custom" although the Balanced numbers were used | Edge-case run against production | Labelled honestly |
| D6 | Type errors in test files slipped into a push in v1 and failed one Vercel build | Vercel build log | `npm run check` (type check, lint, tests, build) runs before every push |
