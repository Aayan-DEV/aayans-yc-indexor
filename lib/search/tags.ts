import type { LibraryItem } from "@/lib/library";
import { jevTagsFor } from "@/lib/jev-tags";
import { metaFor } from "@/lib/meta";

/**
 * The 337 words YC itself files these companies under. They are the missing step between what a person describes and
 * what the thing is called: "my client wants the program in Chinese" shares not one word with Quetzal's "translation
 * and internationalization for software", but both are the tag `International`, which only six companies carry.
 *
 * Jev picks from this vocabulary rather than from anything invented here, so the app stays as open as the data is, and
 * every company is filed under YC's words AND under the ones Jev says really describe it, which are often not the same:
 * YC never tagged Stripe as Payments.
 * A `choice` question takes at most 255 options, so the vocabulary goes out as two questions. They are dealt out
 * alternately by how common each tag is, so neither question is all common words or all rare ones.
 */
export const GROUPS = 2;

type Vocabulary = { groups: string[][]; byTag: Map<string, number[]> };
const store = globalThis as unknown as { __tags?: { version: number; vocabulary: Vocabulary } };

export function tagVocabulary(items: LibraryItem[], version: number): Vocabulary {
  if (store.__tags?.version === version) return store.__tags.vocabulary;
  const byTag = new Map<string, number[]>();
  items.forEach((it, i) => {
    for (const tag of new Set([...(metaFor(it.id)?.tags ?? []), ...jevTagsFor(it.id)])) {
      const list = byTag.get(tag);
      if (list) list.push(i);
      else byTag.set(tag, [i]);
    }
  });
  const common = [...byTag].sort((a, b) => b[1].length - a[1].length).map(([tag]) => tag);
  const groups: string[][] = Array.from({ length: GROUPS }, () => []);
  common.forEach((tag, at) => groups[at % GROUPS].push(tag));
  const vocabulary = { groups, byTag };
  store.__tags = { version, vocabulary };
  return vocabulary;
}
