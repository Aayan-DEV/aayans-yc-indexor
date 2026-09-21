import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { textOnnx } from "./onnx";

export type ImageResult = { embedding: number[]; colorText: string; colors: string[]; ms: number };

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };
type Helper = { proc: ChildProcessWithoutNullStreams; pending: Map<number, Pending>; nextId: number; ready: Promise<void> };

// One warm helper per server process. It lives on globalThis so dev hot reloads reuse it instead of spawning more.
const store = globalThis as unknown as { __clipHelper?: Helper };

function start(): Helper {
  const proc = spawn(path.join(process.cwd(), "native", "coreml_embed"), [path.join(process.cwd(), "models")]);
  const pending = new Map<number, Pending>();
  let markReady!: () => void;
  let failReady!: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => ((markReady = res), (failReady = rej)));

  readline.createInterface({ input: proc.stdout }).on("line", (line) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.ready) return markReady();
    const waiter = pending.get(msg.id as number);
    if (!waiter) return;
    pending.delete(msg.id as number);
    if (msg.ok) waiter.resolve(msg);
    else waiter.reject(new Error(String(msg.error ?? "helper error")));
  });
  const die = (why: string) => {
    const err = new Error(`MobileCLIP helper stopped: ${why}`);
    failReady(err);
    for (const w of pending.values()) w.reject(err);
    pending.clear();
    if (store.__clipHelper?.proc === proc) store.__clipHelper = undefined; // the next request starts a fresh one
  };
  proc.on("error", (e) => die(e.message));
  proc.on("exit", (code) => die(`exit code ${code}`));
  return { proc, pending, nextId: 1, ready };
}

async function request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const helper = (store.__clipHelper ??= start());
  await helper.ready;
  const id = helper.nextId++;
  return new Promise((resolve, reject) => {
    helper.pending.set(id, { resolve, reject });
    helper.proc.stdin.write(JSON.stringify({ id, ...payload }) + "\n");
  });
}

/**
 * The CoreML helper is a Mach-O arm64 binary reading Apple-only `.mlmodelc` models, so it exists on this Mac and
 * nowhere else. Where it is missing, the text tower runs from ONNX instead, which `scripts/check-clip-onnx.mts` shows
 * to be the same model to within float precision. CoreML is kept where it is available because the Neural Engine does
 * it in about half the time (6.5 ms against 12.7 ms).
 */
// CLIP_BACKEND=onnx forces the portable path on this Mac, which is how the Linux behaviour is tested before deploying.
const onMac = process.env.CLIP_BACKEND !== "onnx" && process.platform === "darwin" && fs.existsSync(path.join(/* turbopackIgnore: true */ process.cwd(), "native", "coreml_embed"));

/**
 * Reading a picture needs the CoreML helper: the embedding, the colour words from pixel maths and the letters from
 * Apple's Vision OCR all come from it. Everything already in the library was read on a Mac and its vectors are saved,
 * so searching never calls this. Only a newly uploaded image does, and off a Mac it is left unindexed rather than
 * half-indexed with three of its four signals missing.
 */
export async function embedImage(file: string): Promise<ImageResult> {
  if (!onMac) throw new Error("reading a new image needs the CoreML helper, which is macOS only");
  const r = await request({ op: "image", path: file });
  return { embedding: r.embedding as number[], colorText: r.colorText as string, colors: r.colors as string[], ms: r.ms as number };
}

/** A query's vector, in the same space as every image vector in the library. Every search goes through here. */
export async function embedText(tokens: number[]): Promise<number[]> {
  if (!onMac) return textOnnx(tokens);
  return (await request({ op: "text", tokens })).embedding as number[];
}
