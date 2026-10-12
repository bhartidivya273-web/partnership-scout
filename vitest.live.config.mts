// Separate config for scripts that talk to the real services (never part of `npm test`).
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: { include: ["scripts/**/*.live.ts"], env: loadEnv(mode, process.cwd(), ""), testTimeout: 300_000 },
}));
