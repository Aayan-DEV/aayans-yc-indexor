"use client";

import type { DropProgress } from "@/hooks/useImageDrop";

const FADE = "300ms cubic-bezier(0.22, 1, 0.36, 1)"; // one timing for the overlay and the bar, so they leave as one

/**
 * Full-page drop target. Dragging files over the window frames the page and shows one icon.
 * After the drop, a single thick bar takes the icon's place, fills, and leaves with the overlay. No text anywhere.
 */
export function DropZone({ dragging, progress }: { dragging: boolean; progress: DropProgress }) {
  const indexing = progress.active && !dragging;
  const visible = dragging || indexing;
  const { total, done } = progress;

  return (
    <>
      <div
        aria-hidden={!visible}
        className="pointer-events-none fixed inset-0 z-40 grid place-items-center backdrop-blur-md"
        // Lighter while indexing, so the images can be seen falling into the pile behind the bar.
        style={{ opacity: visible ? 1 : 0, backgroundColor: indexing ? "rgb(11 11 12 / 0.6)" : "rgb(11 11 12 / 0.85)", transition: `opacity ${FADE}, background-color ${FADE}` }}
      >
        {/* An SVG frame rather than a CSS border: round dots, even spacing on every side, and the dots can drift. */}
        <svg className="absolute inset-6 h-[calc(100%-3rem)] w-[calc(100%-3rem)] overflow-visible" style={{ opacity: dragging ? 1 : 0, transition: `opacity ${FADE}` }} aria-hidden>
          <rect x="3" y="3" rx="40" fill="none" stroke="rgb(255 255 255 / 0.5)" strokeWidth="6" strokeLinecap="round" strokeDasharray="0.1 20"
                className={dragging ? "drift" : undefined} style={{ width: "calc(100% - 6px)", height: "calc(100% - 6px)" }} />
        </svg>
        {/* A stack of pictures, because any number can be dropped. No label, no tile behind it. */}
        <svg width="148" height="148" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
             className="text-text" style={{ opacity: dragging ? 1 : 0, transform: dragging ? "none" : "scale(0.9)", transition: `opacity ${FADE}, transform ${FADE}` }} aria-hidden>
          <path d="M7.5 3.5H17a3.5 3.5 0 0 1 3.5 3.5v9.5" />
          <rect x="3.5" y="7" width="13.5" height="13.5" rx="3.5" />
          <circle cx="8" cy="11.4" r="1.35" />
          <path d="m4 18 3.4-3.4a1.5 1.5 0 0 1 2.1 0l5.6 5.6" />
          <path d="m12 16.9 1-1a1.5 1.5 0 0 1 2.1 0l1.9 1.9" />
        </svg>
      </div>

      {/* The bar is its own layer ABOVE the overlay, not a child of it. As a child it was faded twice (its own fade times
          the overlay's) and slipped away early. Here it is crisp, sits on top, and uses the very same fade, so both go together. */}
      <div
        role="progressbar"
        aria-label="Indexing dropped images"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="pointer-events-none fixed left-1/2 top-1/2 z-50 h-4 w-[min(320px,calc(100vw-96px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[3px] bg-[#2a2a2e]"
        style={{ opacity: indexing ? 1 : 0, transition: `opacity ${FADE}` }}
      >
        <div className="h-full rounded-[2px] bg-text transition-[width] duration-300 ease-out" style={{ width: `${total ? Math.max(5, (done / total) * 100) : 0}%` }} />
      </div>
    </>
  );
}
