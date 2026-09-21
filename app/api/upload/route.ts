import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FOLDER, IMAGE, findByHash, ingest } from "@/lib/library";
import type { LibraryEntry } from "@/lib/types";

const MAX_BYTES = 40 * 1024 * 1024;

/** One image per request, so the page can show honest per-file progress. The reply arrives only once the image is searchable. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const upload = form?.get("file");
  if (!(upload instanceof File)) return Response.json({ error: "No file." }, { status: 400 });
  if (!upload.type.startsWith("image/") || !IMAGE.test(upload.name)) return Response.json({ error: "Not a supported image." }, { status: 415 });
  if (upload.size > MAX_BYTES) return Response.json({ error: "Larger than 40 MB." }, { status: 413 });

  const bytes = Buffer.from(await upload.arrayBuffer());
  // The same picture is never stored twice, whatever it is called this time.
  const hash = crypto.createHash("sha1").update(bytes).digest("hex");
  const existing = await findByHash(hash);
  if (existing) {
    const entry: LibraryEntry = { id: existing.id, src: existing.src, title: existing.title, addedAt: existing.addedAt, indexMs: existing.indexMs };
    return Response.json({ entry, duplicate: true });
  }
  const ext = path.extname(upload.name).toLowerCase();
  const stem = path.basename(upload.name, path.extname(upload.name)).replace(/[^a-zA-Z0-9-_ ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "image";
  const file = `${stem}-${hash.slice(0, 8)}${ext}`; // readable name plus a short hash, so two different "image.png" never collide
  const full = path.join(FOLDER, file);
  const duplicate = fs.existsSync(full);
  if (!duplicate) await fs.promises.writeFile(full, bytes);

  const item = await ingest(file);
  if (!item) {
    if (!duplicate) await fs.promises.unlink(full).catch(() => {});
    return Response.json({ error: "Could not read this image." }, { status: 422 });
  }
  const entry: LibraryEntry = { id: item.id, src: item.src, title: item.title, addedAt: item.addedAt, indexMs: item.indexMs };
  return Response.json({ entry, duplicate });
}
