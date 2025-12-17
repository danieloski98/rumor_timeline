import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export type AppEnv = "local" | "dev" | "uat" | "production";

function normalizeEnv(raw: unknown): AppEnv {
  const v = String(raw ?? "").trim().toLowerCase();

  // allow common NODE_ENV values
  if (v === "" || v === "local") return "local";
  if (v === "dev" || v === "development") return "dev";
  if (v === "uat") return "uat";
  if (v === "prod" || v === "production") return "production";

  // fallback: treat unknown values as local (safe default)
  return "local";
}

function loadIfExists(envPath: string, override: boolean): boolean {
  if (!fs.existsSync(envPath)) return false;
  dotenv.config({ path: envPath, override });
  return true;
}

/**
 * Loads environment variables from:
 * - `.env` (default/local base)
 * - `.env.<env>` where <env> is one of: dev | uat | production
 *
 * Selection is based on APP_ENV (preferred) then NODE_ENV.
 */
export function loadEnv(options?: { cwd?: string }): { env: AppEnv; loaded: string[] } {
  const cwd = options?.cwd ?? process.cwd();
  const env = normalizeEnv(process.env.APP_ENV ?? process.env.NODE_ENV);

  const loaded: string[] = [];

  const basePath = path.join(cwd, ".env");
  if (loadIfExists(basePath, false)) loaded.push(basePath);

  // overlay file for non-local environments
  if (env !== "local") {
    const overlayPath = path.join(cwd, `.env.${env}`);
    if (loadIfExists(overlayPath, true)) loaded.push(overlayPath);
  }

  // expose the normalized env (without overwriting if user set it explicitly)
  process.env.APP_ENV ??= env;

  return { env, loaded };
}


