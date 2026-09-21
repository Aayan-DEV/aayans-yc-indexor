/**
 * Asks Jev what each company actually does, in YC's own vocabulary, and writes data/jev_tags.json.
 *
 * YC's tags are what a founder typed into a form. Jev's are what the company is, judged from the write-up and from what
 * Jev already knows about it: Context.dev comes back Web Development rather than only APIs, Stripe comes back Payments,
 * which YC never said, and Unbabel gets tags at all, where YC gave it none. Roughly $0.81 and five minutes for the lot.
 * Safe to re-run: companies already answered are skipped.
 *
 *   node scripts/tag-companies.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const OUT = path.join(root, "data", "jev_tags.json");
const KEEP = 0.15; // a word has to be at least this likely before it is written down
const MOST = 6; // words per company
const AT_ONCE = 6; // TypeSafe allows 1,200 requests a minute; this sits under that
const key = /TYPE_SAFE_KEY\s*=\s*"?([^"\n]+)"?/.exec(fs.readFileSync(path.join(root, "..", ".env"), "utf8"))[1].trim();

const meta = JSON.parse(fs.readFileSync(path.join(root, "data", "companies.json"), "utf8"));
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

const counts = new Map();
for (const v of Object.values(meta)) for (const t of v.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
const common = [...counts].sort((a, b) => b[1] - a[1]).map(([t]) => t);
const groups = [[], []]; // one `choice` takes at most 255 options, so the vocabulary goes out as two questions
common.forEach((t, i) => groups[i % 2].push(t));

const ASK =
  "The state describes one company. Which of these words describes what it actually does? Judge by what the company IS, " +
  "using what you know about it as well as the text: a company that gives developers structured data from any website is " +
  "doing Web Development and Data Engineering, whatever its own blurb calls it.";

async function tagsFor(id) {
  const m = meta[id];
  const state = `${m.name}. ${m.tagline}. ${m.description ?? ""}`.slice(0, 900);
  for (let go = 0; go < 3; go++) {
    try {
      const res = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "jev-latest",
          state,
          questions: Object.fromEntries(groups.map((g, n) => [`t${n}`, { type: "choice", instructions: ASK, criteria: Object.fromEntries(g.map((t) => [t, null])) }])),
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        if (res.status !== 429 && res.status < 500) return null;
        await new Promise((r) => setTimeout(r, 500 * (go + 1)));
        continue;
      }
      const data = await res.json();
      const all = {};
      for (let n = 0; n < groups.length; n++) for (const [tag, p] of Object.entries(data.answers?.[`t${n}`]?.probabilities ?? {})) if (p >= KEEP) all[tag] = Math.round(p * 100) / 100;
      return { tags: Object.fromEntries(Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, MOST)), tokens: data.usage?.input_tokens ?? 0 };
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (go + 1)));
    }
  }
  return null;
}

const todo = Object.keys(meta).filter((id) => !done[id]);
console.log(`${Object.keys(meta).length} companies, ${Object.keys(done).length} already answered, ${todo.length} to go`);
let at = 0;
let tokens = 0;
let failed = 0;
const began = Date.now();
const save = () => fs.writeFileSync(OUT, JSON.stringify(done));

await Promise.all(
  Array.from({ length: AT_ONCE }, async () => {
    while (at < todo.length) {
      const id = todo[at++];
      const r = await tagsFor(id);
      if (r) {
        done[id] = r.tags;
        tokens += r.tokens;
      } else failed++;
      const n = Object.keys(done).length;
      if (n % 400 === 0) {
        save();
        const left = ((Date.now() - began) / at) * (todo.length - at);
        console.log(`  ${n}  ${failed} failed  about ${Math.round(left / 60000)} min left  $${((tokens / 1e6) * 0.042).toFixed(2)} so far`);
      }
    }
  }),
);
save();
console.log(`done: ${Object.keys(done).length} answered, ${failed} failed, ${tokens} tokens = $${((tokens / 1e6) * 0.042).toFixed(2)}`);
