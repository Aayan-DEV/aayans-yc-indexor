import fs from "node:fs";
import path from "node:path";
import { FOLDER, has } from "@/lib/library";

const TYPES: Record<string, string> = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".avif": "image/avif" };

/** Serves library images from disk. Only files the library knows are served, so this cannot be used to read anything else. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = path.basename(decodeURIComponent((await params).file));
  if (!(await has(file))) return new Response("Not found", { status: 404 });
  const data = await fs.promises.readFile(path.join(FOLDER, file)).catch(() => null);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
}
