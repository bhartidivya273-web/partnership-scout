// Reports only whether each setting is present, never its value, so it is safe to leave public.
// Used to prove on Vercel that the environment variables were picked up after a deploy.
export const dynamic = "force-dynamic";

const NAMES = ["PRODUCT_HUNT_TOKEN", "GEMINI_API_KEY", "GEMINI_MODEL"] as const;

export function GET() {
  const settings: Record<string, boolean> = {};
  for (const name of NAMES) settings[name] = Boolean(process.env[name]?.trim());
  return Response.json({ ok: true, settingsPresent: settings });
}
