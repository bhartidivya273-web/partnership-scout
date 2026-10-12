// Builds the real dependencies from the server's environment settings (never sent to the browser).
import { loadSnapshot } from "./bundle";
import { makeGemini } from "./gemini";
import type { Deps } from "./scout";
import { getStore } from "./store";

export function getDeps(env: Record<string, string | undefined> = process.env): Deps {
  return {
    store: getStore(env),
    gen: makeGemini({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, fallbackModel: env.GEMINI_FALLBACK_MODEL }),
    model: env.GEMINI_MODEL?.trim() || "unset",
    token: env.PRODUCT_HUNT_TOKEN,
    snapshot: loadSnapshot(),
  };
}
