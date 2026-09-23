"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useImageDrop } from "@/hooks/useImageDrop";
import { useSearch } from "@/hooks/useSearch";
import type { LibraryEntry } from "@/lib/types";
import { DropZone } from "./DropZone";
import type { Sheet } from "./floor/atlas";
import { IconFloor, type FloorApi } from "./IconFloor";
import { SearchComposer } from "./SearchComposer";
import { Settings } from "./ui/Settings";
import { YCMark } from "./ui/YCMark";

export function SearchExperience({ icons, indexed, sheet, cloudflare = false }: { icons: { id: string; src: string; at: number }[]; indexed: number; sheet: Sheet | null; cloudflare?: boolean }) {
  // The pile is settled on once, on the first render. The page is server-rendered fresh on every request, so a router
  // refresh hands down a newly shuffled sample; taking it would tear down the physics world and pour the whole pile in
  // again under the person, in the middle of whatever they were doing.
  const [pileIcons] = useState(() => icons);
  const [text, setText] = useState("");
  const { state, run, reset } = useSearch();
  const floor = useRef<FloorApi | null>(null);
  // Bumped whenever the floor builds its world again, which is what makes the matches below rise into the new one
  // rather than being handed to a floor that no longer exists.
  const [floorAt, setFloorAt] = useState(0);
  const onFloorReady = useCallback(() => setFloorAt((n) => n + 1), []);
  const bar = useRef<HTMLDivElement>(null);
  // How many of the sampled logos are actually drawn. Changing it rebuilds the pile, so it is committed a moment after
  // the slider stops rather than on every pixel of the drag.
  const [pile, setPile] = useState(500);
  const [sliding, setSliding] = useState(500);
  useEffect(() => {
    const timer = setTimeout(() => {
      setPile(sliding);
      try {
        localStorage.setItem("icon-recall:pile", String(sliding));
      } catch {}
    }, 400);
    return () => clearTimeout(timer);
  }, [sliding]);
  const drawn = useMemo(() => pileIcons.slice(0, pile), [pileIcons, pile]);
  const sources = useMemo(() => drawn.map((i) => i.src), [drawn]);
  const cells = useMemo(() => drawn.map((i) => i.at), [drawn]);
  // A dropped image falls into the pile the moment the server says it is searchable.
  const { dragging, progress } = useImageDrop(useCallback((entry: LibraryEntry) => floor.current?.add(entry.src), []), !cloudflare);

  // The MacBook's motion sensor steering gravity, and which of the 624 companies YC has no logo for to keep. Both are
  // remembered on this machine.
  const [motion, setMotion] = useState(!cloudflare);
  const [noLogo, setNoLogo] = useState({ active: true, acquired: true, closed: true });
  useEffect(() => {
    try {
      if (!cloudflare && localStorage.getItem("icon-recall:motion") === "off") setMotion(false);
      const many = Number(localStorage.getItem("icon-recall:pile"));
      if (Number.isFinite(many) && many >= 100) {
        setPile(many);
        setSliding(many);
      }
      const was = localStorage.getItem("icon-recall:no-logo");
      if (was) setNoLogo((now) => ({ ...now, ...JSON.parse(was) }));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("icon-recall:no-logo", JSON.stringify(noLogo));
    } catch {}
  }, [noLogo]);

  // What the searching has cost so far, kept between visits. Only a search that actually reached Jev adds to it: an
  // answer served from the cache cost nothing the second time, however much it cost the first.
  const [spent, setSpent] = useState(0);
  const [lit, setLit] = useState(false);
  const counted = useRef(0);
  useEffect(() => {
    try {
      const was = Number(localStorage.getItem("icon-recall:spend"));
      if (Number.isFinite(was) && was > 0) setSpent(was);
    } catch {}
  }, []);
  useEffect(() => {
    if (state.phase !== "done" || state.data.cached || !state.data.costUsd || state.at === counted.current) return;
    counted.current = state.at; // the same answer must never be counted twice
    setSpent((was) => {
      const now = was + state.data.costUsd!;
      try {
        localStorage.setItem("icon-recall:spend", String(now));
      } catch {}
      return now;
    });
    setLit(true);
    const timer = setTimeout(() => setLit(false), 1100);
    return () => clearTimeout(timer);
  }, [state]);

  /**
   * A search that found something puts the whole list on the clipboard, tab separated so it drops straight into a
   * spreadsheet. The browser only allows this while a click or keypress is still recent, and a search takes a second
   * or two, so when it is refused the list waits under a button instead.
   */
  const [copied, setCopied] = useState<{ many: number; at: number } | null>(null);
  const [toCopy, setToCopy] = useState<string | null>(null);
  const wrote = useRef(0);
  useEffect(() => {
    if (state.phase !== "done" || !state.data.matches || state.at === wrote.current) return;
    wrote.current = state.at;
    const found = state.data.hits.slice(0, state.data.matches);
    const rows = found.map((h) => [`${Math.round(h.probability * 100)}%`, h.title, h.tagline ?? "", h.batch ?? "", h.place ?? "", h.link ?? "", h.yc ?? ""].join("\t"));
    const heading = cloudflare && state.data.degraded ? "estimated relevance" : "match";
    const text = [`${state.data.query} — ${found.length} startups`, [heading, "name", "what they do", "batch", "where", "site", "yc"].join("\t"), ...rows].join("\n");
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied({ many: found.length, at: state.at });
        setToCopy(null);
      },
      () => setToCopy(text), // refused: offer it on a button instead
    );
  }, [state, cloudflare]);

  // Jev did not answer and looks alone found nothing: say so, with the same retry as any other failure.
  const notice =
    state.phase === "error"
      ? { message: state.message, retry: state.query }
      : state.phase === "done" && !state.data.matches
        ? // Nothing came up. Saying so is the whole point: an empty page looks like a broken one.
          state.data.degraded
          ? { message: cloudflare ? "Semantic search is temporarily unavailable." : "Jev did not answer.", retry: state.data.query }
          : { message: "Nothing matched that.", retry: null }
        : null;

  const busy = state.phase === "searching";
  // Everything the search says fits floats up, best first, each with its probability.
  const matches = useMemo(() => (state.phase === "done" ? state.data.hits.slice(0, state.data.matches).map((h) => ({ src: h.src, probability: h.probability, title: h.title, tagline: h.tagline, detail: h.detail, link: h.link || h.yc })) : []), [state]);

  // The matches float up out of the pile and rest just above the search bar. They stay physics bodies the whole time.
  useEffect(() => {
    if (!matches.length) return;
    floor.current?.select(matches, () => {
      const box = bar.current?.getBoundingClientRect();
      return { x: (box?.left ?? 0) + (box?.width ?? window.innerWidth) / 2, above: box?.top ?? window.innerHeight / 2 };
    });
  }, [matches, floorAt]);

  // Only Enter (or the orb) searches. Enter on words that were just searched does nothing: the matches would drop and rise twice.
  const submit = useCallback(
    (raw: string) => {
      const query = raw.trim();
      if ((state.phase === "done" && state.data.query === query) || (state.phase === "searching" && state.query === query)) return;
      run(query, noLogo);
    },
    [state, run, noLogo],
  );

  // Changing what to keep while results are up asks the same question again, rather than leaving a stale answer on screen.
  const asked = useRef(noLogo);
  useEffect(() => {
    if (asked.current === noLogo) return;
    asked.current = noLogo;
    if (state.phase === "done") run(state.data.query, noLogo);
  }, [noLogo, state, run]);

  // Images that arrive while the page is open fall into the pile a moment later. Only what is newer than this page is asked for.
  useEffect(() => {
    if (cloudflare) return;
    let since = Date.now() - 2000;
    const timer = setInterval(async () => {
      try {
        const data = (await (await fetch(`/api/library?since=${since}`)).json()) as { entries: { src: string; addedAt: number }[] };
        for (const entry of data.entries.slice(0, 40)) floor.current?.add(entry.src); // a bulk import must not bury the page
        for (const entry of data.entries) since = Math.max(since, entry.addedAt);
      } catch {}
    }, 1500);
    return () => clearInterval(timer);
  }, [cloudflare]);

  // Typing shakes the pile, and the first keystroke after a result lets that icon fall back in.
  const lastKey = useRef(0);
  const onType = useCallback(
    (value: string) => {
      // The first keystroke lets the matches go, and cancels a search whose answer would now be about old text.
      if (matches.length) floor.current?.release();
      if (state.phase !== "idle") reset();
      setText(value);
      const now = performance.now();
      const gap = now - lastKey.current;
      lastKey.current = now;
      if (gap < 1200) floor.current?.shake(Math.min(1, 90 / Math.max(gap, 50)));
    },
    [matches, state.phase, reset],
  );

  return (
    <>
      <IconFloor sources={sources} cells={cells} sheet={sheet} apiRef={floor} onReady={onFloorReady} />
      {!cloudflare && <DropZone dragging={dragging} progress={progress} />}
      <Settings
        motion={motion}
        setMotion={setMotion}
        noLogo={noLogo}
        setNoLogo={setNoLogo}
        icons={sliding}
        setIcons={setSliding}
        mostIcons={Math.min(1200, pileIcons.length)}
        spent={spent}
        lit={lit}
        busy={state.phase === "searching" ? state.query : ""}
        motionAvailable={!cloudflare}
      />

      {/* The bar is pinned to the exact center of the window. The layer around it ignores the pointer,
          so icons can still be grabbed and thrown anywhere on the page, including right next to the bar. */}
      <main className="pointer-events-none fixed inset-0 z-10">
        <div ref={bar} className="pointer-events-auto fixed left-1/2 top-1/2 w-[min(620px,calc(100vw-40px))] -translate-x-1/2 -translate-y-1/2">
          <SearchComposer
            value={text}
            onChange={onType}
            onSubmit={submit}
            onClear={() => {
              floor.current?.release();
              setText("");
              reset();
            }}
            busy={busy}
          />
          {/* How much there is to search, under the right edge of the bar. Absolutely positioned on purpose: the bar's
              own box is what the match container is anchored above, so this must not add to its height. */}
          <div className="pointer-events-none absolute right-0 top-full mt-2.5 flex select-none items-center gap-1.5 font-mono text-[11px] tracking-[-0.005em] text-faint">
            <YCMark size={13} />
            <span className="tabular-nums">{indexed.toLocaleString()} startups indexed</span>
          </div>
          {cloudflare && state.phase === "done" && <div className="pointer-events-none absolute left-0 top-full mt-2.5 font-mono text-[11px] text-muted">
            {state.data.degraded ? "Jev unavailable · estimated relevance" : state.data.decidedBy === "jev" ? `Jev scored ${state.data.judged} finalists` : "Exact name match"}
          </div>}
        </div>

        {/* What the search just put on the clipboard. It says so once and goes. */}
        {copied && (
          <div key={copied.at} className="copied pointer-events-none fixed left-1/2 top-[calc(50%+58px)] whitespace-nowrap rounded-[5px] border border-line-strong bg-panel px-5 py-2 text-[13px] text-muted">
            {copied.many} startups copied
          </div>
        )}
        {/* The browser refused, because the search took too long after the keypress. One click and it goes over. */}
        {toCopy && (
          <button
            onClick={() => navigator.clipboard?.writeText(toCopy).then(() => setToCopy(null))}
            className="rise pointer-events-auto fixed left-1/2 top-[calc(50%+58px)] -translate-x-1/2 whitespace-nowrap rounded-[5px] border border-line-strong bg-panel px-5 py-2 text-[13px] text-muted transition-colors hover:text-text"
          >
            Copy the list
          </button>
        )}
        {notice && (
          // Solid, not tinted glass: the pile sits right behind this, and a see-through panel turns into a mess.
          // It hangs below the bar on its own, so showing it never nudges the bar.
          <div role="alert" className={`rise pointer-events-auto fixed left-1/2 top-[calc(50%+58px)] flex -translate-x-1/2 items-center gap-4 rounded-[5px] border border-line-strong bg-panel py-2.5 pl-6 ${notice.retry ? "pr-2.5" : "pr-6"}`}>
            <p className="whitespace-nowrap text-[14px] text-muted">{notice.message}</p>
            {notice.retry && (
            <button
              onClick={() => run(notice.retry!, noLogo)}
              aria-label="Try again"
              className="grid size-9 place-items-center rounded-[4px] border border-line text-text transition-colors hover:bg-white/[0.06]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
            )}
          </div>
        )}
      </main>
    </>
  );
}
