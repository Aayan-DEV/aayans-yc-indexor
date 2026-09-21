import fs from "node:fs";
import path from "node:path";
import { DIM, embedMeaning } from "@/lib/text/embed";
import type { LibraryItem } from "@/lib/library";
import { jevTagsFor } from "@/lib/jev-tags";
import { lettersFor } from "@/lib/letters";
import { metaFor, type ImageMeta } from "@/lib/meta";

/**
 * What is written about each image (company name, tagline, tags, long description, industry, place, batch), made findable two ways:
 * by shared words (exact, instant) and by meaning (the same MobileCLIP text encoder, so "food brought to your door"
 * lands near "restaurant delivery"). Both only shortlist. Jev makes the actual judgement.
 */
type Doc = { id: string; meta: ImageMeta; category: string; words: Map<string, number>; vector: Float32Array | null };
type Index = { key: string; docs: Map<string, Doc>; idf: Map<string, number>; categories: string[] };

/** "Consumer > Food and Beverage": the label Jev chooses between when it works out what a description is about. */
export const categoryOf = (m: ImageMeta) => (m.subindustry ? `${m.industry} > ${m.subindustry}` : m.industry);

// v3: a real sentence model (bge-small) replaced MobileCLIP's text tower here, and the vectors are 384 wide instead of
// 512. A new file name, so old vectors can never be read as new ones.
const VECTORS = path.join(process.cwd(), "data", "meta_vectors_v3.f32");
const VECTOR_IDS = path.join(process.cwd(), "data", "meta_vectors_v3.ids.json");
const STOP = new Set("the a an and or of for to in on with by is are that this it its your you we our from as at be your their all any logo icon app company startup looks like".split(" "));
const store = globalThis as unknown as { __textIndex?: Index; __textVectors?: Map<string, Float32Array>; __textVectorJob?: Promise<void> };

export const words = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));

// Jev reads whatever it is sent, so there is no reason to cut a description down to a sentence and a half: the most
// useful line in Context.dev's write-up starts at character 180, and Jev had never once seen it.
const brief = (text: string | undefined, max: number) => {
  if (!text || max <= 0) return "";
  if (text.length <= max) return text;
  const space = text.lastIndexOf(" ", max);
  return `${text.slice(0, space > 20 ? space : max)}…`;
};

/** One line Jev can read about an image. */
export const infoLine = (m: ImageMeta, detail = 420) =>
  [`${m.name}${m.tagline ? `: ${m.tagline}` : ""}`, m.tags?.join(", "), [m.subindustry, m.industry].filter(Boolean).join(", "), m.location, m.batch && `Y Combinator ${m.batch}`, brief(m.description, detail)].filter(Boolean).join(" | ");

/** What the meaning-vector is made from. MobileCLIP reads 77 tokens, so the most telling parts come first. */
// bge reads 512 tokens, so there is no reason to cut this down the way CLIP's 77 forced.
export const meaningText = (m: ImageMeta, alsoTags: string[] = []) =>
  `${m.name}. ${m.tagline} ${[...new Set([...(m.tags ?? []), ...alsoTags])].join(", ")}. ${m.subindustry}. ${m.description ?? ""}`.replace(/\s+/g, " ").trim();

function loadVectors(): Map<string, Float32Array> {
  if (store.__textVectors) return store.__textVectors;
  const map = new Map<string, Float32Array>();
  try {
    const ids = JSON.parse(fs.readFileSync(VECTOR_IDS, "utf8")) as string[];
    const raw = fs.readFileSync(VECTORS);
    const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    ids.forEach((id, i) => map.set(id, all.slice(i * DIM, (i + 1) * DIM)));
  } catch {}
  return (store.__textVectors = map);
}

/** Embeds whatever has no meaning-vector yet, in the background, and saves the lot. About 8 ms per company, once. */
function embedMissing(docs: Doc[]) {
  if (store.__textVectorJob) return;
  const vectors = loadVectors();
  const todo = docs.filter((d) => !vectors.has(d.id));
  if (!todo.length) return;
  store.__textVectorJob = (async () => {
    const BATCH = 32;
    for (let at = 0; at < todo.length; at += BATCH) {
      const slice = todo.slice(at, at + BATCH);
      try {
        const made = await embedMeaning(slice.map((d) => meaningText(d.meta, jevTagsFor(d.id))));
        slice.forEach((doc, i) => {
          vectors.set(doc.id, made[i]);
          doc.vector = made[i];
        });
      } catch {}
    }
    const ids = [...vectors.keys()];
    const flat = new Float32Array(ids.length * DIM);
    ids.forEach((id, i) => flat.set(vectors.get(id)!, i * DIM));
    await fs.promises.writeFile(VECTORS, Buffer.from(flat.buffer));
    await fs.promises.writeFile(VECTOR_IDS, JSON.stringify(ids));
  })().finally(() => (store.__textVectorJob = undefined));
}

export function textIndex(items: LibraryItem[], version: number): Index {
  const key = `r8:${version}`; // bump the prefix when the way words are read changes
  if (store.__textIndex?.key === key) return store.__textIndex;
  const vectors = loadVectors();
  const docs = new Map<string, Doc>();
  const seenIn = new Map<string, number>();
  for (const item of items) {
    const meta = metaFor(item.id);
    if (!meta) continue;
    const bag = new Map<string, number>();
    for (const w of words(meta.name)) bag.set(w, (bag.get(w) ?? 0) + 3); // a name match counts for more than a tagline match
    for (const w of words(`${meta.tagline} ${meta.tags?.join(" ") ?? ""}`)) bag.set(w, (bag.get(w) ?? 0) + 2); // what the company says it is, in its own short words
    for (const w of words(jevTagsFor(item.id).join(" "))) bag.set(w, (bag.get(w) ?? 0) + 2); // and what Jev says it actually does
    for (const w of words(`${meta.description ?? ""} ${meta.subindustry} ${meta.industry} ${meta.location} ${meta.batch}`)) bag.set(w, (bag.get(w) ?? 0) + 1);
    for (const w of words(lettersFor(item.id) ?? "")) bag.set(w, (bag.get(w) ?? 0) + 2); // what the logo itself says, read by Vision
    for (const w of bag.keys()) seenIn.set(w, (seenIn.get(w) ?? 0) + 1);
    docs.set(item.id, { id: item.id, meta, category: categoryOf(meta), words: bag, vector: vectors.get(item.id) ?? null });
  }
  const idf = new Map<string, number>();
  for (const [w, n] of seenIn) idf.set(w, Math.log(1 + docs.size / n));
  embedMissing([...docs.values()]);
  const categories = [...new Set([...docs.values()].map((d) => d.category))].filter((c) => c && c !== "Unspecified").sort();
  return (store.__textIndex = { key, docs, idf, categories });
}

/** How well each image's written info matches the description, by shared words and by meaning. Both 0..1, best = 1. */
export function textScores(index: Index, query: string, queryVector: ArrayLike<number>): { byId: Map<string, { lexical: number; meaning: number }>; coverage: number } {
  const q = [...new Set(words(query))];
  const out = new Map<string, { lexical: number; meaning: number }>();
  let bestCovered = 0;
  const askable = q.reduce((sum, w) => sum + (index.idf.get(w) ?? 6), 0); // a word no company uses still counts as unmatched
  let bestLex = 0;
  let bestMean = -1;
  for (const doc of index.docs.values()) {
    let lexical = 0;
    let covered = 0;
    for (const w of q) {
      const tf = doc.words.get(w);
      if (!tf) continue;
      lexical += (index.idf.get(w) ?? 0) * (1 + Math.log(tf));
      covered += index.idf.get(w) ?? 0;
    }
    bestCovered = Math.max(bestCovered, covered);
    let meaning = -1;
    if (doc.vector) {
      meaning = 0;
      for (let i = 0; i < DIM; i++) meaning += doc.vector[i] * queryVector[i];
    }
    bestLex = Math.max(bestLex, lexical);
    bestMean = Math.max(bestMean, meaning);
    out.set(doc.id, { lexical, meaning });
  }
  for (const s of out.values()) {
    s.lexical = bestLex > 0 ? s.lexical / bestLex : 0;
    s.meaning = s.meaning < 0 ? 0 : Math.exp(40 * (s.meaning - bestMean)); // text-to-text similarities sit close together, so sharpen them
  }
  // coverage: how much of the description some single image's written info accounts for. High = the person is
  // describing a company, not a picture.
  return { byId: out, coverage: askable > 0 ? bestCovered / askable : 0 };
}
