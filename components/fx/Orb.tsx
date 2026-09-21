"use client";

import dynamic from "next/dynamic";
import type { OrbState } from "thinking-orbs";

// The orb draws on a canvas, so it only loads in the browser.
const ThinkingOrb = dynamic(() => import("thinking-orbs").then((m) => m.ThinkingOrb), { ssr: false });

type Props = {
  state: OrbState;
  /** The tuning the orb was authored for. Also the canvas resolution. */
  size?: 64 | 20;
  /** CSS size to paint it at. Defaults to `size`. Keeps the layout box exact, so it never overflows its slot. */
  display?: number;
  paused?: boolean;
};

export function Orb({ state, size = 64, display, paused }: Props) {
  const px = display ?? size;
  return (
    <span className="inline-flex shrink-0 items-center justify-center" style={{ width: px, height: px }} aria-hidden>
      <ThinkingOrb state={state} size={size} theme="dark" paused={paused} style={{ width: px, height: px, display: "block" }} />
    </span>
  );
}
