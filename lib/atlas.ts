import fs from "node:fs";
import path from "node:path";

/** The packed sheet of pile logos, written by `scripts/build-atlas.mjs`. Null until that has been run. */
export type PileAtlas = { cell: number; gutter: number; cols: number; sheet: string; ids: string[]; srcs: string[] };

const FILE = path.join(process.cwd(), "public", "atlas", "pile.json");
let loaded: { mtime: number; atlas: PileAtlas } | null = null;

/** Re-read when the file changes, so rebuilding the sheet needs no restart. */
export function pileAtlas(): PileAtlas | null {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (!loaded || loaded.mtime !== mtime) loaded = { mtime, atlas: JSON.parse(fs.readFileSync(FILE, "utf8")) };
    return loaded.atlas;
  } catch {
    return null; // no sheet: the page falls back to loading every icon on its own
  }
}
