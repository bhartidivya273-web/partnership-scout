# Deployment guide

How to run, deploy and operate the app. Public site: https://partnership-scout-flix-match.vercel.app ·
Code: https://github.com/bhartidivya273-web/partnership-scout

## 1. Environment variables

| Name | Needed | Where it comes from |
|---|---|---|
| `PRODUCT_HUNT_TOKEN` | yes | Product Hunt API dashboard (developer token) |
| `GEMINI_API_KEY` | yes | Google AI Studio. It must be a Google key; a key from another provider is rejected by Google |
| `GEMINI_MODEL` | yes | `gemini-3.8-flash` (a Flash model; do not use the `-latest` alias, it can change under a working app) |
| `GEMINI_FALLBACK_MODEL` | optional | `gemini-3.6-flash`, used once if the main model errors |
| `SUPABASE_URL` | for persistence | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | for persistence | Supabase project secret (server-side only) |

Keys live only in `.env.local` (git-ignored) and in Vercel's project settings. They are never in client code, the build output or the repository (`security.test.ts` checks all three).
`.env.example` lists the names only.

**Without Supabase** the app still works: the cache and saved result live in server memory (each server instance has its own), decisions are kept in the browser only, and the page says so ("Storage: Server memory", "Saved in this browser only"). Set the two Supabase variables for shared, durable storage.

## 2. Supabase (one-time)
1. Create or reuse a Supabase project and run `supabase/schema.sql` once (SQL editor, or the CLI). It creates `scout_cache` with row level security on and no policies, so only the server key can use it.
2. Copy the project URL and the **secret** (service role) key into the two variables above. Do not use the publishable/anon key.
3. Free projects pause after 7 days without use. A paused project makes storage calls fail; the app treats that as a cache miss (storage calls give up after 6 seconds) and falls back to memory and the committed snapshot. Restore the project from the Supabase dashboard.

## 3. Local development
```bash
npm install
cp .env.example .env.local       # fill in the values
npm run dev                      # http://localhost:3000
npm run check                    # type check, lint, 322 tests, production build
```
Node.js 20 or newer (built with 24).

## 4. Deploy to Vercel
1. Import the GitHub repository as a Vercel project (framework: Next.js; no build settings to change).
2. Add the variables from section 1 for **Production** and **Preview**.
3. **Settings → Deployment Protection → Vercel Authentication: Disabled**, otherwise visitors are asked to log in and the public link does not work.
4. Deploy. Every push to `main` deploys automatically. On the free plan the Git queue can lag by 10 to 15 minutes; to publish a commit immediately, create a production deployment from the Vercel API with `gitSource` (`type: github`, the repository id and `ref: main`).
5. The function limit is 300 seconds (the Hobby maximum); a cold first run takes about a minute, a warm one under a second.

## 5. Verify a deployment
```bash
curl https://<your-url>/api/health          # which settings are present (names only, never values)
```
With the header `x-check-key: <first 16 hex characters of sha256(PRODUCT_HUNT_TOKEN)>` the same endpoint also pings Gemini and answers `"gemini":"ok"` or a one-word reason (`auth`, `model`, `rate_limit`, `timeout`, `format`, `other`).
Then open the site in a private window (logged out), press **Find partners**, and check the status line, "Storage: Shared (Supabase)" under Run details, and that a shortlist survives a reload.

## 6. Operating it
* **Quota:** Product Hunt allows 6,250 points per 15 minutes for everyone; a live run costs about 1,300. The shared cache (12 minutes), the one-live-run lock and the quota guard keep visitors from exhausting it. **Refresh data** is refused while data is under 5 minutes old.
* **Warm-up before a demo:** press Find partners once a few minutes earlier so the cache is warm (a warm click returns in about a second).
* **Refresh the snapshot** after a final good run: `npx vitest run -c vitest.live.config.mts scripts/snapshot.live.ts`, commit `data/last-good-snapshot.json`, push.
* **Logs:** one JSON line per event in Vercel's log view (`scout.run`, `producthunt.fetched`, `producthunt.failed`, `gemini.failed`, `store.failed`, `decisions.failed`). They contain counts, timings and one-word reasons, never keys or product text.
* **Rotate keys** in each provider's dashboard, then update the Vercel variables and redeploy. Anything pasted into a chat or ticket should be rotated.
* **Roll back:** the exam submission is tagged `v1-submitted`. `git checkout v1-submitted` and redeploy restores it exactly (its cache keys differ, so the two versions do not interfere).

## 7. Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| Public link asks for a Vercel login | Vercel Authentication is on | Disable it (section 4, step 3) |
| Labels say "Template (not AI-written)" and categories "from Product Hunt tag" | Gemini failing (often a wrong key) | `/api/health` with the check header shows the reason |
| "Storage: Server memory" | Supabase variables missing, or project paused | Section 2 |
| "Setup problem: the Product Hunt access token…" | token missing or rejected | Replace `PRODUCT_HUNT_TOKEN` and redeploy |
| Results look old | Product Hunt rate limit reached or unreachable | The banner says so; Refresh data after the limit resets |
