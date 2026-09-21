import { SearchExperience } from "@/components/SearchExperience";
import { pileAtlas } from "@/lib/atlas";
import { library } from "@/lib/library";
import { metaFor } from "@/lib/meta";

export const dynamic = "force-dynamic";

const PILE = 1200; // the most the slider on the page can ask for; it renders however many of these it wants

const shuffle = <T,>(list: T[]) => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

/**
 * The whole library is searchable, but the pile shows a sample. How many of them are drawn is the slider's business.
 *
 * The sample comes from the packed sheet (`scripts/build-atlas.mjs`), because the sheet and the page have to agree on
 * which logos are in it: one request for the pile instead of a thousand. Which of them a visit shows, and where they
 * land, is still shuffled every time, and the churn keeps swapping in others from the rest of the library.
 */
export default async function Home() {
  const { items } = await library();
  const atlas = pileAtlas();
  const indexed = items.filter((i) => metaFor(i.id)).length; // YC companies that are searchable, logo or no logo
  const own = items.filter((i) => !metaFor(i.id)).map((i) => ({ id: i.id, src: i.src, at: -1 })); // uploads: newer than the sheet, so they load on their own

  const packed = atlas
    ? shuffle(atlas.srcs.map((src, at) => ({ id: atlas.ids[at], src, at })))
    : // No sheet yet. Every icon loads on its own, which is what this used to do, and slowly.
      shuffle(items.filter((i) => metaFor(i.id) && !metaFor(i.id)!.placeholder).map((i) => ({ id: i.id, src: i.src, at: -1 })));

  const shown = shuffle([...own, ...packed].slice(0, PILE));
  return <SearchExperience icons={shown} indexed={indexed} sheet={atlas ? { url: atlas.sheet, cell: atlas.cell, gutter: atlas.gutter, cols: atlas.cols } : null} />;
}
