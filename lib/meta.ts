import fs from "node:fs";
import path from "node:path";

/** What is known about an image beyond its pixels. Today that is the YC company a logo belongs to. */
export type ImageMeta = { name: string; tagline: string; location: string; batch: string; year: number | null; industry: string; subindustry: string; url: string; website?: string; description?: string; tags?: string[]; teamSize?: number; top?: boolean; status?: string; placeholder?: boolean }; // placeholder: YC has no logo for it, the image is a lettered tile

const FILE = path.join(process.cwd(), "data", "companies.json");
let loaded: { mtime: number; byId: Record<string, ImageMeta> } | null = null;

/** 0..1, how well known a company is: YC's own top-company flag, else the size of its team. Breaks ties between equally good fits. */
export const prominence = (m: ImageMeta | null) => (!m ? 0 : m.top ? 1 : Math.min(0.6, Math.log10(1 + (m.teamSize ?? 0)) / 5));

/** Keyed by image id (the filename without its extension). Re-read when the file changes, so no restart is needed. */
export function metaFor(id: string): ImageMeta | null {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (!loaded || loaded.mtime !== mtime) loaded = { mtime, byId: JSON.parse(fs.readFileSync(FILE, "utf8")) };
    return loaded.byId[id] ?? null;
  } catch {
    return null;
  }
}
