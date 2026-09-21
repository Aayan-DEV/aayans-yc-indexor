import fs from "node:fs";
import path from "node:path";

/**
 * What Jev says each company actually does, in YC's own vocabulary (see scripts/tag-companies.mjs).
 *
 * YC's own tags are what a founder typed into a form once. These are what the company is, judged from the write-up and
 * from what Jev already knows: Context.dev comes back Web Development, not only APIs, so a search for web scraping can
 * reach it although the word "scrape" appears nowhere in anything it has written.
 */
const FILE = path.join(process.cwd(), "data", "jev_tags.json");
const SURE = 0.3; // how likely a word has to be before the company is filed under it

let loaded: { mtime: number; byId: Record<string, Record<string, number>> } | null = null;

function all(): Record<string, Record<string, number>> {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (!loaded || loaded.mtime !== mtime) loaded = { mtime, byId: JSON.parse(fs.readFileSync(FILE, "utf8")) };
    return loaded.byId;
  } catch {
    return {};
  }
}

/** The words Jev is confident about for this company, most likely first. */
export function jevTagsFor(id: string): string[] {
  const mine = all()[id];
  return mine ? Object.entries(mine).filter(([, p]) => p >= SURE).sort((a, b) => b[1] - a[1]).map(([tag]) => tag) : [];
}

export const jevTagsKnown = () => Object.keys(all()).length;
