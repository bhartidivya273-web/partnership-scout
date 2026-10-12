// The only AI in the app is Gemini Flash (exam rule). Plain HTTPS calls: no extra packages, and
// the key travels in a header (never in the URL), so it cannot end up in logs or error text.
export type GeminiRequest = {
  system: string;
  user: string;
  /** JSON schema for the answer; Gemini is asked to return JSON that matches it. */
  schema: object;
  /** 0 for the first try; 1 for the retry, which switches to the fallback model if there is one. */
  attempt: number;
};

/** Returns the parsed JSON answer, or throws. Injected so tests never call the real API. */
export type GeminiFn = (req: GeminiRequest) => Promise<unknown>;

export class GeminiError extends Error {
  constructor(public kind: "rate_limit" | "auth" | "model" | "format" | "timeout" | "other", message: string) {
    super(message);
  }
}

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 45_000; // worst case 2 calls per job x 2 jobs stays inside the 300-second route limit

type Config = { apiKey?: string; model?: string; fallbackModel?: string; fetchImpl?: typeof fetch };

/** Builds the real Gemini function, or null when no key is set (callers then use their fallbacks). */
export function makeGemini(config: Config): GeminiFn | null {
  const { apiKey, model, fallbackModel } = config;
  if (!apiKey?.trim() || !model?.trim()) return null;
  const doFetch = config.fetchImpl ?? fetch;

  return async (req) => {
    const useModel = req.attempt > 0 && fallbackModel?.trim() ? fallbackModel.trim() : model.trim();
    const generationConfig: Record<string, unknown> = {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: req.schema,
      // Speed matters for a one-minute demo; "low" keeps answers fast and good enough for sorting.
      thinkingConfig: { thinkingLevel: "low" },
    };
    const send = () =>
      doFetch(`${BASE}/${useModel}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });

    let res: Response;
    try {
      res = await send();
      // Some models reject a thinking level; ask again without it rather than failing the run.
      if (res.status === 400 && /thinking/i.test(await res.clone().text())) {
        delete generationConfig.thinkingConfig;
        res = await send();
      }
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new GeminiError(timedOut ? "timeout" : "other", timedOut ? "Gemini took too long." : "Gemini could not be reached.");
    }

    if (res.status === 429) throw new GeminiError("rate_limit", "Gemini rate limit reached.");
    // Google answers a wrong or malformed key with a plain 400 rather than 401, so look at the reason.
    if (res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(await res.clone().text())) {
      throw new GeminiError("auth", "Gemini did not accept the API key.");
    }
    if (res.status === 401 || res.status === 403) throw new GeminiError("auth", "Gemini did not accept the API key.");
    if (res.status === 404) throw new GeminiError("model", "The Gemini model name was not found.");
    if (!res.ok) throw new GeminiError("other", `Gemini answered with status ${res.status}.`);

    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    try {
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      throw new GeminiError("format", "Gemini did not return valid JSON.");
    }
  };
}
