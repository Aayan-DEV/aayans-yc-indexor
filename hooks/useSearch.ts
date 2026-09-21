"use client";

import { useCallback, useRef, useState } from "react";
import type { SearchResponse } from "@/lib/types";

export type SearchState =
  | { phase: "idle" }
  | { phase: "searching"; query: string }
  | { phase: "done"; data: SearchResponse; at: number } // `at` identifies this particular answer, so a counter cannot add it twice
  | { phase: "error"; query: string; message: string };

export function useSearch() {
  const [state, setState] = useState<SearchState>({ phase: "idle" });
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (raw: string, noLogo?: { active: boolean; acquired: boolean; closed: boolean }) => {
    const query = raw.trim();
    if (query.length < 2) return;
    controller.current?.abort(); // a new search cancels the one still in flight
    const mine = new AbortController();
    controller.current = mine;
    setState({ phase: "searching", query });
    // A dropped connection or a server that is restarting is usually over in a second, so try again quietly
    // before bothering the person. Only a request the server understood and refused (4xx) fails at once.
    const WAITS = [350, 900, 1800];
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, noLogo }),
          signal: mine.signal,
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data) {
          if (!mine.signal.aborted) setState({ phase: "done", data: data as SearchResponse, at: Date.now() });
          return;
        }
        if (res.status >= 400 && res.status < 500) {
          if (!mine.signal.aborted) setState({ phase: "error", query, message: data?.error ?? "That search could not be run." });
          return;
        }
        throw new Error("server error");
      } catch {
        if (mine.signal.aborted) return;
        if (attempt >= WAITS.length) {
          setState({ phase: "error", query, message: "Search is not responding." });
          return;
        }
        await new Promise((r) => setTimeout(r, WAITS[attempt]));
        if (mine.signal.aborted) return;
      }
    }
  }, []);

  const reset = useCallback(() => {
    controller.current?.abort();
    setState({ phase: "idle" });
  }, []);

  return { state, run, reset };
}
