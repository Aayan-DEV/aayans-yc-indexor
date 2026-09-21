import { library } from "@/lib/library";
import { metaFor } from "@/lib/meta";
import type { LibraryEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The page polls this to learn about images dropped into the folder while it is open. */
export async function GET(request: Request) {
  const { items, version } = await library();
  // The page only wants what arrived after it loaded. Without `since` a large library would be re-sent every poll.
  // The pile keeps swapping images in from the rest of the library: a handful of random ones, real logos only.
  const sample = Number(new URL(request.url).searchParams.get("sample")) || 0;
  if (sample > 0) {
    const srcs: string[] = [];
    for (let tries = 0; srcs.length < Math.min(sample, 48) && tries < 400 && items.length; tries++) {
      const item = items[Math.floor(Math.random() * items.length)];
      if (!metaFor(item.id)?.placeholder && !srcs.includes(item.src)) srcs.push(item.src);
    }
    return Response.json({ srcs });
  }
  const since = Number(new URL(request.url).searchParams.get("since")) || 0;
  const entries: LibraryEntry[] = items.filter((i) => i.addedAt > since).map((i) => ({ id: i.id, src: i.src, title: i.title, addedAt: i.addedAt, indexMs: i.indexMs }));
  return Response.json({ version, total: items.length, entries });
}
