// Kavya's four categories and the Product Hunt topic table used when the AI step is unavailable.
export const CATEGORY_KEYS = ["project_management", "hr_tech", "developer_productivity", "team_communication"] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  project_management: "Project management",
  hr_tech: "HR tech",
  developer_productivity: "Developer productivity",
  team_communication: "Team communication",
};

export const isCategoryKey = (v: unknown): v is CategoryKey => CATEGORY_KEYS.includes(v as CategoryKey);

// Nearest Product Hunt topics (PRD F9d). Product Hunt has no topic called "developer productivity"
// or "team communication", so this is only a rough fallback, always flagged on screen.
const TOPIC_TABLE: Record<string, CategoryKey> = {
  "task management": "project_management",
  "human resources": "hr_tech",
  hiring: "hr_tech",
  "developer tools": "developer_productivity",
  "software engineering": "developer_productivity",
  meetings: "team_communication",
  messaging: "team_communication",
  "remote work": "team_communication",
  slack: "team_communication",
};

/** Every category whose nearest topic appears; topics like "Artificial Intelligence" assign none. */
export function categoriesFromTopics(topics: string[]): CategoryKey[] {
  const found = new Set<CategoryKey>();
  for (const t of topics) {
    const key = TOPIC_TABLE[t.trim().toLowerCase()];
    if (key) found.add(key);
  }
  return CATEGORY_KEYS.filter((k) => found.has(k));
}
