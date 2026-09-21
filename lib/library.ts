import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { embedImage } from "./clip/helper";

export type LibraryItem = { id: string; file: string; src: string; title: string; colors: string[]; colorText: string; vector: number[]; addedAt: number; indexMs: number; hash: string };

// The comment stops Turbopack from tracing every image in the folder into the server bundle (it matched 25,000 files).
export const FOLDER = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "icons");
export const srcFor = (file: string) => `/library/${encodeURIComponent(file)}`; // served by app/library/[file], so images added after a build still load
const SAVE = path.join(process.cwd(), "data", "library.json");
export const IMAGE = /\.(webp|png|jpe?g|gif|avif)$/i; // formats every browser can also display

type State = { items: Map<string, LibraryItem>; version: number; ready: Promise<void> | null; busy: Set<string>; titles: Record<string, string> };
const store = globalThis as unknown as { __library?: State };
const state: State = (store.__library ??= { items: new Map(), version: 0, ready: null, busy: new Set(), titles: {} });

function titleFor(file: string): string {
  const stem = file.replace(/\.[^.]+$/, "");
  return state.titles[stem.split("_")[0]] ?? stem.replace(/^\d+_/, "").replace(/[-_]+/g, " ");
}

let saveTimer: NodeJS.Timeout | null = null;
function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  // 5 decimals lose nothing that matters for cosine similarity and make the file about half the size.
  const compact = (_k: string, v: unknown) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e5) / 1e5 : v);
  saveTimer = setTimeout(() => fs.promises.writeFile(SAVE, JSON.stringify([...state.items.values()], compact)).catch(() => {}), 1500);
}

/** Embeds one file and makes it searchable. Safe to call twice for the same file: the second call is a no-op. */
async function add(file: string) {
  if (!IMAGE.test(file) || state.items.has(file) || state.busy.has(file)) return;
  state.busy.add(file);
  try {
    const full = path.join(FOLDER, file);
    // A file being copied in can be seen before its bytes are all there, so wait until its size stops changing.
    let size = -1;
    for (let i = 0; i < 40; i++) {
      const now = (await fs.promises.stat(full)).size;
      if (now > 0 && now === size) break;
      size = now;
      await new Promise((r) => setTimeout(r, 25));
    }
    const started = performance.now();
    const hash = crypto.createHash("sha1").update(await fs.promises.readFile(full)).digest("hex"); // identifies the picture whatever the file is called
    const r = await embedImage(full);
    state.items.set(file, { id: file.replace(/\.[^.]+$/, ""), file, src: srcFor(file), title: titleFor(file), colors: r.colors,
                            colorText: r.colorText, vector: r.embedding, addedAt: Date.now(), indexMs: Math.round(performance.now() - started), hash });
    state.version++;
    saveSoon();
  } catch {
    // unreadable or half-written file: the next folder event, or the next scan, will pick it up again
  } finally {
    state.busy.delete(file);
  }
}

function remove(file: string) {
  if (state.items.delete(file)) {
    state.version++;
    saveSoon();
  }
}

async function boot() {
  try {
    state.titles = JSON.parse(await fs.promises.readFile(path.join(process.cwd(), "indexer", "titles.json"), "utf8"));
  } catch {}
  try {
    for (const item of JSON.parse(await fs.promises.readFile(SAVE, "utf8")) as LibraryItem[]) if (item.hash) state.items.set(item.file, { ...item, src: srcFor(item.file) }); // entries saved before hashing existed are re-indexed
  } catch {}
  const onDisk = new Set((await fs.promises.readdir(FOLDER)).filter((f) => IMAGE.test(f)));
  for (const file of [...state.items.keys()]) if (!onDisk.has(file)) remove(file);
  for (const file of onDisk) await add(file); // only files not embedded before cost anything here

  // From here on the folder is watched: drop an image in and it is searchable a moment later.
  fs.watch(FOLDER, (_event, file) => {
    if (!file) return;
    fs.promises.access(path.join(FOLDER, file)).then(() => add(file), () => remove(file));
  });
}

export async function library(): Promise<{ items: LibraryItem[]; version: number }> {
  await (state.ready ??= boot());
  return { items: [...state.items.values()], version: state.version };
}

/** Index one file right now and hand back its entry. Used by uploads, so the page does not wait for the folder watcher. */
export async function ingest(file: string): Promise<LibraryItem | null> {
  await (state.ready ??= boot());
  await add(file);
  return state.items.get(file) ?? null;
}

export async function has(file: string): Promise<boolean> {
  await (state.ready ??= boot());
  return state.items.has(file);
}

/** The entry that already holds this exact picture, if any, whatever its filename. */
export async function findByHash(hash: string): Promise<LibraryItem | null> {
  await (state.ready ??= boot());
  for (const item of state.items.values()) if (item.hash === hash) return item;
  return null;
}
