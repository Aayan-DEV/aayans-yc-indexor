import { LruCache } from "@/lib/cache";
import { library } from "@/lib/library";
import { ALL_NO_LOGO, rank, type NoLogo, type Ranked } from "@/lib/search/rank";
import type { SearchResponse } from "@/lib/types";

const cache = new LruCache<Ranked>();

export async function POST(request: Request) {
  const started = performance.now();
  const body = (await request.json().catch(() => null)) as { query?: unknown; looksOnly?: unknown; noLogo?: Partial<NoLogo> } | null;
  const looksOnly = body?.looksOnly === true; // for measuring: what MobileCLIP alone would have answered
  // Which companies with no logo of their own to keep. Anything the page does not say stays in.
  const noLogo: NoLogo = { ...ALL_NO_LOGO, ...(body?.noLogo ?? {}) };
  const kept = `${+noLogo.active}${+noLogo.acquired}${+noLogo.closed}`;
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 300) : "";
  if (query.length < 2) return Response.json({ error: "Type at least 2 characters." }, { status: 400 });

  const key = `${(await library()).version}:${looksOnly}:${kept}:${query.toLowerCase()}`; // a new image changes the version, so no stale answers
  const cached = cache.get(key);
  if (cached) return Response.json({ ...cached, cached: true, ms: Math.round(performance.now() - started) } satisfies SearchResponse);
  let result: Ranked;
  try {
    result = await rank(query, looksOnly, noLogo);
  } catch {
    // The usual cause is the vision helper having stopped. It restarts itself on the next request, so one retry covers it.
    try {
      result = await rank(query, looksOnly, noLogo);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Search failed." }, { status: 503 });
    }
  }
  // An answer made without Jev, when Jev was needed, is a stopgap. Cached, it once kept a search broken for as long as
  // the server ran: every retry of the same words got the same empty answer back at once.
  if (!result.degraded) cache.set(key, result);
  return Response.json({ ...result, cached: false, ms: Math.round(performance.now() - started) } satisfies SearchResponse);
}
