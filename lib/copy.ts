// Every word on the page, from Builder_Pack/03_UI_and_Copy_Spec.md (copy IDs in comments). The
// labels "Votes (Product Hunt score)" and "Maker comments (per Product Hunt)" are fixed by CLAUDE.md.
export const COPY = {
  TITLE: "Partnership Scout",
  SUBTITLE: "Find newly launched tools worth a partnership call, from Product Hunt's last 7 days.",
  CAT_LABEL: "Categories",
  PRODUCT_LABEL: "Your product",
  PRODUCT_HELP: "Used to write each outreach angle. Edit it to match what you sell.",
  BTN_RUN: "Find partners",
  BTN_RUNNING: "Finding partners…",
  HINT_CATEGORY: "Choose at least one category.",
  SORT_LABEL: "Sort by",
  SORT_SCORE: "Highest score",
  SORT_CLOSING: "Closing soon",
  SORT_NEWEST: "Newest",
  SORT_NOTE: "Sorting re-orders these rows instantly. It does not fetch new data.",

  PROG_START: "Starting…",
  PROG_1: "Fetching featured launches from Product Hunt…",
  PROG_2: "Sorting launches into your categories…",
  PROG_3: "Ranking by votes and maker comments…",
  PROG_4: "Writing outreach angles…",

  STATUS_LIVE: "Live from Product Hunt",
  NOTE_PARTIAL: "Some launches could not be loaded, so this list may be incomplete.",
  NOTE_CATEGORY_TOPIC: "Categories for some products come from Product Hunt tags because the AI step was unavailable.",
  NOTE_REFRESH: "Another refresh is running right now, so this is the most recent saved result.",

  FOUNDER_NONE: "Founder not listed",
  FOUNDER_TIP_NONE: "Product Hunt hides most makers' names from outside apps. Use the product page to find the team.",
  METRIC_VOTES: "Votes (Product Hunt score)",
  METRIC_VOTES_TIP:
    "Product Hunt's own score for this launch. It weights votes by voter credibility and time, so it is not a raw count of upvotes.",
  METRIC_MAKER: "Maker comments (per Product Hunt)",
  METRIC_MAKER_TIP:
    "Comments written by the product's makers, as counted by Product Hunt. On busy threads it can differ from a hand count by a few comments.",
  BADGE_CLOSING: "Closing soon",
  LINK_PH: "Product Hunt page",
  LINK_SITE: "Website",
  ANGLE_LABEL: "Suggested outreach angle",
  BADGE_AI: "AI-written (Gemini)",
  BADGE_TEMPLATE: "Template (not AI-written)",
  FIT_STRONG: "Strong fit",
  FIT_PARTIAL: "Partial fit",
  FIT_WEAK: "Weak fit",
  FIT_TIP: "How naturally async standups plug into this product. It does not change the ranking.",
  BREAKDOWN_TITLE: "Score breakdown",
  CAT_SOURCE_TOPIC: "Category from Product Hunt tag",
  NO_DESCRIPTION: "No description",

  EMPTY_RESULTS: "No featured launches in your categories in the last 7 days. Try switching on more categories.",
  ERR_NO_DATA: "We could not reach Product Hunt and there is no saved result yet. Please try again in a minute.",
  BTN_RETRY: "Try again",
  ERR_TOKEN: "Setup problem: the Product Hunt access token is missing or not accepted. The site owner needs to fix this.",
  ERR_GENERIC: "Something went wrong on our side. Please try again.",

  RUN_TITLE: "Run details",
  RUN_QUOTA: "Quota was low, so a recent result was used.",
  RUN_CATEGORY_FALLBACK: "AI category step unavailable; Product Hunt tags were used.",

  FOOT_ATTR: "Powered by Product Hunt",
  FOOT_NOTE:
    "Votes are Product Hunt's weighted score. Maker comments are counted by Product Hunt and can differ from a hand count on busy threads. Angles are suggestions: check before you contact anyone.",
} as const;

export const CATEGORY_CHIP_LABELS = {
  project_management: "Project management",
  hr_tech: "HR tech",
  developer_productivity: "Developer productivity",
  team_communication: "Team communication",
} as const;

export const bannerSaved = (time: string) => `Product Hunt could not be reached just now, so this is the last real result, from ${time}.`;
export const statusLine = (p: { time: string; start: string; end: string; scanned: number; inCategories: number; shown: number }) =>
  `Data as of ${p.time}. Launches from ${p.start} to ${p.end}. ${p.scanned} featured launches scanned, ${p.inCategories} in your categories, showing the top ${p.shown}.`;
