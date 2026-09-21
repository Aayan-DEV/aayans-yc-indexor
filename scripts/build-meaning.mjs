/**
 * Builds data/meta_vectors_v3.f32, one bge-small vector per company, in one pass.
 * The server can fill these in lazily, but it takes about two minutes, so do it here instead.
 *   node scripts/build-meaning.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "@huggingface/transformers";

const DIM = 384;
const root = process.cwd();
const meta = JSON.parse(fs.readFileSync(path.join(root, "data", "companies.json"), "utf8"));
const library = JSON.parse(fs.readFileSync(path.join(root, "data", "library.json"), "utf8"));
const jevTags = fs.existsSync(path.join(root, "data", "jev_tags.json")) ? JSON.parse(fs.readFileSync(path.join(root, "data", "jev_tags.json"), "utf8")) : {};
const alsoTags = (id) => Object.entries(jevTags[id] ?? {}).filter(([, p]) => p >= 0.3).map(([t]) => t);
const ids = library.map((it) => it.id).filter((id) => meta[id]);
// The same text the app indexes: YC's words plus the ones Jev says really describe the company.
const text = (id, m) => `${m.name}. ${m.tagline} ${[...new Set([...(m.tags ?? []), ...alsoTags(id)])].join(", ")}. ${m.subindustry}. ${m.description ?? ""}`.replace(/\s+/g, " ").trim();

const embed = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", { dtype: "q8" });
const flat = new Float32Array(ids.length * DIM);
const began = Date.now();
const BATCH = 32;
for (let at = 0; at < ids.length; at += BATCH) {
  const slice = ids.slice(at, at + BATCH).map((id) => text(id, meta[id]) || "nothing");
  const out = await embed(slice, { pooling: "cls", normalize: true });
  flat.set(out.data.slice(0, slice.length * DIM), at * DIM);
  if (at % 1600 === 0) console.log(`  ${at}/${ids.length}  ${((Date.now() - began) / 1000).toFixed(0)}s`);
}
fs.writeFileSync(path.join(root, "data", "meta_vectors_v3.f32"), Buffer.from(flat.buffer));
fs.writeFileSync(path.join(root, "data", "meta_vectors_v3.ids.json"), JSON.stringify(ids));
console.log(`${ids.length} companies in ${((Date.now() - began) / 1000).toFixed(0)}s`);
