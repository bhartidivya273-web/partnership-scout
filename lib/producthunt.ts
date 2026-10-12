// Product Hunt client: pages through the week's FEATURED posts (20 per request is the API's
// maximum) and reads the quota headers. Every request costs a flat 100 of 6,250 shared points
// per 15 minutes, so this module never retries blindly and never makes extra calls.
import { windowStart } from "./dates";

const ENDPOINT = "https://api.producthunt.com/v2/api/graphql";
const PAGE_SIZE = 20;
const MAX_PAGES = 20; // safety cap; the real pool is about 13 pages
const REQUEST_TIMEOUT_MS = 20_000;

const QUERY = `
query Featured($postedAfter: DateTime!, $first: Int!, $after: String) {
  posts(featured: true, postedAfter: $postedAfter, order: NEWEST, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id name tagline description url website createdAt votesCount commentsCount makerReplies
      makers { id name username headline twitterUsername websiteUrl }
      topics { edges { node { name } } }
    } }
  }
}`;

export type RawPost = Record<string, unknown>;

export type ErrorKind = "token" | "rate_limited" | "unavailable";

/** Messages are safe to show to people: they never contain the token or raw API output. */
export class ProductHuntError extends Error {
  constructor(
    public kind: ErrorKind,
    message: string,
    public resetSeconds: number | null = null,
  ) {
    super(message);
  }
}

export type FetchResult = {
  posts: RawPost[];
  pages: number;
  /** True when a later page failed after one retry, so the list may be incomplete. */
  partial: boolean;
  quotaRemaining: number | null;
  quotaResetSeconds: number | null;
};

type Options = {
  token: string | undefined;
  now: Date;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
};

const num = (v: string | null) => (v !== null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

async function requestPage(opts: Required<Pick<Options, "fetchImpl">> & Options, after: string | null) {
  const res = await opts.fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: QUERY,
      variables: { postedAfter: windowStart(opts.now), first: PAGE_SIZE, after },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  const quotaRemaining = num(res.headers.get("x-rate-limit-remaining"));
  const quotaResetSeconds = num(res.headers.get("x-rate-limit-reset"));

  if (res.status === 401 || res.status === 403) {
    throw new ProductHuntError("token", "Product Hunt did not accept the access token.");
  }
  if (res.status === 429) {
    throw new ProductHuntError("rate_limited", "Product Hunt's request limit was reached.", quotaResetSeconds);
  }
  if (!res.ok) throw new ProductHuntError("unavailable", `Product Hunt answered with status ${res.status}.`);

  const body = (await res.json()) as {
    data?: { posts?: { edges?: Array<{ node: RawPost }>; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } };
    errors?: Array<{ message?: string }>;
  };
  if (body.errors?.length) {
    const text = body.errors.map((e) => e.message ?? "").join(" ").toLowerCase();
    if (/unauthor|invalid.*token|token.*invalid|access token/.test(text)) {
      throw new ProductHuntError("token", "Product Hunt did not accept the access token.");
    }
    if (/rate|limit/.test(text)) throw new ProductHuntError("rate_limited", "Product Hunt's request limit was reached.", quotaResetSeconds);
    throw new ProductHuntError("unavailable", "Product Hunt returned an error for this request.");
  }
  const conn = body.data?.posts;
  if (!conn) throw new ProductHuntError("unavailable", "Product Hunt returned an unexpected answer.");
  return {
    posts: (conn.edges ?? []).map((e) => e.node),
    hasNext: Boolean(conn.pageInfo?.hasNextPage),
    cursor: conn.pageInfo?.endCursor ?? null,
    quotaRemaining,
    quotaResetSeconds,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchFeaturedPosts(options: Options): Promise<FetchResult> {
  if (!options.token?.trim()) {
    throw new ProductHuntError("token", "The Product Hunt access token is missing.");
  }
  const opts = { ...options, fetchImpl: options.fetchImpl ?? fetch };
  const result: FetchResult = { posts: [], pages: 0, partial: false, quotaRemaining: null, quotaResetSeconds: null };

  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    let got: Awaited<ReturnType<typeof requestPage>>;
    try {
      got = await requestPage(opts, cursor);
    } catch (err) {
      // Token problems and rate limits will not fix themselves in a moment, so no retry.
      const retryable = !(err instanceof ProductHuntError) || err.kind === "unavailable";
      if (!retryable) throw err;
      await sleep(opts.retryDelayMs ?? 500);
      try {
        got = await requestPage(opts, cursor);
      } catch (err2) {
        if (result.pages === 0 || (err2 instanceof ProductHuntError && err2.kind !== "unavailable")) {
          throw err2 instanceof ProductHuntError ? err2 : new ProductHuntError("unavailable", "Product Hunt could not be reached.");
        }
        result.partial = true;
        break;
      }
    }
    result.pages += 1;
    result.posts.push(...got.posts);
    result.quotaRemaining = got.quotaRemaining ?? result.quotaRemaining;
    result.quotaResetSeconds = got.quotaResetSeconds ?? result.quotaResetSeconds;
    if (!got.hasNext || !got.cursor) break;
    cursor = got.cursor;
  }
  return result;
}
