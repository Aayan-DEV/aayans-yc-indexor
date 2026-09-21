import fs from "node:fs";
import path from "node:path";

/**
 * CLIP's byte-pair-encoding tokenizer (BPE: text is split into frequent sub-word pieces, each with an id).
 * MobileCLIP uses the same vocabulary as CLIP. Output is always 77 ids: start, pieces, end, then zeros.
 * Checked against the reference Python tokenizer on all 66 benchmark queries (scripts/check-tokenizer).
 */
const CONTEXT = 77;
const START = 49406;
const END = 49407;
const PATTERN = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;

let vocab: Record<string, number> | null = null;
let ranks: Map<string, number> | null = null;
const cache = new Map<string, string[]>();

function load() {
  if (vocab && ranks) return;
  const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "clip_tokenizer.json"), "utf8")) as { vocab: Record<string, number>; merges: string[] };
  vocab = data.vocab;
  ranks = new Map(data.merges.map((m, i) => [m, i]));
}

/** GPT-2 style byte to printable-character table, so any UTF-8 byte has a visible stand-in. */
const byteToChar = (() => {
  const keep: number[] = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  const table = new Map<number, string>();
  let extra = 0;
  for (let b = 0; b < 256; b++) table.set(b, String.fromCodePoint(keep.includes(b) ? b : 256 + extra++));
  return table;
})();

function bpe(token: string): string[] {
  const hit = cache.get(token);
  if (hit) return hit;
  const chars = [...token];
  let word = [...chars.slice(0, -1), chars[chars.length - 1] + "</w>"]; // the last piece carries an end-of-word marker
  while (word.length > 1) {
    let best = -1;
    let bestRank = Infinity;
    for (let i = 0; i < word.length - 1; i++) {
      const rank = ranks!.get(`${word[i]} ${word[i + 1]}`);
      if (rank !== undefined && rank < bestRank) {
        bestRank = rank;
        best = i;
      }
    }
    if (best < 0) break;
    word = [...word.slice(0, best), word[best] + word[best + 1], ...word.slice(best + 2)];
  }
  cache.set(token, word);
  return word;
}

export function tokenize(text: string): number[] {
  load();
  const clean = text.toLowerCase().replace(/\s+/g, " ").trim();
  const ids: number[] = [];
  for (const match of clean.match(PATTERN) ?? []) {
    const mapped = [...new TextEncoder().encode(match)].map((b) => byteToChar.get(b)!).join("");
    for (const piece of bpe(mapped)) {
      const id = vocab![piece];
      if (id !== undefined) ids.push(id);
    }
  }
  const out = [START, ...ids.slice(0, CONTEXT - 2), END];
  return [...out, ...new Array(CONTEXT - out.length).fill(0)];
}
