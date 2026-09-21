import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Meaning vectors for written text, from bge-small-en-v1.5.
 *
 * MobileCLIP's text tower used to do this job, and it was the wrong tool: it exists to match captions to pictures, not
 * prose to prose, and it reads at most 77 tokens. Measured by ranking the right company out of 6,241 across 36 real
 * requests, this model puts the answer at median rank 1 against 12, and in the top ten 75% of the time against 47%.
 * Apple's two built-in text embedders and reading the full description in overlapping CLIP windows were both tried
 * first and both came out worse, so neither is worth revisiting.
 */
export const DIM = 384;

// bge was trained with this line in front of a search, and nothing in front of the thing being searched.
const ASKING = "Represent this sentence for searching relevant passages: ";

const store = globalThis as unknown as { __bge?: Promise<FeatureExtractionPipeline> };

function model(): Promise<FeatureExtractionPipeline> {
  return (store.__bge ??= (async () => {
    const { pipeline } = await import("@huggingface/transformers");
    return pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", { dtype: "q8" });
  })());
}

/** Vectors for text being indexed. Batched, because one call per company is most of a minute slower over 6,241 of them. */
export async function embedMeaning(texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const embed = await model();
  const out = await embed(texts.map((t) => t || "nothing"), { pooling: "cls", normalize: true });
  const data = out.data as Float32Array;
  return texts.map((_, i) => data.slice(i * DIM, (i + 1) * DIM));
}

/** The vector for what a person typed. */
export async function embedAsking(query: string): Promise<Float32Array> {
  const embed = await model();
  const out = await embed(ASKING + query, { pooling: "cls", normalize: true });
  return (out.data as Float32Array).slice(0, DIM);
}

/** Loads the model before the first search needs it, so nobody waits 16 seconds for it. */
export const warmMeaning = () => model().catch(() => undefined);
