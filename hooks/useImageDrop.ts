"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryEntry } from "@/lib/types";

export type DropProgress = { total: number; done: number; failed: number; duplicates: number; active: boolean; avgMs: number };
const IDLE: DropProgress = { total: 0, done: 0, failed: 0, duplicates: 0, active: false, avgMs: 0 };
const PARALLEL = 4;

/** Whole-page image dropping and pasting. Each file is uploaded, indexed on the server, then handed to `onAdded`. */
export function useImageDrop(onAdded: (entry: LibraryEntry) => void) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<DropProgress>(IDLE);
  const depth = useRef(0); // dragenter and dragleave fire for every child element, so count them instead of trusting one
  const queue = useRef<File[]>([]);
  const running = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pump = useCallback(() => {
    while (running.current < PARALLEL && queue.current.length) {
      const file = queue.current.shift()!;
      running.current++;
      const body = new FormData();
      body.append("file", file);
      fetch("/api/upload", { method: "POST", body })
        .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
        .then(({ ok, data }) => {
          if (ok && data.entry) {
            if (!data.duplicate) onAdded(data.entry as LibraryEntry);
            setProgress((p) => ({ ...p, done: p.done + 1, duplicates: p.duplicates + (data.duplicate ? 1 : 0), avgMs: p.avgMs + (data.entry.indexMs - p.avgMs) / (p.done + 1) }));
          } else setProgress((p) => ({ ...p, done: p.done + 1, failed: p.failed + 1 }));
        })
        .catch(() => setProgress((p) => ({ ...p, done: p.done + 1, failed: p.failed + 1 })))
        .finally(() => {
          running.current--;
          pump();
        });
    }
  }, [onAdded]);

  const addFiles = useCallback(
    (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
      if (clearTimer.current) clearTimeout(clearTimer.current);
      queue.current.push(...images);
      setProgress((p) => (p.active ? { ...p, total: p.total + images.length } : { ...IDLE, total: images.length, active: true }));
      pump();
    },
    [pump],
  );

  // When the last file lands, show the full bar briefly, then clear it.
  useEffect(() => {
    if (progress.active && progress.total > 0 && progress.done >= progress.total) {
      clearTimer.current = setTimeout(() => setProgress(IDLE), 700); // the full bar stays just long enough to register
      return () => {
        if (clearTimer.current) clearTimeout(clearTimer.current);
      };
    }
  }, [progress]);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // without this the browser opens the file instead of letting us have it
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      addFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.some((f) => f.type.startsWith("image/"))) addFiles(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, [addFiles]);

  return { dragging, progress, addFiles };
}
