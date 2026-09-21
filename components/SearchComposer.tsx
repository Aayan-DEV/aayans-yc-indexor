"use client";

import { useEffect, useRef, useState } from "react";
import { VoiceBeam } from "voice-glow";
import { Orb } from "./fx/Orb";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onClear: () => void;
  busy: boolean;
};

export function SearchComposer({ value, onChange, onSubmit, onClear, busy }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const energy = useRef(0);
  const [ready, setReady] = useState(false);

  // Typing drives the glow: each keystroke adds energy, and it decays every frame.
  useEffect(() => {
    setReady(true);
    let raf = 0;
    const tick = () => {
      energy.current *= 0.91;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Text typed before React finished loading lives only in the DOM, so adopt it once.
  useEffect(() => {
    const typed = input.current?.value;
    if (typed && typed !== value) onChange(typed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => onSubmit(input.current?.value ?? value);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const form = (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex w-full items-center gap-3 rounded-[5px] border border-line bg-panel/95 py-3 pl-6 pr-3 backdrop-blur-2xl transition-colors duration-300 focus-within:border-line-strong"
    >
      <label htmlFor="q" className="sr-only">
        Describe an image
      </label>
      <input
        id="q"
        ref={input}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        maxLength={300}
        value={value}
        onChange={(e) => {
          energy.current = Math.min(1, energy.current + 0.5);
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault(); // submit here so Enter works before any effect has mounted
            submit();
          }
          if (e.key === "Escape") {
            onClear();
            input.current?.blur();
          }
        }}
        placeholder="Describe a startup"
        className="min-w-0 flex-1 bg-transparent py-2 text-[18px] leading-8 tracking-[-0.01em] text-text outline-none placeholder:text-faint"
      />
      <button
        type="submit"
        disabled={busy || value.trim().length < 2}
        aria-label={busy ? "Searching" : "Search"}
        className="grid size-12 shrink-0 place-items-center rounded-[5px] border border-line transition-all duration-300 ease-out enabled:hover:border-line-strong enabled:hover:bg-white/[0.06] enabled:active:scale-95 disabled:opacity-45"
      >
{/* The orb is the search button: it breathes while idle and spins up while Jev is judging. */}
        <Orb state={busy ? "searching" : "breathing"} size={64} display={30} />
      </button>
    </form>
  );

  if (!ready) return form; // server render and first paint stay plain, so the input is usable immediately

  return (
    <VoiceBeam
      type="default"
      theme="dark"
      colorVariant="colorful"
      level={() => energy.current}
      processing={busy}
      strength={0.9}
      className="w-full"
    >
      {form}
    </VoiceBeam>
  );
}
