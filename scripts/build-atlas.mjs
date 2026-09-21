/**
 * Packs the pile's logos into one image.
 *
 * The pile draws up to 1,200 icons. Fetched one file at a time that is 1,200 requests through a Node route, which on a
 * warm machine was still delivering images seventeen seconds after the page opened. Packed into a single sheet it is
 * one request of about a megabyte, and on the client one texture instead of 1,200, which is what lets the canvas draw
 * a thousand rotating icons in a couple of milliseconds.
 *
 * The sheet holds a fixed, seeded sample of the library, because the page and the sheet have to agree on which
 * companies are in it. Variety comes from the churn, which swaps a logo out every second or so, and from the pile
 * being shuffled into different positions on every visit.
 *
 *   node scripts/build-atlas.mjs
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const CELL = 64; // a pile icon is at most 25 css px, so 50 device pixels on a retina screen: 64 has room to spare
const GUTTER = 2; // transparent pixels between cells, so a rotating icon cannot smear its neighbour into its own edge
const COLS = 48;
const COUNT = 1200; // what the slider on the page can ask for at most
const SEED = 0x5eed1c04;

const pitch = CELL + GUTTER;
const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const library = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "library.json"), "utf8"));
const companies = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "companies.json"), "utf8"));

// The same set the page fills its pile from: companies YC has a real logo for. A lettered stand-in tile is findable by
// search but would only make the pile look like a page of initials.
const eligible = library.filter((it) => companies[it.id] && !companies[it.id].placeholder);
const random = mulberry32(SEED);
for (let i = eligible.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
}
const chosen = eligible.slice(0, COUNT);
const rows = Math.ceil(chosen.length / COLS);
console.log(`${eligible.length} logos to choose from, packing ${chosen.length} into ${COLS}x${rows} cells of ${CELL}px`);

const started = Date.now();
let failed = 0;
const tiles = await Promise.all(
  chosen.map(async (item, at) => {
    try {
      // Centre-cropped to a square, exactly as the canvas does when it draws one, so the sheet changes nothing about
      // how a logo looks.
      const buffer = await sharp(path.join(ROOT, "public", "icons", item.file))
        .resize(CELL, CELL, { fit: "cover", position: "centre", kernel: "lanczos3" })
        .ensureAlpha()
        .png()
        .toBuffer();
      return { input: buffer, left: (at % COLS) * pitch, top: Math.floor(at / COLS) * pitch };
    } catch {
      failed++; // an unreadable file leaves its cell empty; the page falls back to loading that one on its own
      return null;
    }
  }),
);

const sheet = sharp({ create: { width: COLS * pitch, height: rows * pitch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(tiles.filter(Boolean));

const out = path.join(ROOT, "public", "atlas");
fs.mkdirSync(out, { recursive: true });
// Lossless, because a logo is flat colour and hard edges: lossy WebP puts rings around the edges at this size, and
// lossless is actually the smaller file for this kind of picture.
await sheet.webp({ lossless: true, effort: 6 }).toFile(path.join(out, "pile.webp"));
fs.writeFileSync(
  path.join(out, "pile.json"),
  JSON.stringify({ cell: CELL, gutter: GUTTER, cols: COLS, sheet: "/atlas/pile.webp", ids: chosen.map((i) => i.id), srcs: chosen.map((i) => i.src) }),
);

const bytes = fs.statSync(path.join(out, "pile.webp")).size;
console.log(`public/atlas/pile.webp  ${(bytes / 1048576).toFixed(2)} MB  (${Math.round(bytes / chosen.length)} bytes per logo)  in ${((Date.now() - started) / 1000).toFixed(1)}s${failed ? `, ${failed} unreadable` : ""}`);
