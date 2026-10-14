# Scoring methodology

How a launch gets its rank, and why. Everything below is plain code in `lib/scoring.ts`, `lib/priority.ts` and
`lib/evidence.ts`; the only AI input is the *fit label* (strong, partial, weak), which is turned into points by a fixed table.
The same inputs always give the same ranking (a regression test proves a cold run and a warm run are identical).

## 1. Two layers, kept visibly apart

| Layer | What it is | Where it shows |
|---|---|---|
| **Core score** (the assignment) | Votes and maker comments only, log-scaled, 50/50 | "Assignment score" in the detail view; the basis of every tie-break |
| **Priority score** (the product) | The core signals plus four documented enhancements | The score on every card, the default sort |

The assignment's two required signals stay central: votes and maker comments carry **40 of the 100 priority points**
by default, and the age-adjusted momentum component (another 10) is built from votes.

## 2. The core score (assignment formula)

```
U(p) = ln(1 + votes(p))        / ln(1 + max votes in the pool)
M(p) = ln(1 + makerComments(p)) / ln(1 + max makerComments in the pool)
Core(p) = 100 × (0.5 × U(p) + 0.5 × M(p))
```

* Maxima are taken over the **whole candidate pool** (launches in the chosen categories), not only the top 20.
* A maximum of 0 makes that part 0 for everyone (no division by zero).
* The log compresses heavy tails, so one runaway launch does not flatten everyone else.
* Worked example (tested): A (400 votes, 2 maker comments) 69.8, B (120, 15) 90.0, C (30, 0) 28.6 → order B, A, C.

**Votes** are Product Hunt's `votesCount`, which Product Hunt itself describes as a formula-weighted score (voter credibility,
time decay), not a raw tally. **Maker comments** are Product Hunt's `makerReplies`: its own count of comments authored by the
post's makers. See `DATA_SOURCES.md` for why comment authors cannot be matched to makers.

## 3. The priority score

```
Priority = Σ over six signals of  weight × value        (weights sum to 100, value is 0 to 1)
```

| Signal | Value (0 to 1) | Balanced | Engagement first | Fit first |
|---|---|---|---|---|
| Votes | core U, log-scaled against the pool best | 20 | 35 | 12 |
| Maker comments | core M, log-scaled against the pool best | 20 | 35 | 12 |
| Momentum | `ln(1 + v) / ln(1 + vmax)` where `v = votes / (days since launch + 1)` | 10 | 15 | 6 |
| Relevance | strong 1.0, partial 0.6, weak 0.2, **not rated 0.4** (neutral, flagged) | 30 | 5 | 50 |
| Time left in the window | `days left / 7` | 10 | 5 | 10 |
| Evidence completeness | `checks met / 5` | 10 | 5 | 10 |

The score is rounded to one decimal, exactly what the page shows.

### Why these weights
* **Votes + maker comments (40) + momentum (10)** keep popularity and maker engagement the largest block, as the assignment requires.
* **Relevance (30)** is the single largest signal because popularity alone is not partnership value: a high-vote product that cannot
  plug into async standups is a poor outreach target. In a real review run with relevance at 20 points, 8 of the first 14 rows were
  weak-fit developer tools; at 30 the strong and partial fits lead the list (in the next live run the first five rows were strong or partial fits).
* **Time left (10)** and **evidence (10)** are tie-breaking nudges, not drivers.
* Two other presets exist for different questions; custom weights are accepted by the API (`weights`), rescaled to 100, with negative
  or non-numeric values treated as 0 and an unusable set falling back to Balanced.

### How launch age is handled
Votes grow with time, so a launch from six days ago can out-score a launch from today only by being older.
* **Momentum** rewards the same votes earned faster (votes per day since launch, log-scaled).
* **Time left** rewards launches that still have most of their seven-day outreach window.
* Neither hides urgency: the **Closing soon** badge (2 days or fewer left), the "Closing soon" sort and the "Contact today" next step
  surface launches whose window is ending, which the ranking deliberately does not favour.

### The five evidence checks
1. Maker identified on Product Hunt (a visible, named maker).
2. Product website listed.
3. At least 40 characters of description text to ground the outreach.
4. Maker comments recorded by Product Hunt (more than 0).
5. Fit rated by Gemini (a template never counts as a rating).

## 4. Order of work (and why the result never depends on the cache)

1. **Candidate pool:** launches in the last 7 days (UTC), de-duplicated, in the selected categories (Gemini sorts categories; a labelled Product Hunt topic table is the fallback).
2. **Shortlist:** the top 40 by priority with relevance counted as neutral for everyone. This uses no AI output, so it is identical whatever is cached.
3. **Fit rating (Gemini)** for the shortlist only.
4. **Final ranking** inside the shortlist with the real relevance values; rank 1 to 20 are shown.
5. **Outreach (Gemini)** for the 20 shown only.

Ties are decided on the one-decimal priority, then the core score, then maker comments, then votes, then the newer launch, then the id.
Ranks always show the priority order, even when the list is sorted or filtered differently.

## 5. Explaining every rank

Each result carries, all built by code from the numbers above:
* the **score breakdown** (value, weight, points per signal) and the assignment score;
* **why it is ranked here**: rank among candidates, votes and maker comments with their ranks in the pool, launch age and days left, the AI fit label with its one-sentence reason, and Product Hunt's own day/week rank and review rating when present;
* **founder responsiveness**, from Product Hunt's maker-comment count: *very active* (10 or more and in the top quarter of candidates), *replying* (4 or more and in the top half), *some activity* (any), *no replies yet* (zero). It always says "per Product Hunt", because the count is Product Hunt's own;
* **what is missing or uncertain**: hidden founder, no website, thin description, no maker comments, fit not rated, no visible contact path, and the standing note that Product Hunt provides no email addresses.

## 6. Limits stated on screen and in the README
* Scores are relative to one run's pool and category selection: compare ranks, not scores from different runs.
* Popularity is not relevance; the fit label is the guard, and between half and two thirds of a typical week's top 20 (10 to 13 of 20 in the runs checked) are honestly rated weak.
* Maker comments are Product Hunt's count and can differ from a hand count by a few on busy threads.
* Only the shortlist (top 40 by engagement signals) is rated for fit, so a low-engagement product with excellent fit can be missed. The filters and sorts act on the 20 shown rows.
