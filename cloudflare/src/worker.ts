import { judgeWithJev } from "./jev";

type Env = {
  ASSETS: { fetch(input: Request | URL): Promise<Response> };
  AI: { run(model: string, input: { text: string[]; pooling: "cls" }): Promise<{ data: number[][] }> };
  AI_GATEWAY_API_KEY?: string;
};

type Company = {
  id: string; file: string; name: string; tagline: string; description: string;
  industry: string; subindustry: string; tags: string[]; letters: string;
  colors: string[]; batch: string; place: string; link: string; yc: string;
  status: string; placeholder: boolean; top: boolean; vectorAt: number;
};

let dataJob: Promise<{ companies: Company[]; vectors: Float32Array; searchable: string[] }> | undefined;
const cached = new Map<string, unknown>();
const DIM = 384;
const STOP = new Set("the a an and or of for to in on with by is are that this it its your you we our from as at be their all any logo icon app company startup show find me please".split(" "));
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w));
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

async function load(env: Env, origin: string) {
  return (dataJob ??= (async () => {
    const files = ["index-0.json", "index-1.json", "index-2.json", "index-3.json", "vectors-0.f32", "vectors-1.f32", "vectors-2.f32"];
    const responses = await Promise.all(files.map((file) => env.ASSETS.fetch(new URL(`/search/${file}`, origin))));
    if (responses.some((response) => !response.ok)) throw new Error("Search assets are missing. Run npm run cf:build.");
    const parts = await Promise.all(responses.slice(0, 4).map((response) => response.json() as Promise<Company[]>));
    const companies = parts.flat();
    const binaries = await Promise.all(responses.slice(4).map((response) => response.arrayBuffer()));
    const buffer = new ArrayBuffer(binaries.reduce((size, part) => size + part.byteLength, 0));
    const combined = new Uint8Array(buffer);
    let offset = 0;
    for (const part of binaries) { combined.set(new Uint8Array(part), offset); offset += part.byteLength; }
    const searchable = companies.map((c) => `${c.name} ${c.tagline} ${c.tags.join(" ")} ${c.industry} ${c.subindustry} ${c.description} ${c.letters}`.toLowerCase());
    return { companies, vectors: new Float32Array(buffer), searchable };
  })().catch((e) => { dataJob = undefined; throw e; }));
}

const dot = (a: ArrayLike<number>, b: Float32Array, at: number) => {
  let score = 0;
  for (let k = 0; k < DIM; k++) score += a[k] * b[at + k];
  return score;
};

async function search(request: Request, env: Env) {
  const started = performance.now();
  const body = await request.json().catch(() => null) as { query?: unknown; noLogo?: Record<string, boolean> } | null;
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 300) : "";
  if (query.length < 2) return json({ error: "Type at least 2 characters." }, 400);
  const key = JSON.stringify([query.toLowerCase(), body?.noLogo, !!env.AI_GATEWAY_API_KEY]);
  const hit = cached.get(key);
  if (hit) return json({ ...(hit as object), cached: true, ms: Math.round(performance.now() - started) });

  const { companies, vectors, searchable } = await load(env, request.url);
  let embedding: number[] | null = null;
  try {
    const result = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [`Represent this sentence for searching relevant passages: ${query}`], pooling: "cls" });
    embedding = result.data[0];
    if (embedding?.length !== DIM) embedding = null;
  } catch (error) {
    console.error("Workers AI embedding failed", error);
    // A lexical search remains useful if Workers AI is temporarily unavailable.
  }
  const q = words(query);
  const colorQuery = /\b(red|orange|yellow|green|blue|purple|pink|brown|black|white|gr[ae]y|teal|gold|silver|rainbow)\b/i.test(query);
  const normal = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  const scores = companies.map((c, i) => {
    if (c.placeholder && body?.noLogo) {
      const standing = c.status === "Acquired" ? "acquired" : c.status === "Active" || c.status === "Public" ? "active" : "closed";
      if (body.noLogo[standing] === false) return -1;
    }
    const haystack = searchable[i];
    const name = c.name.toLowerCase();
    const exact = name.replace(/[^a-z0-9]/g, "") === normal;
    let lexical = 0;
    for (const term of q) {
      if (name.includes(term)) lexical += 1.8;
      if (c.tagline.toLowerCase().includes(term)) lexical += 1.4;
      if (c.tags.some((t) => t.toLowerCase().includes(term))) lexical += 1.1;
      if (haystack.includes(term)) lexical += 0.5;
      if (c.letters.toLowerCase().includes(term)) lexical += 1.2;
      if (colorQuery && c.colors.some((color) => color.toLowerCase().includes(term))) lexical += 3;
    }
    const semantic = embedding && c.vectorAt >= 0 ? dot(embedding, vectors, c.vectorAt * DIM) : 0;
    return exact ? 100 : 4 * semantic + lexical / Math.max(1, q.length) + (c.top ? 0.08 : 0);
  });
  const ordered = scores.map((score, i) => ({ score, i })).filter((s) => s.score >= 0).sort((a, b) => b.score - a.score);
  const best = ordered[0]?.score ?? 0;
  const all = /\b(all|every|list)\b/i.test(query);
  const selected = ordered.slice(0, all ? 240 : 120);
  const exactName = best === 100;
  const batches = [...new Set(companies.map((c) => c.batch).filter(Boolean))].sort((a, b) => {
    const parse = (batch: string) => {
      const [season, year] = batch.split(" ");
      return Number(year) * 10 + ({ Winter: 1, Spring: 2, Summer: 3, Fall: 4 }[season] ?? 0);
    };
    return parse(b) - parse(a);
  });
  const chunks = [];
  if (!exactName && env.AI_GATEWAY_API_KEY) for (let at = 0; at < selected.length; at += 80) chunks.push(selected.slice(at, at + 80));
  const verdicts = await Promise.all(chunks.map((chunk) => judgeWithJev(query, chunk.map(({ i }) => {
    const c = companies[i];
    return {
      info: `${c.name}: ${c.tagline} | ${c.tags.join(", ")} | ${c.subindustry}, ${c.industry} | ${c.place} | Y Combinator ${c.batch} | ${c.description.slice(0, 420)}`,
      colors: c.colors.join(", "),
    };
  }), batches, env.AI_GATEWAY_API_KEY)));
  const jev = chunks.length > 0 && verdicts.every(Boolean)
    ? verdicts.flatMap((verdict) => verdict!.scores)
    : null;
  const finalists = selected.map((entry, n) => ({ ...entry, jev: jev?.[n] }));
  if (jev) finalists.sort((a, b) => (b.jev! - a.jev!) || (b.score - a.score));
  const hits = finalists.slice(0, all ? 200 : 120).map(({ score, i, jev: probability }) => {
    const c = companies[i];
    const relevance = score === 100 ? 0.99 : Math.max(0.05, Math.min(0.96, 0.88 * Math.exp((score - best) * 0.55)));
    return {
      id: c.id, src: `/icons/${encodeURIComponent(c.file)}`, title: c.name,
      tagline: c.tagline, detail: [c.batch, c.place].filter(Boolean).join(" · "),
      batch: c.batch, place: c.place, link: c.link, yc: c.yc, colors: c.colors,
      probability: probability ?? relevance, score: probability ?? relevance,
      similarity: embedding && c.vectorAt >= 0 ? dot(embedding, vectors, c.vectorAt * DIM) : 0,
      ...(probability !== undefined && { jev: probability }),
    };
  });
  const matches = hits.filter((h) => h.probability >= (jev ? 0.3 : 0.55)).length;
  const answer = {
    query, hits, matches: Math.max(Math.min(9, hits.length), matches), mode: all ? "all" : "one",
    confident: matches > 0, degraded: !exactName && !jev, judged: jev?.length ?? 0,
    embedMs: Math.round(performance.now() - started), decidedBy: exactName ? "name" : jev ? "jev" : "text",
    tokens: verdicts.reduce((sum, verdict) => sum + (verdict?.tokens ?? 0), 0),
    cached: false, ms: Math.round(performance.now() - started),
  };
  if (cached.size > 100) cached.clear();
  if (exactName || jev) cached.set(key, answer);
  return json(answer);
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/search" && request.method === "POST") return await search(request, env);
      if (url.pathname === "/api/library" && request.method === "GET") {
        if (!url.searchParams.has("sample")) return json({ entries: [] });
        const { companies } = await load(env, request.url);
        const srcs = companies.filter((c) => !c.placeholder).sort(() => Math.random() - 0.5).slice(0, 16).map((c) => `/icons/${encodeURIComponent(c.file)}`);
        return json({ srcs });
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Search failed." }, 503);
    }
  },
};
