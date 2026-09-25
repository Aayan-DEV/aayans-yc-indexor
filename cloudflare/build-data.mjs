import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "cloudflare", "dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "search"), { recursive: true });

const library = JSON.parse(fs.readFileSync(path.join(root, "data/library.json"), "utf8"));
const companies = JSON.parse(fs.readFileSync(path.join(root, "data/companies.json"), "utf8"));
const letters = JSON.parse(fs.readFileSync(path.join(root, "data/letters.json"), "utf8"));
const tags = JSON.parse(fs.readFileSync(path.join(root, "data/jev_tags.json"), "utf8"));
const ids = JSON.parse(fs.readFileSync(path.join(root, "data/meta_vectors_v3.ids.json"), "utf8"));
const vectorIndex = new Map(ids.map((id, i) => [id, i]));

const items = library.filter((item) => companies[item.id]).map((item) => {
  const m = companies[item.id];
  return {
    id: item.id,
    file: item.file,
    name: m.name,
    tagline: m.tagline,
    description: m.description ?? "",
    industry: m.industry,
    subindustry: m.subindustry,
    tags: [...new Set([...(m.tags ?? []), ...Object.keys(tags[item.id] ?? {})])],
    letters: letters[item.id] ?? "",
    colors: item.colors,
    batch: m.batch,
    place: m.location,
    link: m.website || m.url,
    yc: m.url,
    status: m.status,
    placeholder: !!m.placeholder,
    top: !!m.top,
    vectorAt: vectorIndex.get(item.id) ?? -1,
  };
});
for (let at = 0; at < items.length; at += 2000) {
  fs.writeFileSync(path.join(out, `search/index-${at / 2000}.json`), JSON.stringify(items.slice(at, at + 2000)));
}
const raw = fs.readFileSync(path.join(root, "data/meta_vectors_v3.f32"));
const vectorChunk = 3000 * 384 * 4;
for (let at = 0; at < raw.length; at += vectorChunk) {
  fs.writeFileSync(path.join(out, `search/vectors-${at / vectorChunk}.f32`), raw.subarray(at, at + vectorChunk));
}
fs.cpSync(path.join(root, "public/atlas"), path.join(out, "atlas"), { recursive: true });
fs.cpSync(path.join(root, "public/icons"), path.join(out, "icons"), { recursive: true });
console.log(`Prepared ${items.length} searchable companies for Worker assets.`);
