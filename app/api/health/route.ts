// Reports only whether each setting is present, never its value, so it is safe to leave public.
// With the right header it also tests that Gemini answers and reports only a one-word reason if not.
// (The header key is derived from the Product Hunt token, so there is no extra secret to manage and
// strangers cannot spend Gemini calls.)
import { createHash } from "node:crypto";
import { GeminiError, makeGemini } from "@/lib/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NAMES = ["PRODUCT_HUNT_TOKEN", "GEMINI_API_KEY", "GEMINI_MODEL"] as const;

export const checkKey = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 16);

export async function GET(request: Request) {
  const settings: Record<string, boolean> = {};
  for (const name of NAMES) settings[name] = Boolean(process.env[name]?.trim());
  const body: Record<string, unknown> = { ok: true, settingsPresent: settings };

  const token = process.env.PRODUCT_HUNT_TOKEN ?? "";
  if (token && request.headers.get("x-check-key") === checkKey(token)) {
    const gen = makeGemini({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL,
      fallbackModel: process.env.GEMINI_FALLBACK_MODEL,
    });
    if (!gen) {
      body.gemini = "not_configured";
    } else {
      try {
        await gen({ system: "Reply with JSON.", user: "ping", schema: { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } } }, attempt: 0 });
        body.gemini = "ok";
      } catch (err) {
        body.gemini = err instanceof GeminiError ? err.kind : "other";
      }
    }
  }
  return Response.json(body);
}
