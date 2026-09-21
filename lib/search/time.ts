import type { LibraryItem } from "@/lib/library";
import { metaFor } from "@/lib/meta";

/**
 * A YC batch is a season and a year, and that is a real fact about every company here: "the newest batch", "last year",
 * "the 2019 ones" are all answerable, but only by someone who knows what today is and which batches exist. Jev is told
 * both. The list runs into the future on purpose: YC announces batches ahead of time and companies are already in them, so the
 * newest batch is the one furthest ahead, whether or not it has started.
 */
const SEASON: Record<string, number> = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };

/** A number that sorts batches in time order, or null for "Unspecified". */
export function batchRank(batch: string | undefined): number | null {
  const m = /^(Winter|Spring|Summer|Fall) (\d{4})$/.exec(batch ?? "");
  return m ? Number(m[2]) * 4 + SEASON[m[1]] : null;
}

const store = globalThis as unknown as { __batches?: { version: number; line: string }; __order?: { version: number; order: number[] } };

/** "Fall 2026 (79 companies), Summer 2026 (232), ..." newest first, for Jev to reckon with. */
export function batchesNewestFirst(items: LibraryItem[], version: number, howMany = 10): string {
  if (store.__batches?.version === version) return store.__batches.line;
  const count = new Map<string, number>();
  for (const it of items) {
    const batch = metaFor(it.id)?.batch;
    if (batchRank(batch) !== null) count.set(batch!, (count.get(batch!) ?? 0) + 1);
  }
  const line = [...count]
    .sort((a, b) => batchRank(b[0])! - batchRank(a[0])!)
    .slice(0, howMany)
    .map(([batch, n], i) => `${batch} (${n}${i ? "" : " companies"})`)
    .join(", ");
  store.__batches = { version, line };
  return line;
}

/** Today, as a plain date Jev can compare a batch against. */
export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Every company in time order, newest batch first. Knowing today's date lets Jev judge a candidate's batch, but only if
 * the candidate was put in front of it: "newest startup" shares no words and no meaning with the newest company, so
 * without this channel it is never nominated and can never be picked.
 */
export function newestFirst(items: LibraryItem[], version: number): number[] {
  if (store.__order?.version === version) return store.__order.order;
  const order = items
    .map((_, i) => i)
    .filter((i) => batchRank(metaFor(items[i].id)?.batch) !== null)
    .sort((a, b) => batchRank(metaFor(items[b].id)?.batch)! - batchRank(metaFor(items[a].id)?.batch)!);
  store.__order = { version, order };
  return order;
}
