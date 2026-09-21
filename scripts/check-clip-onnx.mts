/**
 * Is the ONNX text tower the same model as the CoreML one?
 *
 * The 6,241 image vectors in the library were made by Apple's MobileCLIP-S0 CoreML package. A query is only comparable
 * to them if its text vector lands in that same space. A text tower from the wrong checkpoint does not throw: it
 * returns 512 perfectly well-formed floats that mean nothing, and the looks channel silently ranks noise. So the two
 * are run over the same token arrays and compared before anything is swapped.
 *
 *   node --experimental-strip-types scripts/check-clip-onnx.mts
 */
import ort from "onnxruntime-node";
import { embedText } from "../lib/clip/helper.ts";
import { tokenize } from "../lib/clip/tokenizer.ts";

const QUERIES = [
  "payments infrastructure",
  "crawl the internet",
  "an orange fox logo",
  "alien mascot, internet forum",
  "a blue shield with a white letter S",
  "my client wants the program in Chinese so his employees can use it",
  "trillion dollar companies",
  "developer tools for building apps",
  "a minimal black and white wordmark",
  "green leaf, sustainability",
];

const unit = (v: number[] | Float32Array) => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return Array.from(v, (x) => (n > 0 ? x / n : 0));
};
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

const mid = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// The truth to measure against: the CoreML tower that made the library's image vectors.
const truth = new Map<string, number[]>();
const coreMs: number[] = [];
for (const q of QUERIES) {
  const t = performance.now();
  truth.set(q, unit(await embedText(tokenize(q))));
  coreMs.push(performance.now() - t);
}
console.log(`coreml (the vectors in data/library.json were made with this)   ${mid(coreMs).toFixed(1)} ms\n`);

const builds = process.argv.slice(2).length ? process.argv.slice(2) : ["text_model", "text_model_fp16", "text_model_quantized", "text_model_q4"];
const rows: { build: string; worst: number; ms: number; mb: number }[] = [];

for (const build of builds) {
  const file = `models/onnx/${build}.onnx`;
  let session;
  try {
    session = await ort.InferenceSession.create(file);
  } catch {
    console.log(`${build.padEnd(22)} missing`);
    continue;
  }
  const run = async (q: string) => {
    const tokens = tokenize(q);
    const ids = new ort.Tensor("int64", BigInt64Array.from(tokens, BigInt), [1, tokens.length]);
    const out = await session.run({ [session.inputNames[0]]: ids });
    return unit(out[session.outputNames[0]].data as Float32Array);
  };
  await run(QUERIES[0]); // warm: the first call pays for graph setup, which a long-lived server pays once
  let worst = 1;
  let worstAt = "";
  const ms: number[] = [];
  for (const q of QUERIES) {
    const t = performance.now();
    const v = await run(q);
    ms.push(performance.now() - t);
    const cos = dot(truth.get(q)!, v);
    if (cos < worst) {
      worst = cos;
      worstAt = q;
    }
  }
  const mb = (await import("node:fs")).statSync(file).size / 1048576;
  rows.push({ build, worst, ms: mid(ms), mb });
  console.log(`${build.padEnd(22)} worst cosine ${worst.toFixed(6)}  ${mid(ms).toFixed(1).padStart(6)} ms  ${mb.toFixed(0).padStart(4)} MB   ${worst > 0.999 ? "faithful" : `DRIFTS on "${worstAt}"`}`);
}

const best = rows.filter((r) => r.worst > 0.999).sort((a, b) => a.mb - b.mb)[0];
console.log(best ? `\nsmallest faithful build: ${best.build} (${best.mb.toFixed(0)} MB, ${best.ms.toFixed(1)} ms)` : "\nno build is faithful: do not swap");
process.exit(0);
