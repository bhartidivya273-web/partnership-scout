# Partnership Scout

**Live app:** https://partnership-scout-flix-match.vercel.app · **Code:** https://github.com/bhartidivya273-web/partnership-scout

A partnership research workspace for a B2B SaaS company that sells async standup software for remote teams (built for the MESA School of
Business Term 1 AI exam, "ProductHunt Partnership Scout"). It answers one question for the partnerships lead:

> **Which founders should I contact today, and what is my best reason for contacting each of them?**

One click returns Product Hunt's **featured launches from the last 7 days** in four categories (project management, HR tech, developer
productivity, team communication), ranked, with the evidence behind every rank, the founder where Product Hunt shows one, and an outreach
message to edit. Nothing is ever sent for her.

## What each result gives you

* **Product, founder, one-line description, votes, maker comments, days since launch** (the assignment's fields), with Product Hunt's links and the maker's profile link, follower count, Twitter/X and site when they are visible.
* **A priority score with its breakdown**: the assignment's votes and maker-comment signals plus momentum, relevance to async standups, time left in the seven-day window and evidence completeness. [How it is built](docs/SCORING_METHODOLOGY.md).
* **Why it is ranked here**, how responsive the makers look (per Product Hunt's own count) and **what is missing or uncertain**, including that Product Hunt provides no email addresses.
* **Outreach from Gemini Flash**: the connection, a partnership hypothesis, an opening message, one question and a caveat saying what to verify before sending. Checked in code: no empty compliments, no invented numbers or names, no claim that an integration exists or that a founder wants a partner, and it must be grounded in the product's own text. If Gemini fails, a clearly labelled template is shown instead.
* **A workspace to act in**: sort (priority, relevance, upvotes, maker engagement, recency, closing soon), group by fit, filter (category, launch age, minimum evidence, your decisions), open a detail view, **shortlist**, mark **contacted**, add a **private note**, copy the message. Decisions are saved (Supabase), keyed to a private per-browser workspace id, and kept in the browser if the server is unreachable.
* **Ranking priorities** (Balanced, Engagement first, Fit first) re-rank the cached data instantly, and **Refresh data** fetches new launches (refused while data is under 5 minutes old, to protect the shared Product Hunt limit).

## Honest by design

The page says where its data came from and when: **live → recent cache → saved last real result → committed snapshot → a plain error.**
Data an hour old or older is flagged as stale. Partial data, a failed AI step, a hidden founder, a missing website or a missing maker-comment
count are each stated, never filled in. The text `[REDACTED]` is never shown, and nothing that is not a genuine Product Hunt launch can
appear in the results.

## How it works

1. **Fetch** the featured launches of the last 7 days (UTC) from Product Hunt (about 13 requests of 20).
2. **Sort into categories** (Gemini; a labelled Product Hunt topic table is the fallback).
3. **Shortlist** the top 40 on engagement signals only, **rate fit** for the shortlist (Gemini), then **rank** with the priority score (plain code).
4. **Write outreach** for the top 20 (Gemini) and **save** the real result for the next visitor.

Only one live refresh runs at a time (a lock in the shared store); other visitors are served the cache or saved result, labelled. Results never depend on what happens to be cached (a cold run and a warm run are identical, and that is tested).

## Run it yourself

Needs Node.js 20 or newer.
```bash
npm install
cp .env.example .env.local     # fill in PRODUCT_HUNT_TOKEN, GEMINI_API_KEY (Supabase optional)
npm run dev                    # http://localhost:3000
npm run check                  # type check, lint, 329 tests, production build
```
Full setup, Vercel and Supabase steps, operating notes and troubleshooting: [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md).

## Documentation

| Document | What it covers |
|---|---|
| [docs/IMPLEMENTATION_AUDIT.md](docs/IMPLEMENTATION_AUDIT.md) | What was tested in v1, what was weak, and the fixes |
| [docs/SCORING_METHODOLOGY.md](docs/SCORING_METHODOLOGY.md) | The score, the weights and why, age handling, tie-breaks |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | Product Hunt, Gemini and Supabase: fields used, limits, what was verified live |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Every required check mapped to its tests, mutation checks and live checks |
| [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | Environment variables, Supabase, Vercel, operating and troubleshooting |
| [docs/COMPONENTS_MAP.md](docs/COMPONENTS_MAP.md) | The architecture as built (with a one-page [PDF](docs/components-map.pdf)) |
| [docs/FINAL_ACCEPTANCE_REPORT.md](docs/FINAL_ACCEPTANCE_REPORT.md) | What changed, what works, what was verified, remaining blockers |

## Known limitations (stated openly)

1. **Popularity is not relevance.** The score ranks activity plus an AI-rated fit; most of a typical week's top launches are honestly rated weak fits.
2. **Maker comments are Product Hunt's own count** (`makerReplies`). Product Hunt hides makers' identities, so comments cannot be attributed to individual makers by anyone outside Product Hunt. The count matched a hand count exactly on small threads and was usually a few higher on busy ones.
3. **Votes are Product Hunt's weighted score**, not a raw tally of upvotes.
4. **Founders are often hidden.** Product Hunt hides roughly half or more of makers from outside apps (47% visible in the sample checked), so some rows say "Founder not listed" and point to the product page.
5. **Featured launches only**, so a few genuine unfeatured launches are missed. Categories are AI-sorted and can be misplaced now and then; HR tech can be empty in a week with no featured HR launches.
6. **Only the shortlist (top 40 on engagement) is rated for fit**, and filters and sorts act on the 20 rows shown.
7. **Scores are relative to one run's pool**: compare ranks, not scores from different runs.
8. **Saved decisions use a private browser id, not accounts**: clearing the browser's storage loses access to them (the data stays in the database).
9. **Product Hunt's API terms default to non-commercial use**; a company deployment would need Product Hunt's permission.

## Validation

322 automated tests (dates and the seven-day boundary, founder rules, scoring and ranking, evidence, AI-output checks, grounding, persistence, every UI state, API-key protection, separation of test fixtures from real results), the production build, and live checks against the real Product Hunt, Gemini and Supabase services. The results, including the stress test of the deployed site, are in [docs/TEST_PLAN.md](docs/TEST_PLAN.md) and [docs/FINAL_ACCEPTANCE_REPORT.md](docs/FINAL_ACCEPTANCE_REPORT.md).

The original exam submission is preserved as the git tag `v1-submitted`.

*Powered by Product Hunt.*
