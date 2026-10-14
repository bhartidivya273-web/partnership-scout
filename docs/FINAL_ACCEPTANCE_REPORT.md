# Final acceptance report

14 Oct 2026. Everything below was run against the real services or the real deployed site; where something could **not** be verified, it says so.

## 1. What changed (v1 exam build → this version)

The exam build (git tag `v1-submitted`) found, ranked and explained launches. This version turns it into a decision workspace:

| Area | Before | Now |
|---|---|---|
| Ranking | votes + maker comments only | the same core score, plus an explainable priority score (momentum, relevance, time left, evidence), three presets, validated custom weights, full breakdown |
| Relevance | a decorative badge | AI-rated fit (a label) that is turned into points by a fixed table and moves the rank |
| Outreach | one two-sentence angle | connection, hypothesis, opening message, one question and a caveat, checked in code for grounding and honesty |
| Founder evidence | a name | verified maker details (profile link, followers, headline, Twitter/X, site) for visible makers only, plus Product Hunt rank and reviews |
| Explanation | two numbers | why it is ranked here, founder responsiveness, evidence checklist, what is missing or uncertain |
| Acting on results | none | sort (6 ways), filters (4), group by fit, detail view, shortlist, contacted, private notes, copy buttons, all persisted |
| Freshness | cache label | visible window and last-updated time, stale flag, a Refresh action that really fetches (throttled to protect the shared limit) |
| Reliability | cache, saved result, snapshot | the same, plus results that never depend on cache state, structured logs, storage timeouts |
| Documentation | none in the repo | `README.md`, `.env.example` and 8 documents in `docs/` |
| Tests | 184 | 329 |

## 2. What works (verified)

* **Live data end to end:** a click on the deployed, logged-out site returned 20 ranked launches from a live Product Hunt fetch (242 featured launches in the window, 62 in the four categories on 14 Oct), all 20 with named founders and Product Hunt profile links, all with AI-written outreach.
* **The seven-day window** (UTC, inclusive at 7 x 24 h) is enforced and tested to the second; every shown row had 0 to 7 days since launch.
* **Ranking** is deterministic: a cold and a warm run returned identical rank, id, fit, score and message for all 20 rows (checked live and by regression tests).
* **Honest states:** live, cached, saved, snapshot, stale, partial, throttled refresh, quota low, failed AI steps, missing founder, missing website and missing maker count each show a specific message (rendering tests for every one; browser checks for the main ones).
* **Persistence:** shortlist, contacted and notes survive a full reload and are in Supabase; 10 simultaneous saves on production kept all 10.

## 3. What was tested

329 automated tests (18 files), all passing, plus the type check, lint and production build (`npm run check`). The mapping of every required check to its tests, the mutation checks that prove the tests fail when they should, and the live checks are in [TEST_PLAN.md](TEST_PLAN.md). The stress test of the deployed site (8 simultaneous cold visitors → exactly 1 live Product Hunt run and 7 labelled saved results; 10 warm visitors identical; hostile inputs; prompt injection; refresh throttle; parallel saves) is in its section 5.

Defects found during this work and fixed (not hidden): results differing between cold and warm runs, an under-weighted relevance signal, a cached greeting that could name a different maker than the card showed, lost updates under simultaneous saves, and a misleading "custom" label. See [IMPLEMENTATION_AUDIT.md](IMPLEMENTATION_AUDIT.md) section 5.

## 4. Data sources actually verified

| Source | Verified how |
|---|---|
| Product Hunt API v2 | live fetches on 14 Oct (about 13 requests per run, 242 featured launches); schema introspection (31 `Post` and 19 `User` fields); a 20-post sample for rank, review and maker fields (47% of makers visible); a comment-attribution check (0 of 8 comment authors visible, `isMaker` false); quota headers read |
| Gemini Flash (`gemini-3.8-flash`) | live structured-output calls for categories (242 launches), fit (40) and outreach (20); `/api/health` ping "ok" on Vercel; failure paths drilled with the key removed |
| Supabase | real-database checks: values, expiry, lock race (5 simultaneous attempts, 1 winner), prefix listing, 12 parallel saves; the deployed app reads and writes it |

Not used and not claimed: email addresses (Product Hunt provides none), scraping, any other site, the Claude API.

## 5. Gemini Flash

Works: it is the only AI in the app (a repository search finds no Claude or Anthropic API usage), it answers on Vercel, and every job is validated and falls back to a labelled non-AI result if it fails. Its rate limits for the key were **not** read in Google AI Studio (not accessible from here); caching keeps usage to a few calls per live run (about 6 category calls for 242 launches, 2 fit calls, 4 outreach calls).

## 6. Build, tests, deployment

* `npm run check`: type check, lint, 329 tests and the production build all pass.
* **GitHub:** the code is published at https://github.com/bhartidivya273-web/partnership-scout (public, logged-out HTTP 200). A tree listing shows no `.env` file, PDFs, planning documents or keys; `security.test.ts` also scans every committed file for key-shaped values.
* **Vercel:** the application code was last changed in commit `286934e`, deployed as `dpl_7sNnpmXaLeNV7ZGsfL8TW8mL2iZM` (state READY) and tested logged out at https://partnership-scout-flix-match.vercel.app. Later commits change documentation and the architecture map only.
* **Settings on Vercel** were confirmed through `/api/health` (names only): Product Hunt token, Gemini key and model, Supabase URL and key all present.

## 7. Remaining blockers and things I could not verify

* **Owner-only checks that need the Product Hunt website:** the comparison of maker-comment and vote numbers against the site for three products (Foley, Onepin, DailyHelm), the coverage check of ten launches, and the four questions for the instructor.
* **The Copy buttons** use the standard clipboard call with an older fallback; the test browser blocks clipboard access, so a successful copy was **not** observed. Please click one once in a normal browser.
* The detail view is a native modal dialog; the test browser's screenshots do not capture modals, so it was verified through the page's structure and behaviour (opening, sections, saving, closing), and at phone width for overflow, not by screenshot.
* **Supabase free tier** pauses a project after 7 days without use; the app then falls back to memory and the committed snapshot, and says so. Restore the project from the Supabase dashboard if that happens.
* **Vercel's Git queue** can lag by 10 to 15 minutes on the free plan; the guide shows how to publish a commit immediately.
* **Keys pasted into chats** during the project (Gemini, Product Hunt, Supabase secret, and an OpenRouter key that was never used) should be rotated after the demo.
* Real-user testing with Kavya has not happened; the design follows her stated job, not observed use.
