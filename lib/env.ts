import fs from "node:fs";
import path from "node:path";

let loaded = false;

/**
 * Where the keys come from, in order:
 *
 *  1. the real environment, which is what a deployment sets;
 *  2. `.env.local` / `.env` in this project, which Next loads on its own before any of this runs;
 *  3. a `.env` one directory up, for the case where this sits beside sibling projects that share one key file.
 *
 * Only the third needs doing by hand, and it never overwrites anything already set. Values are never logged.
 * See `.env.example` for the names.
 */
function loadEnv() {
  if (loaded) return;
  loaded = true;
  const beside = path.resolve(process.cwd(), "..", ".env");
  if (!fs.existsSync(beside)) return;
  for (const line of fs.readFileSync(beside, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

export function typesafeKey(): string | undefined {
  loadEnv();
  return process.env.TYPE_SAFE_KEY || process.env.TYPESAFE_API_KEY;
}

export function vercelKey(): string | undefined {
  loadEnv();
  return process.env.VERCEL_API_KEY || process.env.AI_GATEWAY_API_KEY;
}

/** "batch" sends every icon to classifier.dev in one request (fast for many items). "vercel" tries the gateway first. */
export function jevPrimary(): "batch" | "vercel" {
  loadEnv();
  return process.env.JEV_PRIMARY === "vercel" ? "vercel" : "batch";
}
