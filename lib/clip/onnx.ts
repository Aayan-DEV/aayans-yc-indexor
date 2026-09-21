import path from "node:path";
import * as ort from "onnxruntime-node";

/**
 * MobileCLIP-S0's text tower, the portable half.
 *
 * The library's 6,241 image vectors were made by Apple's CoreML package, which only runs on macOS, and a query is only
 * comparable to them if its text vector lands in that same 512-dimensional space. This is the same S0 checkpoint
 * exported to ONNX, so it runs anywhere Node does. `scripts/check-clip-onnx.mts` is the proof: over ten queries the
 * worst agreement with the CoreML tower is a cosine of 0.999914, which is float precision, not a different model.
 *
 * It is the fp16 build on purpose. The int8 one is half the size again and completely wrong: its worst cosine is
 * 0.847, and the 4-bit build manages 0.982. Neither throws. They return 512 well-formed floats that quietly rank
 * nonsense, which is exactly why the two towers are compared before either is trusted.
 */
const FILE = path.join(/* turbopackIgnore: true */ process.cwd(), "models", "onnx", "text_model_fp16.onnx");

// One session per server process, on globalThis so a dev hot reload reuses it rather than loading 81 MB again.
const store = globalThis as unknown as { __clipOnnx?: Promise<ort.InferenceSession> };

const session = () => (store.__clipOnnx ??= ort.InferenceSession.create(FILE));

/** 77 CLIP token ids in, a unit-length 512-vector out, matching what the CoreML helper returns. */
export async function textOnnx(tokens: number[]): Promise<number[]> {
  const model = await session();
  const ids = new ort.Tensor("int64", BigInt64Array.from(tokens, BigInt), [1, tokens.length]);
  const out = await model.run({ [model.inputNames[0]]: ids });
  const raw = out[model.outputNames[0]].data as Float32Array;
  let norm = 0;
  for (const x of raw) norm += x * x;
  norm = Math.sqrt(norm);
  return Array.from(raw, (x) => (norm > 0 ? x / norm : 0)); // unit length, so a dot product is the cosine similarity
}

/** Load the model now rather than on the first search, so nobody waits for 81 MB mid-query. */
export const warmOnnx = () => session().catch(() => {});
