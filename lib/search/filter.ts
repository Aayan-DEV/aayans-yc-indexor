import { embedText } from "@/lib/clip/helper";
import { tokenize } from "@/lib/clip/tokenizer";
import { judge, type When } from "@/lib/jev/judge";
import type { LibraryItem } from "@/lib/library";
import { backdropTable, contest } from "./backdrop";
import { infoLine } from "./textIndex";

/**
 * "Give me all of them" is a different question from "which one did I mean", and needs a different answer.
 * Ranking picks a winner out of a shortlist. Filtering asks every image, one at a time, whether it qualifies, so the
 * answer can be one image or five hundred. Nothing here competes with anything else.
 */
const CHUNK = 120; // candidates Jev reads in one call
const CHUNKS = 3; // at most, run side by side: a big category is read to about 360 deep

// Words that only frame the request and say nothing about the picture. "companies with all shades of red/orange type
// logos" and "a logo that is red or orange" mean the same to a person, but to the image model they are far apart: the
// first found 51 images, the second 477, both about 97% correct. So the framing comes off and the rest is asked plainly.
const FRAMING =
  /\b(all|every|any|some|show|find|get|give|list|me|us|please|which|ones?|that|those|these|with|having|have|has|in|it|their|containing|companies|company|startups?|businesses|brands?|logos?|icons?|images?|pictures?|type|types|kind|kinds|sort|sorts|style|styles|shades?|colou?red|no|none|without|only|just)\b/gi;

/** What the person actually described, with the request's scaffolding taken away. */
export function core(query: string): string {
  return query
    .replace(/[/,]+/g, " or ")
    .replace(FRAMING, " ")
    .replace(/\s+of\s+/gi, " ")
    .replace(/[^\p{L}\p{N}\s'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The same request said three ways, so a phrase that happens to sit badly in the model's world is not the only try. */
export function phrasings(query: string): string[] {
  const said = core(query);
  if (said.length < 2 || said.length > 60) return [query];
  return [query, `a logo that is ${said}`, `a logo of ${said}`];
}

/**
 * Does each image look like what the person described? One number per image, 0 to 1, from the backdrop quiz.
 * Each phrasing gets its own quiz and an image keeps its best result, so no single awkward wording decides.
 */
export async function byLooks(items: LibraryItem[], query: string, queryVector: number[], sims: number[]): Promise<number[]> {
  const table = await backdropTable(items);
  const best = contest(table, queryVector, sims);
  for (const said of phrasings(query).slice(1)) {
    const v = await embedText(tokenize(said));
    const mine = items.map((it) => {
      let s = 0;
      for (let k = 0; k < v.length; k++) s += it.vector[k] * v[k];
      return s;
    });
    contest(table, v, mine).forEach((p, i) => (best[i] = Math.max(best[i], p)));
  }
  return best;
}

/**
 * Does each company's written info fit? The category Jev named is the set to look through ("all payments companies"
 * means everyone in Fintech > Payments), and Jev then reads them so that the extra parts of the description still
 * count ("...in nigeria"). Unlike a ranking search this is not capped at a shortlist of the most promising few.
 */
export async function byInfo(
  query: string,
  items: LibraryItem[],
  inside: number[],
  infoFor: (i: number) => string,
  when?: When,
): Promise<{ probability: number[]; tokens: number; ok: boolean }> {
  const probability = items.map(() => 0);
  const look = inside.slice(0, CHUNK * CHUNKS);
  const chunks: number[][] = [];
  for (let at = 0; at < look.length; at += CHUNK) chunks.push(look.slice(at, at + CHUNK));

  const verdicts = await Promise.all(chunks.map((list) => judge(query, list.map((i) => ({ info: infoFor(i), colors: items[i].colors.join(", ") })), when)));
  let tokens = 0;
  let ok = verdicts.length > 0;
  verdicts.forEach((verdict, c) => {
    if (!verdict) return (ok = false);
    tokens += verdict.tokens;
    chunks[c].forEach((i, k) => (probability[i] = verdict.scores[k]));
  });
  return { probability, tokens, ok };
}

export const infoOf = (items: LibraryItem[], meta: (i: number) => { name: string; tagline: string } | undefined) => (i: number) => {
  const m = meta(i);
  return m ? infoLine(m as Parameters<typeof infoLine>[0]) : items[i].title;
};
