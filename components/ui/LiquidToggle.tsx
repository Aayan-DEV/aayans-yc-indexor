"use client";

import { useEffect, useRef } from "react";

const TRACK = { width: 46, height: 26 };
const THUMB = 18;
const DROP = 13;
const OFF = 4; // the thumb's x when off
const ON = TRACK.width - THUMB - 4; // and when on

type Props = { on: boolean; onChange: (on: boolean) => void; label: string };

/**
 * A switch whose thumb is liquid. Two blobs share one position: the thumb, which a spring carries to its side (or a
 * finger drags), and a smaller drop on a second spring that chases wherever the thumb is right now. A goo filter
 * (blur, then a hard alpha threshold) melts them into one shape, so it stays a circle when it moves slowly and necks
 * out behind when it moves fast. Both springs run in one small animation loop that stops once everything is still.
 */
export function LiquidToggle({ on, onChange, label }: Props) {
  const thumb = useRef<HTMLSpanElement>(null);
  const drop = useRef<HTMLSpanElement>(null);
  const motion = useRef({ x: on ? ON : OFF, v: 0, dropX: on ? ON : OFF, dropV: 0, target: on ? ON : OFF, dragging: false, raf: 0, last: 0 });

  const paint = () => {
    const m = motion.current;
    if (thumb.current) thumb.current.style.transform = `translateX(${m.x}px)`;
    if (drop.current) drop.current.style.transform = `translateX(${m.dropX + (THUMB - DROP) / 2}px)`;
  };

  const run = () => {
    const m = motion.current;
    if (m.raf) return;
    m.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - m.last) / 1000);
      m.last = now;
      if (!m.dragging) {
        m.v += (260 * (m.target - m.x) - 19 * m.v) * dt; // a quick spring with one small overshoot: the squash on landing
        m.x += m.v * dt;
      }
      m.dropV += (120 * (m.x - m.dropX) - 15 * m.dropV) * dt; // softer, so it trails
      m.dropX += m.dropV * dt;
      paint();
      const still = !m.dragging && Math.abs(m.target - m.x) < 0.05 && Math.abs(m.v) < 0.5 && Math.abs(m.x - m.dropX) < 0.05 && Math.abs(m.dropV) < 0.5;
      m.raf = still ? 0 : requestAnimationFrame(tick);
    };
    m.raf = requestAnimationFrame(tick);
  };

  useEffect(() => {
    motion.current.target = on ? ON : OFF;
    run();
  }, [on]);
  useEffect(() => {
    paint(); // where it stands before anything has moved
    const m = motion.current;
    return () => {
      cancelAnimationFrame(m.raf);
      m.raf = 0; // React mounts effects twice in development: a stale id here would keep the loop from ever starting again
    };
  }, []);

  // A press toggles. A drag moves the thumb with the finger and lands on whichever side it was let go nearer to.
  const press = useRef<{ startX: number; from: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { startX: e.clientX, from: motion.current.x, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    const by = e.clientX - p.startX;
    if (Math.abs(by) > 3) p.moved = true;
    if (!p.moved) return;
    const m = motion.current;
    m.dragging = true;
    m.x = Math.max(OFF, Math.min(ON, p.from + by));
    m.v = 0;
    run();
  };
  const onPointerUp = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    const m = motion.current;
    m.dragging = false;
    const next = p.moved ? m.x > (OFF + ON) / 2 : !on;
    m.target = next ? ON : OFF;
    run();
    if (next !== on) onChange(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), onChange(!on))}
      className="relative shrink-0 cursor-pointer touch-none rounded-full border border-line bg-white/[0.05] outline-none transition-colors duration-300 focus-visible:border-line-strong data-[on=true]:bg-white/[0.1]"
      data-on={on}
      style={{ width: TRACK.width, height: TRACK.height }}
    >
      <svg width="0" height="0" className="absolute" aria-hidden>
        <filter id="liquid-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" />
        </filter>
      </svg>
      {/* Opaque blobs only: the filter thresholds alpha, and a see-through fill would vanish. */}
      <span className="absolute inset-0" style={{ filter: "url(#liquid-goo)" }}>
        <span ref={drop} className="liquid-blob absolute left-0 rounded-full" data-on={on} style={{ width: DROP, height: DROP, top: (TRACK.height - DROP) / 2 - 1 }} />
        <span ref={thumb} className="liquid-blob absolute left-0 rounded-full" data-on={on} style={{ width: THUMB, height: THUMB, top: (TRACK.height - THUMB) / 2 - 1 }} />
      </span>
    </button>
  );
}
