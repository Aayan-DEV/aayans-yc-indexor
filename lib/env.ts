import fs from "node:fs";
import path from "node:path";

let loaded = false;

/** Reads KEY=value pairs from the parent project's .env once, so the Vercel key lives in one place. Never logs values. */
function loadParentEnv() {
  if (loaded) return;
  loaded = true;
  const file = path.resolve(process.cwd(), "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

export function typesafeKey(): string | undefined {
  loadParentEnv();
  return process.env.TYPE_SAFE_KEY || process.env.TYPESAFE_API_KEY;
}

export function vercelKey(): string | undefined {
  loadParentEnv();
  return process.env.VERCEL_API_KEY || process.env.AI_GATEWAY_API_KEY;
}

/** "batch" sends every icon to classifier.dev in one request (fast for many items). "vercel" tries the gateway first. */
export function jevPrimary(): "batch" | "vercel" {
  loadParentEnv();
  return process.env.JEV_PRIMARY === "vercel" ? "vercel" : "batch";
}
