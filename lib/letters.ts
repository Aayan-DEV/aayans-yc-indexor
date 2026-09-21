import fs from "node:fs";
import path from "node:path";

/**
 * The words printed inside each picture, read once by Apple's Vision (see scripts/read-letters.mjs).
 * The image model cannot read, so this is the only way the app knows whether a logo says anything, and what.
 */
const FILE = path.join(process.cwd(), "data", "letters.json");
let loaded: { mtime: number; byId: Record<string, string> } | null = null;

function all(): Record<string, string> {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (!loaded || loaded.mtime !== mtime) loaded = { mtime, byId: JSON.parse(fs.readFileSync(FILE, "utf8")) };
    return loaded.byId;
  } catch {
    return {};
  }
}

/** What this picture says, or "" when it says nothing. Undefined means it has not been read yet. */
export const lettersFor = (id: string): string | undefined => all()[id];

/** How far through the library the reading has got, for the search to know whether it can answer about text at all. */
export const lettersKnown = () => Object.keys(all()).length;
