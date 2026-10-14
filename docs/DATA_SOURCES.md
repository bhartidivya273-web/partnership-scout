# Data sources

Every external source the app uses, what it is used for, what it does **not** provide, and what was verified live.
Nothing here is assumed from documentation alone: the checks below were run against the real services on **14 Oct 2026**.

## 1. Product Hunt API v2 (GraphQL), the launch data

* Endpoint `https://api.producthunt.com/v2/api/graphql`, `POST`, `Authorization: Bearer <developer token>`. The token lives only in server settings.
* Query: `posts(featured: true, postedAfter: <now minus 7 days, UTC>, first: 20, after: <cursor>)`, paged until there is no next page (about 13 requests, safety cap 20).
  `featured: true` is deliberate: of about 6,150 posts a week only about 250 are featured; `featured: false` does **not** exclude featured posts.
* **Window:** rolling 7 x 24 hours back from the fetch time, UTC, inclusive at both ends. Future (scheduled), undated and invalid timestamps are excluded. `postedAfter` filters on `createdAt`, which equals `featuredAt` for featured posts.
* **Cost:** a flat 100 points per request, quota 6,250 points per 15 minutes shared by everyone, 20 posts per request at most. A live run is therefore about 1,300 points. The cache, a one-run lock and a quota guard exist to protect this.

### Fields used (all read from the API, none invented)

| Field | Used for | Note |
|---|---|---|
| `id`, `name`, `tagline`, `url`, `website` | identity, links | the product's own words; `url` must be on `producthunt.com` or the record is dropped |
| `description` | grounding for Gemini | truncated to 300 characters before it is sent or stored |
| `createdAt` | launch time, window, days since launch | UTC |
| `votesCount` | votes | Product Hunt's formula-weighted score, **not** a raw tally (stated by the API's own schema) |
| `makerReplies` | maker comments | Product Hunt's count of comments authored by the post's makers; `Int!`, never null |
| `commentsCount` | context only | never used as the maker-comment count |
| `dailyRank`, `weeklyRank` | evidence, shown in "why" | Product Hunt's own ranking; absent for some posts |
| `reviewsCount`, `reviewsRating` | evidence, shown in "why" | rating shown only when there are reviews |
| `topics` | category fallback table | used only if the AI category step fails |
| `makers { name username headline url followersCount twitterUsername websiteUrl }` | founder, contact path | **visible makers only** (see 2) |

### Verified live (14 Oct 2026)
* `Post` exposes 31 fields and `User` 19 (schema introspection). `dailyRank`, `weeklyRank`, `reviewsCount`, `reviewsRating`, `productLinks` and the maker fields `url` and `followersCount` exist and were previously unused.
* A live run returned 242 featured launches in the window (62 in the four categories); a sample of 20 returned `dailyRank` for 20, `weeklyRank` for 19, reviews for 7.
* In the same 20-post sample there were 53 makers, **25 visible (47%)**. All 25 visible makers had a profile URL, 18 had followers, 18 a headline, 6 a Twitter handle and 6 a website.
* **Maker comments cannot be attributed to individual makers:** in a sample thread (131 comments, `makerReplies` = 61) 0 of 8 comment authors were visible and `isMaker` was `false` for all of them. `makerReplies` is the only reliable maker-comment source, which is why it is used and labelled "per Product Hunt". Earlier tests showed it exact on small threads and usually a few higher on busy ones.

## 2. What Product Hunt does not provide (and the app never pretends it does)
* **Hidden makers.** Most makers come back as `[REDACTED]` with id `0`. A maker is treated as hidden if the name or username is `[REDACTED]` (any case), the name is empty, or the id is `0`. The text `[REDACTED]` is never shown. A hidden maker's follower count is returned by the API but cannot be attributed to anyone, so it is never used.
* **No email addresses.** The only contact paths are the Product Hunt page, the product website and, when a maker is visible, their Product Hunt profile, Twitter/X handle or personal site. Every row says so under "Missing or uncertain".
* **No scraping.** The Product Hunt website is never scraped, and no other site (LinkedIn, company sites) is read.
* **Terms.** The API's terms default to non-commercial use. This is an exam project; a company deployment would need Product Hunt's permission. "Powered by Product Hunt" is shown on every page.

## 3. Gemini Flash (the only AI)

* Model `gemini-3.8-flash` (fallback `gemini-3.6-flash`), called over HTTPS with the key in a header, structured JSON output, low "thinking" level. Never the Claude API.
* Three jobs, each validated in code and retried once for failures: **category sorting** (all launches), **fit rating** (the shortlist of 40) and **structured outreach** (the 20 shown).
* **Data sent:** product name, tagline, description (300 characters), Product Hunt topics, the matched categories, the fit label and the **visible** founder's name (never a hidden one), plus Kavya's own product text. No keys, no personal data. Product text is untrusted: it is placed inside `<<<DATA ... DATA>>>` markers and the model is told to treat it as data only.
* **Failure behaviour:** if Gemini fails, categories come from a labelled Product Hunt topic table, fit stays unrated (neutral, flagged) and outreach is a labelled template built only from the listing. The page says so.

## 4. Supabase (storage)

* One table, `scout_cache(key text primary key, value jsonb, expires_at timestamptz)`, row level security on with no policies, accessed only with the server-side service key.
* Holds: the shared 12-minute pool cache, the saved last real result (never expires), per-product category/fit/outreach caches (7 and 3 days), the refresh lock, and Kavya's saved decisions (shortlist, contacted, notes), **one row per decision** under a random per-browser workspace id (so simultaneous saves cannot overwrite each other).
* No emails or accounts are stored. Notes are free text that Kavya types; they are kept under her workspace id only.

## 5. The committed snapshot
`data/last-good-snapshot.json` is a real capture (Product Hunt data, Gemini categories, fit ratings and outreach) with its time. It is the last layer before an error screen and is shown labelled "Snapshot from <time>". Tests assert every record points at Product Hunt, is inside the seven-day window of its capture time and contains no test-fixture names.

## 6. Freshness and what the page claims
* Live → recent cache (12 minutes) → saved last real result → snapshot → a plain error. The page always labels which one it is showing and when the data was fetched.
* Data an hour old or older is flagged as stale, with a Refresh action. Refresh is refused (with an explanation) while data is under 5 minutes old, to protect the shared quota.
* Day counts are worked out as of the data's fetch time, so a saved result never pretends to be newer than it is.
