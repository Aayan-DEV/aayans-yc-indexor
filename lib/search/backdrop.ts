import { embedText } from "@/lib/clip/helper";
import { tokenize } from "@/lib/clip/tokenizer";
import type { LibraryItem } from "@/lib/library";

/**
 * A similarity score has no zero point: 0.256 means nothing on its own, which is why the ranking pipeline can only
 * ever say which image is *most* like the words, never which images *are* like the words. The way round it is to give
 * every image its own small multiple-choice quiz: the person's description against a fixed set of generic
 * descriptions. "Does `red or orange` describe this image better than these 25 other things?" has an answer, and the
 * answer means the same for every query, so one threshold works for all of them.
 *
 * The backdrop never changes, so each image's scores against it are worked out once and kept. A search then costs one
 * pass over numbers it already has.
 */
const BACKDROP = [
  // Other colours, so a query about one colour has to beat the rest.
  "a blue logo", "a green logo", "a purple logo", "a yellow logo", "a pink logo", "a brown logo", "a grey logo",
  "a black and white logo", "a dark logo", "a pale pastel logo", "a colourful rainbow logo",
  // Other subjects.
  "a logo of an animal", "a logo of a person or a face", "a logo of a building", "a logo of a plant or a leaf",
  "a logo of food or a drink", "a logo of a vehicle", "a logo of a tool or a machine", "a map or a globe",
  // Other kinds of picture and other shapes.
  "a photograph", "a screenshot of an app", "a plain flat background", "an abstract geometric mark",
  "a circle", "a square or a rectangle", "an arrow", "a chart or a graph", "a single letter of the alphabet",
];

const TEMP = 100; // the same sharpness the rest of the search uses on CLIP similarities
const CLOSE = 0.82; // a backdrop phrase this close to the person's words would split the vote with it, so it stands down

type Table = { ids: Map<string, number>; sims: Float32Array; phrases: number[][] };
const store = globalThis as unknown as { __backdrop?: Table; __backdropJob?: Promise<Table> };

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Every image's score against every backdrop phrase. Built once, then extended as images arrive. */
export async function backdropTable(items: LibraryItem[]): Promise<Table> {
  if (store.__backdropJob) await store.__backdropJob;
  const done = store.__backdrop;
  if (done && items.every((it) => done.ids.has(it.id))) return done;

  return (store.__backdropJob = (async () => {
    const phrases = done?.phrases ?? (await Promise.all(BACKDROP.map((p) => embedText(tokenize(p)))));
    const ids = new Map<string, number>();
    const sims = new Float32Array(items.length * BACKDROP.length);
    items.forEach((it, i) => {
      ids.set(it.id, i);
      const was = done?.ids.get(it.id);
      if (was !== undefined) sims.set(done!.sims.subarray(was * BACKDROP.length, (was + 1) * BACKDROP.length), i * BACKDROP.length);
      else for (let k = 0; k < phrases.length; k++) sims[i * BACKDROP.length + k] = dot(it.vector, phrases[k]);
    });
    return (store.__backdrop = { ids, sims, phrases });
  })().finally(() => (store.__backdropJob = undefined)));
}

/**
 * The verdict for every image at once: how strongly the person's words beat the backdrop, image by image.
 * 1 means nothing else comes close, 0 means the backdrop describes it better.
 */
export function contest(table: Table, queryVector: number[], sims: number[]): number[] {
  const width = BACKDROP.length;
  // A phrase that means almost what the person wrote would split the vote with them, so it is left out of the quiz.
  const keep: number[] = [];
  for (let k = 0; k < width; k++) if (dot(table.phrases[k], queryVector) < CLOSE) keep.push(k);

  return sims.map((mine, i) => {
    const row = i * width;
    let best = mine;
    for (const k of keep) best = Math.max(best, table.sims[row + k]);
    let rest = 0;
    for (const k of keep) rest += Math.exp(TEMP * (table.sims[row + k] - best));
    const own = Math.exp(TEMP * (mine - best));
    return own / (own + rest);
  });
}
