import { embedText } from "@/lib/clip/helper";
import { tokenize } from "@/lib/clip/tokenizer";
import { judge } from "@/lib/jev/judge";
import { ONLY_LOOKS, OTHER, understand } from "@/lib/jev/understand";
import { lettersFor, lettersKnown } from "@/lib/letters";
import { library } from "@/lib/library";
import { embedAsking } from "@/lib/text/embed";
import { metaFor, prominence } from "@/lib/meta";
import type { SearchResponse } from "@/lib/types";
import { byInfo, byLooks, core } from "./filter";
import { tagVocabulary } from "./tags";
import { batchesNewestFirst, newestFirst, today } from "./time";
import { infoLine, textIndex, textScores, words } from "./textIndex";

export type Ranked = Omit<SearchResponse, "cached" | "ms">;

const BY_LOOKS = 10; // finalists taken from the image model
const BY_WORDS = 12; // finalists whose written info shares words with the description
const BY_MEANING = 12; // finalists whose written info means something similar
const BY_FAME = 6; // other large companies whose written info matches
const DEEPEN = 0.65; // below this the first look found nothing convincing, so it is worth a second one
const DEEPER = 60; // companies pulled in by that second look
// Characters of each company's write-up that Jev reads. It is about three quarters of what a candidate costs, and it is
// a real trade rather than waste: on the 34-query benchmark 0 and 420 score exactly the same while 0 costs 34% less, but
// on the long-tail requests that benchmark cannot see, the write-up decides. Whitespace lands 10th with it and 22nd
// without. Set JEV_DETAIL to measure that again.
const DETAIL = Number(process.env.JEV_DETAIL ?? 420);
const IN_NAME = 25; // companies whose name carries one of the person's words inside it
const BY_TAG = 40; // companies carrying the words Jev says the request is about
const WHOLE = 0.55; // how sure Jev must be about a category or a tag before the whole of it is read, not just its best few
const SMALL = 80; // ...or it is simply small enough to read in full whatever the confidence. Most tags are: the median holds 28
const ALL_CAP = 200; // the most that is ever read from one category or tag, so "B2B" at 643 companies cannot run away with it
const MOST_JUDGED = 320; // finalists in one search, across every channel
const JUDGE_CHUNK = 120; // questions in one call to Jev; more than this goes out as several calls side by side
const TAG_SURE = 0.25; // how sure Jev has to be that a tag is the right word before its companies are called in
const BY_TIME = 60; // the newest and the oldest companies, when the request is about when they joined
const BY_ANYWAY = 120; // candidates from the whole library, whatever category the request landed in
const BY_CATEGORY = 60; // finalists from the categories Jev says the description is about: a small category is read by Jev in full
const TOP_LIFT = 2.2; // the odds that one of YC's 91 top companies is the one meant, against an unknown company that fits as well
const FAME_LIFT = 0.6; // and the same for a merely large one, scaled by how large
const FLOOR = 0.25; // a finalist found through its written info keeps this much standing even if it looks nothing like the description
const OPINION = 0.3; // Jev's best answer must stand this far above its typical answer before it is allowed to reorder anything
const EVIDENCE = 4; // ...or be this many times more likely than the typical one, which is the same thing said in odds
const LOOKS_ONLY = 0.6; // Jev must be this sure a description is only about looks before the written info is left out ("image generation" gets 0.36, "a zebra" 0.96)
const FITS = 0.5; // Jev's answer from which a finalist really fits: only these get the lift for being well known
const BY_NAME = 0.6; // a company found only by a word in its name has to clear a higher bar than one Jev read in full
const SHOWN = 0.3; // everything Jev puts at 30% or more floats up, each with its probability
const FEWEST = 9; // the closest guesses always come up, however unlikely: a probability is an answer, an empty page is not
const WEAK = 0.35; // below this the image model is not really sure of anything, so Jev is asked to connect the dots instead
const MOST = 120; // floating matches at once. The container above the search bar scrolls when they do not all fit
const ALL_MOST = 600; // "every one that matches" is allowed far more: the container scrolls and only visible rows leave the pile
const RARE_NAME = 6; // a word this rare in the whole library (about 15 companies or fewer) is a name, not a description
const QUALIFIES = 0.5; // the bar for "this one qualifies" in filter mode, where being right matters more than being generous

const TEXT_WORD = new Set("letter letters text texts word words writing written write say says saying name names spelled printed reads read".split(" ")); // talk about writing, not the writing itself
const NAMES_TIME = /\b(19|20)\d{2}\b|\b(winter|spring|summer|fall)\s+(19|20)\d{2}\b/i; // a year or a batch: a fact about a company, never a look
const COLOR_WORD = /\b(red|orange|yellow|green|blue|purple|violet|pink|brown|black|white|gr[ae]y|beige|cream|teal|cyan|navy|lime|gold|silver|magenta|maroon|turquoise|indigo|dark|light|bright|pastel|neon|colou?r\w*)\b/i;
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const plain = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|a|an|logo|icon|app|company)\b/g, " ").replace(/\s+/g, " ").trim();
/** What the tooltip over a floating match says: one line about what it is, one about when and where. */
const about = (id: string) => {
  const m = metaFor(id);
  return m
    ? {
        tagline: m.tagline || m.description?.slice(0, 140) || "",
        detail: [m.batch, m.location].filter(Boolean).join(" · "),
        batch: m.batch,
        place: m.location,
        link: m.website || m.url, // the company's own site when YC has one, else its YC page
        yc: m.url,
      }
    : {};
};
const odds = (p: number) => Math.min(0.98, Math.max(0.02, p)) / (1 - Math.min(0.98, Math.max(0.02, p)));
const topOf = (scores: number[], n: number, min = 0) => scores.map((s, i) => ({ s, i })).filter((x) => x.s > min).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.i);

/**
 * 1. A description that is just a company's name picks that logo.
 * 2. MobileCLIP scores the looks of every image.
 * 3. Jev first works out what kind of company a vague description is about, five channels nominate finalists
 *    (looks, shared words, similar meaning, Jev's categories, well-known companies), and Jev reads each finalist's info and colors in one call.
 * 4. Among finalists that fit equally well, the better-known company comes first.
 * Every hit leaves with a probability; `matches` says how many of the best hits are good enough to float up.
 * `noLogo` says which of the 624 companies YC has no logo for to keep, by whether each is still going, was acquired, or closed.
 */
/** Which companies with no logo of their own to keep. YC files every company as one of these. */
export type NoLogo = { active: boolean; acquired: boolean; closed: boolean };
export const ALL_NO_LOGO: NoLogo = { active: true, acquired: true, closed: true };
const standing_of = (status: string | undefined): keyof NoLogo => (status === "Acquired" ? "acquired" : status === "Active" || status === "Public" ? "active" : "closed");

export async function rank(query: string, looksOnly = false, noLogo: NoLogo = ALL_NO_LOGO): Promise<Ranked> {
  const { items, version } = await library();
  const t0 = performance.now();
  // Two readings of the same query, and neither needs the other, so they run together. They used to be awaited one
  // after the other, two hundred lines apart, which put both on the critical path for no reason. Overlapping them
  // costs whichever is slower instead of their sum, which more than pays for the ONNX text tower being slower than
  // CoreML's on machines that have no Neural Engine.
  const asking = embedAsking(query); // the sentence model, started now and awaited where it is needed
  asking.catch(() => {}); // a rejection is handled at the await; this only stops Node calling it unhandled meanwhile
  const q = await embedText(tokenize(query));
  const embedMs = performance.now() - t0;

  // Looks: cosine similarity against every image, then CLIP's own softmax, so each image gets its share of the match.
  const sims = items.map((it) => {
    let s = 0;
    for (let k = 0; k < q.length; k++) s += it.vector[k] * q[k];
    return s;
  });
  // Companies with no logo of their own wear a lettered tile. Most of them closed years ago, so they can be left out
  // entirely: not merely dropped from the answer, but never nominated, so they cost nothing to leave out.
  const hidden = items.map((it) => {
    const meta = metaFor(it.id);
    return !!meta?.placeholder && !noLogo[standing_of(meta.status)];
  });
  const anyHidden = hidden.some(Boolean);
  const shown = (i: number) => (hidden[i] ? 0 : 1);
  const best = Math.max(...sims.filter((_, i) => !hidden[i]));
  const looks = sims.map((s, i) => shown(i) * Math.exp(100 * (s - best))); // 1 = the best-looking image
  const sum = looks.reduce((a, b) => a + b, 0);
  let standing = looks.map((e) => e / sum); // what the hits are sorted by
  let probability = [...standing]; // what is shown on a floating hit
  const jev: (number | undefined)[] = items.map(() => undefined);
  let decidedBy: Ranked["decidedBy"] = "mobileclip";
  let tokens: number | undefined;
  let nominated: Record<string, unknown> | undefined; // which channel put which finalist forward, for the accuracy scripts
  let fitting = -1; // how many Jev said fit, when Jev decided
  const nameFit: Record<number, number> = {}; // Jev's answer for companies found by a word in their name, on the looks-only path
  let degraded = false; // a Jev call this search needed did not answer: the result is the best that could be done without it, and must not be cached
  let mode: Ranked["mode"] = "one";
  let deepened: string[] | undefined; // the words a second look followed, when there was one

  const wanted = plain(query);
  const named = wanted.length >= 2 ? items.findIndex((it, i) => !hidden[i] && plain(metaFor(it.id)?.name ?? "") === wanted) : -1;
  if (named >= 0) {
    standing = standing.map((s, i) => (i === named ? 0.97 + 0.03 * s : 0.03 * s));
    probability = standing;
    decidedBy = "name";
  } else if (items.length > 1 && !looksOnly) {
    const index = textIndex(items, version);
    // Two readings of the same words: MobileCLIP's, which lives in the same space as the pictures, and a real sentence
    // model's, which is the one that can tell that "scraping platform" and "structured data from any website" agree.
    const text = textScores(index, query, await asking);
    // MobileCLIP being sure is not enough with thousands of logos: it was "sure" that a smart watch is some unrelated
    // logo. So Jev always gets a say, unless it says itself that the description is only about looks.
    {
      const lexical = items.map((it, i) => shown(i) * (text.byId.get(it.id)?.lexical ?? 0));
      const meaning = items.map((it, i) => shown(i) * (text.byId.get(it.id)?.meaning ?? 0));
      const known = items.map((it, i) => shown(i) * prominence(metaFor(it.id)));

      // Full color measurements are long. They only go along when the description names a color.
      const namesColor = COLOR_WORD.test(query);
      let fromLooks = new Set<number>();
      const when = { today: today(), batches: batchesNewestFirst(items, version) };
      const oneOf = (i: number, short: boolean) => {
        const meta = index.docs.get(items[i].id)?.meta;
        return {
          // Even the short form carries the batch: it is one of the few hard facts every company here has.
          info: !meta ? items[i].title : short ? [`${meta.name}: ${meta.tagline}`, meta.tags?.join(", "), meta.location, meta.batch && `Y Combinator ${meta.batch}`].filter(Boolean).join(" | ") : infoLine(meta, DETAIL),
          colors: namesColor ? (fromLooks.has(i) ? items[i].colorText : items[i].colors.join(", ")) : "", // colours only when the words mention one
        };
      };

      /**
       * Jev reads the finalists. Reading a whole category can mean a couple of hundred of them, which goes out as several
       * calls side by side rather than one enormous one. If a call fails its companies take the middle answer of the ones
       * that worked, which neither promotes nor buries them, and the search is marked degraded so it is not cached.
       */
      const ask = async (list: number[], short = false) => {
        if (!list.length) return null;
        const parts: number[][] = [];
        for (let at = 0; at < list.length; at += JUDGE_CHUNK) parts.push(list.slice(at, at + JUDGE_CHUNK));
        const verdicts = await Promise.all(parts.map((part) => judge(query, part.map((i) => oneOf(i, short)), when)));
        if (verdicts.every((v) => !v)) return null;
        const got = verdicts.flatMap((v) => v?.scores ?? []).sort((a, b) => a - b);
        const middle = got[Math.floor(got.length / 2)] ?? 0.5;
        if (verdicts.some((v) => !v)) degraded = true;
        return {
          scores: verdicts.flatMap((v, n) => v?.scores ?? parts[n].map(() => middle)),
          tokens: verdicts.reduce((sum, v) => sum + (v?.tokens ?? 0), 0),
        };
      };

      // A vague description ("they give food to peoples houses") shares few words with any tagline, so Jev first says
      // which categories it is about and the best-meaning companies of those categories join the finalists.
      let byCategory: number[] = [];
      let categories: [string, number][] = [];
      let tagsPicked: [string, number][] = [];
      let onlyLooks = false;
      let every = false; // the person wants all of them, not the one they have in mind
      let aboutText = false; // ...about the writing inside the picture
      let aboutTime = false; // ...about when the company joined Y Combinator
      let byTag: number[] = []; // companies filed under the words Jev picked out of YC's own vocabulary
      const vocabulary = tagVocabulary(items, version);
      let wantsText = true; // ...and they want the ones that have writing, not the ones without
      // This always runs. It used to be skipped when one company's info "covered" the description, but a one-word
      // description ("payments app") is covered by any company with that word in its name, and the category was lost.
      {
        const read = await understand(query, index.categories, vocabulary.groups);
        if (!read.categories) degraded = true;
        every = read.every;
        aboutText = read.aboutText;
        aboutTime = read.aboutTime;
        wantsText = read.wantsText;
        // "companies from winter 2019" read as a wintry picture and came back with 564 white logos. A year is written
        // down, never seen, so naming one settles it whatever the rest of the words look like.
        onlyLooks = (read.categories?.[ONLY_LOOKS] ?? 0) >= LOOKS_ONLY && !NAMES_TIME.test(query);
        const real = Object.entries(read.categories ?? {}).filter(([c]) => c !== ONLY_LOOKS && c !== OTHER).sort((a, b) => b[1] - a[1]);
        categories = real.filter(([, p]) => p >= 0.15).slice(0, 3);
        // "Some other kind of product" took 70% of the answer for the localisation request and the whole category channel
        // came back empty. A best guess under the bar is worth more than nothing at all.
        if (!categories.length) categories = real.filter(([, p]) => p >= 0.05).slice(0, 2);

        // The word for the thing, which the person often does not know. Their own words shared nothing with "translation
        // and internationalization for software", but Jev files both under `International`, and six companies carry it.
        for (const [tag, p] of Object.entries(read.tags).filter(([, p]) => p >= TAG_SURE).sort((a, b) => b[1] - a[1]).slice(0, 4)) {
          const inTag = vocabulary.byTag.get(tag) ?? [];
          const mine = new Set(inTag);
          byTag.push(...topOf(items.map((_, i) => (mine.has(i) && !hidden[i] ? meaning[i] + 0.5 * lexical[i] + known[i] + 1e-9 : 0)), p >= WHOLE || inTag.length <= SMALL ? ALL_CAP : Math.max(6, Math.round(BY_TAG * p))));
        }
        byTag = [...new Set(byTag)].slice(0, ALL_CAP);
        tagsPicked = Object.entries(read.tags).filter(([, p]) => p >= TAG_SURE).sort((a, b) => b[1] - a[1]).slice(0, 4);
        // When Jev is sure which corner of the library this is about, read the whole corner. Whitespace sat in exactly the
        // right category, with exactly the right tag, and was never shown to Jev because only the best 48 of that category's
        // 139 companies were read. Being skipped before anyone reads your words is not the same as being judged and rejected.
        for (const [category, p] of categories) {
          const inside = items.map((it, i) => (index.docs.get(it.id)?.category === category ? shown(i) * (meaning[i] + 0.5 * lexical[i] + 1e-9) * (1 + known[i]) : 0));
          const here = inside.filter(Boolean).length;
          byCategory.push(...topOf(inside, p >= WHOLE || here <= SMALL ? ALL_CAP : Math.max(3, Math.round(BY_CATEGORY * p))));
        }
        byCategory = byCategory.slice(0, ALL_CAP);
      }

      // "Newest startup" sounds like nothing in particular and means nothing in particular, so no channel would ever put
      // the newest company forward. When the date matters, the ends of the timeline are candidates in their own right.
      const inTime = aboutTime ? newestFirst(items, version).filter((i) => !hidden[i]) : [];
      const byTime = [...inTime.slice(0, BY_TIME), ...inTime.slice(-BY_TIME)];

      // A name is one word to the index, so "crawl" never reached Firecrawl and "pay" never reached LotusPay. Looking
      // inside names costs one pass over 6,241 short strings and catches what whole-word matching cannot.
      const nameWords = words(query).filter((w) => w.length >= 4);
      const inName = nameWords.length
        ? topOf(
            items.map((it, i) => {
              const name = (metaFor(it.id)?.name ?? "").toLowerCase();
              return shown(i) && nameWords.some((w) => name.includes(w)) ? 1 + meaning[i] + known[i] : 0;
            }),
            IN_NAME,
          )
        : [];

      // "Every one that matches" is a different question, and gets a different answer: each image is asked on its own
      // whether it qualifies, so the result can be one image or five hundred. Nothing is shortlisted and nothing competes.
      if (every) {
        mode = "all";
        decidedBy = "mobileclip + jev";
        if (aboutText && lettersKnown() > 0) {
          // Only Vision knows what a picture says. Asking the image model gave 2% of the logos that are nothing but letters.
          // "logos with letters in them" wants every logo that says anything. "logos that say pay" wants the ones that
          // say that, so a word of their own that is not just talk about writing turns this from a sweep into a search.
          // Only when they want writing: you cannot ask which words are in a picture that has none.
          const asked = wantsText ? words(core(query)).filter((w) => !TEXT_WORD.has(w)) : [];
          probability = items.map((it, i) => {
            const printed = lettersFor(it.id);
            if (printed === undefined) return 0; // not read yet
            const has = printed.trim().length > 0;
            if (has !== wantsText) return 0;
            if (!asked.length) return 0.85 + 0.1 * known[i]; // a name you know comes before one you do not
            const low = printed.toLowerCase();
            return asked.some((w) => low.includes(w)) ? 1 : 0; // "lotuspay" says pay, though it is not the word pay
          });
          nominated = { mode, aboutText, wantsText, read: lettersKnown() };
        } else if (onlyLooks) {
          probability = await byLooks(items, query, q, sims);
          // A company whose name holds one of the person's words qualifies too, however its logo looks ("all corgi startups").
          const exact = new Set(words(query));
          const byName = topOf(lexical, BY_WORDS, 0.2).filter((i) => words(metaFor(items[i].id)?.name ?? "").some((w) => exact.has(w)));
          const named = byName.length ? await ask(byName, true) : null;
          if (byName.length && !named) degraded = true;
          if (named) {
            tokens = (tokens ?? 0) + named.tokens;
            // A rare word is a name, not a description. "corgi" belongs to two companies, so those two are the answer and
            // every dog-shaped logo is a coincidence. "blue" belongs to dozens, so it describes the picture, not the company.
            const rare = [...exact].some((w) => (index.idf.get(w) ?? 0) >= RARE_NAME);
            const strongest = Math.max(0, ...named.scores);
            if (rare && strongest >= 0.8) probability = items.map((_, i) => (byName.includes(i) ? named.scores[byName.indexOf(i)] : 0));
            else byName.forEach((i, k) => (probability[i] = Math.max(probability[i], named.scores[k])));
          }
        } else {
          // The category Jev named is the set to look through, all of it, in order of how well the words already fit.
          // But not every request is about an industry: "trillion dollar companies" landed on a category of 47 and found
          // nothing. So the well-known companies and the closest by meaning always come along, whatever the category.
          const inCategory = new Set(categories.map(([c]) => c));
          const fit = (i: number) => meaning[i] + 0.5 * lexical[i] + known[i];
          const inside = [
            ...byTime,
            ...inName,
            ...byTag,
            // The person's own words first. A batch, a place or a tag is an exact fact, and "the summer 2027 batch" has to
            // find the one company in it however little its description sounds like anything else in the request.
            ...topOf(lexical, BY_ANYWAY, 0.2),
            ...items.map((_, i) => i).filter((i) => !hidden[i] && inCategory.has(index.docs.get(items[i].id)?.category ?? "")).sort((a, b) => fit(b) - fit(a)),
            ...items.map((_, i) => i).filter((i) => known[i] === 1 && !hidden[i]).sort((a, b) => fit(b) - fit(a)),
            ...topOf(items.map((_, i) => fit(i)), BY_ANYWAY),
          ].filter((i, at, all) => all.indexOf(i) === at);
          const read = await byInfo(query, items, inside, (i) => {
            const meta = index.docs.get(items[i].id)?.meta;
            return meta ? infoLine(meta) : items[i].title;
          }, when);
          if (!read.ok) degraded = true;
          tokens = (tokens ?? 0) + read.tokens;
          probability = read.probability;
          nominated = { mode, onlyLooks, categories, tagsPicked, inCategory: inside.length };
        }
        standing = probability;
        fitting = probability.filter((p) => p >= QUALIFIES).length;
        nominated ??= { mode, onlyLooks, categories };
      } else {

      const channels = { time: byTime, name: inName, tags: byTag, looks: topOf(looks, BY_LOOKS), words: topOf(lexical, BY_WORDS, 0.2), meaning: topOf(meaning, BY_MEANING, 0.05), category: byCategory,
        fame: topOf(items.map((_, i) => (known[i] >= 0.5 && known[i] < 1 ? meaning[i] + 0.5 * lexical[i] : 0)), BY_FAME, 0.05),
      };
      // A look-only description: nothing written can help, so only the best-looking images stay in, and Jev is asked
      // about them only if a color is named (reading the measured colors is the one thing it adds there).
      fromLooks = new Set(channels.looks);
      // "An elephant riding a bicycle" is no company's logo, so the image model has nothing it is sure of. Rather than
      // shrug, the written channels join in and Jev is asked which startup such a thing could possibly be.
      const looksWeak = Math.max(...standing) < WEAK;
      // Order matters once there is a ceiling: the small precise channels go in first, and a big category fills what is left.
      const finalists = onlyLooks && !looksWeak
        ? [...new Set([...channels.looks, ...byTime])]
        : [...new Set([...channels.time, ...channels.name, ...channels.looks, ...channels.words, ...channels.meaning, ...channels.fame, ...channels.tags, ...channels.category])].slice(0, MOST_JUDGED);
      nominated = { onlyLooks, ...Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, v.map((i) => items[i].id)])), categories, tagsPicked, coverage: round(text.coverage) };

      // YC's 91 top companies are the ones a person most likely means, and no shortlist found them reliably: Stripe's text
      // barely says "payments", Airbnb's never says "rent a room". Jev knows them by name, so it reads all of them on every
      // search, from short lines, in a second call that runs alongside the first (about 2,500 tokens, no extra wait).
      // The badge says how likely this is the one you mean, which is how well it fits AND how likely you meant it at all.
      // Being famous belongs in that number, not in a hidden score, and it counts for more the more plausible the company
      // already is: a step at 0.5 meant Reddit, at 0.44 for "alien mascot, internet forum", got no help and lost to a
      // company nobody has heard of on the same score.
      const lift = (p: number, i: number) => {
        const ramp = Math.max(0, Math.min(1, (p - SHOWN) / 0.35));
        const most = known[i] === 1 ? TOP_LIFT : 1 + FAME_LIFT * known[i];
        const by = odds(p) * (1 + (most - 1) * ramp);
        return Math.min(0.98, by / (1 + by));
      };

      const inFirst = new Set(finalists);
      const wellKnown = onlyLooks ? [] : items.map((_, i) => i).filter((i) => known[i] === 1 && !inFirst.has(i));
      // "all corgi startups" reads as a picture of a dog, so it takes the looks-only path, and only the logo with a dog in it
      // came back. A company whose NAME holds one of the person's words is a match of its own kind: Jev is asked about those
      // separately, and what it says is added next to the looks, without either disturbing the other.
      const said = new Set(words(query));
      const byName = onlyLooks ? channels.words.filter((i) => words(metaFor(items[i].id)?.name ?? "").some((w) => said.has(w))) : [];
      const [verdict, second, named] = await Promise.all([
        onlyLooks && !namesColor && !looksWeak ? null : ask(finalists),
        !onlyLooks && wellKnown.length ? ask(wellKnown, true) : null,
        byName.length ? ask(byName, true) : null,
      ]);
      if ((!(onlyLooks && !namesColor && !looksWeak) && !verdict) || (!onlyLooks && wellKnown.length && !second) || (byName.length && !named)) degraded = true;
      if (named) {
        tokens = (tokens ?? 0) + named.tokens;
        byName.forEach((i, k) => named.scores[k] >= BY_NAME && (nameFit[i] = named.scores[k])); // "Blue Frog Gaming" at 0.45 for "blue bird" is noise
      }
      if (verdict) {
        tokens = (tokens ?? 0) + verdict.tokens;
        // Looks are the starting belief and Jev's answer is the evidence, measured against the typical finalist.
        // When Jev has no real opinion (a look-only description leaves every answer in one narrow band) the evidence
        // is dropped and MobileCLIP's order stands.
        const sorted = [...verdict.scores].sort((x, y) => x - y);
        const typical = Math.min(0.9, Math.max(0.05, sorted[Math.floor(sorted.length / 2)])); // from the shortlist only: most of the 91 do not fit, and would drag it down
        if (second) {
          tokens += second.tokens;
          finalists.push(...wellKnown);
          verdict.scores.push(...second.scores);
        }
        const highest = Math.max(...verdict.scores);
        // The guard is only for descriptions of how something LOOKS, where Jev is reading text about a picture it cannot
        // see and its answers sit in a narrow noisy band. For a description of what a company does there is nothing better
        // to fall back on: the alternative is raw image similarity, which for "Stripe is expensive, something cheaper"
        // answered Strive Math, a coding school whose logo reads like the word. Worse, the better the shortlist gets the
        // more alike its answers are, so a spread test punishes exactly the searches that went well.
        const hasOpinion = !onlyLooks || highest - typical >= OPINION || highest >= 0.8 || odds(highest) / odds(typical) >= EVIDENCE;
        finalists.forEach((i, k) => (jev[i] = verdict.scores[k]));
        if (hasOpinion) {
          decidedBy = "mobileclip + jev";
          const fused = standing.map((s) => s * 0.001);
          finalists.forEach((i, k) => (fused[i] = Math.max(looks[i] ** 0.35, FLOOR) * (odds(verdict.scores[k]) / odds(typical)) * (verdict.scores[k] < FITS ? 1 : known[i] === 1 ? TOP_LIFT : 1 + FAME_LIFT * known[i]))); // being well known only helps a company that fits
          const total = fused.reduce((a, b) => a + b, 0);
          standing = fused.map((v) => v / total);
          // Being famous counts for more the more plausible the company already is, and for nothing when it plainly does not
          // fit. It used to be a step at 0.5, which meant Reddit, at 0.44 for "alien mascot, internet forum", got no help at
          // all and lost to a company nobody has heard of on the same score.
          probability = items.map((_, i) => lift(jev[i] ?? 0, i));
          fitting = probability.filter((p) => p >= SHOWN).length;
        }

        // A second look, when the first one found nothing convincing. Where to look next is not decided here: it comes
        // from what the first pass turned up. The words the best few answers are filed under become the next place to
        // search, and Jev reads whatever that brings back. Weak searches pay for this; confident ones never do.
        const soFar = Math.max(...probability);
        if (!every && fitting >= 0 && soFar < DEEPEN) {
          const weight = new Map<string, number>();
          const best = items.map((_, i) => i).sort((a, b) => probability[b] - probability[a]).slice(0, 5);
          for (const i of best) for (const tag of metaFor(items[i].id)?.tags ?? []) weight.set(tag, (weight.get(tag) ?? 0) + probability[i]);
          const follow = [...weight].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tag]) => tag);
          const seen = new Set(finalists);
          const near = new Set(follow.flatMap((tag) => vocabulary.byTag.get(tag) ?? []).filter((i) => !seen.has(i) && !hidden[i]));
          const again = near.size ? topOf(items.map((_, i) => (near.has(i) ? meaning[i] + 0.5 * lexical[i] + known[i] + 1e-9 : 0)), DEEPER) : [];
          const second = again.length ? await ask(again) : null;
          if (again.length && !second) degraded = true;
          if (second) {
            tokens = (tokens ?? 0) + second.tokens;
            again.forEach((i, k) => {
              jev[i] = second.scores[k];
              probability[i] = lift(second.scores[k], i);
              standing[i] = Math.max(standing[i], probability[i] * 0.5); // enough to settle a tie, never enough to decide one
            });
            fitting = probability.filter((p) => p >= SHOWN).length;
            deepened = follow;
          }
        }
      }
      }
    }
  }

  if (fitting < 0 && Object.keys(nameFit).length) {
    // Looks decided. The companies found by name join in with Jev's probability, wherever that beats their looks.
    standing = standing.map((s, i) => Math.max(s, nameFit[i] ?? 0));
    probability = standing;
    decidedBy = "mobileclip + jev";
  }

  // When Jev decided, the ones that fit come first (best standing first among them), and only then is the list cut:
  // cutting first once let well-known companies that did not fit push fitting ones out.
  const fits = (i: number) => Number(fitting > 0 && (jev[i] ?? 0) >= SHOWN);
  // The number on the icon has to be the number that sorts. It was not: the order came from the fused score, where being
  // a well-known company counts for five times as much, so "ai company brains" put Scale AI first at 75% and the company
  // whose tagline is literally "Your Company Brain" eighth at 89%. Being well known now only settles a tie.
  // A catch-all: whatever route a hidden company took, it leaves with nothing.
  if (anyHidden) items.forEach((_, i) => hidden[i] && ((probability[i] = 0), (standing[i] = 0)));
  const shownPct = (i: number) => Math.round(probability[i] * 100);
  const order = items
    .map((_, i) => i)
    .filter((i) => !hidden[i])
    .sort((a, b) => (mode === "all" ? 0 : fits(b) - fits(a)) || shownPct(b) - shownPct(a) || standing[b] - standing[a])
    .slice(0, mode === "all" ? ALL_MOST : MOST);
  // How many float up. Jev decided: everything it said fits. Otherwise: the images clearly ahead by looks.
  // How many come up. Everything that fits, and never fewer than a handful: the point of asking Jev is to get a
  // probability for the closest thing it can find, which is an answer even when it is a low one.
  let matches: number;
  if (decidedBy === "name") matches = 1;
  else if (mode === "all") matches = order.filter((i) => probability[i] >= QUALIFIES).length;
  else if (fitting >= 0) matches = Math.min(MOST, fitting);
  else matches = order.filter((i) => probability[i] >= SHOWN).length;
  if (decidedBy !== "name") matches = Math.max(matches, Math.min(FEWEST, order.length));

  const hits = order.map((i) => ({
    id: items[i].id, title: metaFor(items[i].id)?.name ?? items[i].title, ...about(items[i].id), src: items[i].src, colors: items[i].colors,
    score: round(standing[i]), probability: round(probability[i], 2), similarity: round(sims[i]), jev: jev[i] === undefined ? undefined : round(jev[i]!, 2),
  }));
  return { query, hits, matches, mode, degraded, deepened, confident: matches > 0, judged: items.length, embedMs: Math.round(embedMs), decidedBy, tokens, nominated, costUsd: tokens ? round((tokens / 1e6) * 0.042, 6) : undefined };
}
