"use client";

import { useEffect, useRef, useState } from "react";
import { LiquidToggle } from "./LiquidToggle";

export type NoLogo = { active: boolean; acquired: boolean; closed: boolean };

type Props = {
  motion: boolean;
  setMotion: (on: boolean) => void;
  noLogo: NoLogo;
  setNoLogo: (next: NoLogo) => void;
  icons: number;
  setIcons: (many: number) => void;
  mostIcons: number;
  spent: number;
  lit: boolean;
  busy: string; // changes when a search starts, which folds the panel away so it is never over the answer
};

/**
 * Everything adjustable, folded away behind one cog so the page is only the pile and the search bar. It opens on a
 * click and closes on a click anywhere else or on Escape.
 */
export function Settings({ motion, setMotion, noLogo, setNoLogo, icons, setIcons, mostIcons, spent, lit, busy }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const rate = useRef<HTMLSpanElement>(null);
  const pacing = useRef<HTMLDivElement>(null);

  /**
   * The frame pacing, read from the floor four times a second and written straight into the span. It is deliberately
   * not React state: re-rendering this panel every frame to report how smooth the frames are would be its own joke.
   * Only runs while the panel is open, so it costs nothing the rest of the time.
   */
  useEffect(() => {
    if (!open) return;
    const show = () => {
      const floor = (window as unknown as { __floor?: { paced: () => { fps: number; p50: number; p95: number; late: number } } }).__floor;
      const el = pacing.current;
      if (!floor || !el) return;
      const p = floor.paced();
      if (rate.current) rate.current.textContent = p.fps ? `${p.fps} fps` : "…";
      el.textContent = p.fps ? `p95 ${p.p95} ms · ${p.late} late` : "measuring";
      el.dataset.clean = String(p.late === 0); // a late frame is the only thing worth colouring
    };
    show();
    const timer = setInterval(show, 250);
    return () => clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (busy) setOpen(false);
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  // Every line is its own bordered cell, and the whole panel is set in the mono face, so it reads as an instrument
  // panel rather than as more of the page.
  const cell = "flex items-center justify-between gap-6 border-b border-line px-3.5 py-2.5";
  const head = "border-b border-line bg-white/[0.02] px-3.5 py-1.5 text-[10px] uppercase tracking-[0.12em] text-faint";
  const name = "select-none text-[11.5px] tracking-[-0.005em] text-text";
  return (
    <div ref={box} className="pointer-events-auto fixed right-5 top-5 z-40 flex flex-col items-end font-mono">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-label="Settings"
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-[4px] border border-line text-muted outline-none transition-colors duration-200 hover:border-line-strong hover:text-text focus-visible:border-line-strong data-[open=true]:border-line-strong data-[open=true]:text-text"
        data-open={open}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="settings-cog" data-open={open}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      <div className="settings-panel mt-2.5 w-[268px] overflow-hidden rounded-[5px] border border-line-strong bg-raised" data-open={open} aria-hidden={!open}>
        <div className={head}>Pile</div>
        <div className={cell}>
          <span className={name}>Motion</span>
          <LiquidToggle on={motion} onChange={setMotion} label="MacBook motion" />
        </div>
        <div className="border-b border-line px-3.5 py-2.5">
          <div className="flex items-center justify-between">
            <span className={name}>Icons</span>
            <span className="text-[11px] tabular-nums text-faint">{icons}</span>
          </div>
          <input
            type="range"
            min={100}
            max={mostIcons}
            step={50}
            value={icons}
            onChange={(e) => setIcons(Number(e.target.value))}
            aria-label="How many logos to draw in the pile"
            className="pile-range mt-2.5 h-[3px] w-full cursor-pointer appearance-none bg-white/[0.12] outline-none"
          />
        </div>

        <div className={head}>Companies with no logo</div>
        {([["active", "Active"], ["acquired", "Acquired"], ["closed", "Closed"]] as const).map(([key, label]) => (
          <div key={key} className={cell}>
            <span className={name}>{label}</span>
            <LiquidToggle on={noLogo[key]} onChange={(on) => setNoLogo({ ...noLogo, [key]: on })} label={`${label} companies with no logo`} />
          </div>
        ))}

        <div className={head}>Frames</div>
        <div className="border-b border-line px-3.5 py-2.5">
          <div className="flex items-center justify-between">
            <span className={name}>Pacing</span>
            <span ref={rate} className="text-[11px] tabular-nums text-faint" />
          </div>
          <div ref={pacing} className="mt-1 text-[10px] tabular-nums tracking-[0.02em] text-faint data-[clean=false]:text-text" />
        </div>

        <div className={head}>Spent</div>
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className={name}>On searching</span>
          <span className={`spend-total text-[11.5px] tabular-nums ${lit ? "text-text" : "text-muted"}`} data-lit={lit}>
            ${spent.toFixed(4)}
          </span>
        </div>
      </div>
    </div>
  );
}
