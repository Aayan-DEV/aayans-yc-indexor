# Aayan's-YC-indexor

Describe a YC startup in any words you like and the logos that match float up out of a physics pile, each with how likely it is.
All 6,241 companies are searchable by what they do, what their logo looks like, and what they say inside it.

## You need an Apple Silicon Mac

This is a hard requirement, not a preference. Every search embeds your query with MobileCLIP-S0, and that model is Core ML,
which only exists on Apple platforms. `native/coreml_embed` is a compiled arm64 binary that loads it and every search goes
through it. On Linux or Windows the first query throws.

The rest of the stack is portable, so this is fixable if you want it. The same MobileCLIP checkpoint has an ONNX export that
matches Core ML to a cosine of 0.999914, and `onnxruntime-node` is already a dependency. `NOTES.md` has the measurements.

You also need Node 20 or newer, and a TypeSafe key.

## Run it

```bash
git clone https://github.com/Aayan-DEV/aayans-yc-indexor && cd aayans-yc-indexor
npm install
cp .env.example .env.local
npm run dev
```

Then open http://localhost:3000.

## The key

Put a TypeSafe key in `.env.local` as `TYPE_SAFE_KEY`. Get one at [typesafe.ai](https://typesafe.ai).

`.env.local` is gitignored and is not in this repo, which is the point: it holds your real key. `.env.example` is the
template you copy. If this sits next to sibling projects that share one key file, a `.env` one directory up is read as a
fallback.

Without a key the app still starts and the pile still works, but Jev never gets asked and ranking falls back to a local
scorer. You can see it in the API response: `degraded: true` and `costUsd: null`. Results get noticeably worse.

First start takes about sixteen seconds while the sentence model loads. After that a search is roughly one second and
costs about a fifth of a cent.

## Optional: tilt the laptop

```bash
npm run build:motion
```

That compiles a helper which reads the MacBook's accelerometer and lid angle straight off the HID devices and streams them
to the page, so tilting the laptop tilts gravity in the pile and shaking it throws the icons. macOS gives browsers no
motion events, so there is no other way to get at it. Without the helper nothing changes and the pile keeps ordinary gravity.

If either Swift binary refuses to run on your macOS version, rebuild it with `npm run build:native` or `npm run build:motion`.

## How it finds things

Retrieval is ordinary vector maths over all 6,241 companies, four signals at once:

- **meaning**, bge-small sentence embeddings of each company's write-up
- **looks**, MobileCLIP-S0 image vectors of the logo itself
- **letters**, what Apple's Vision OCR read inside the logo
- **tags**, YC's own 337 tags, re-applied to every company by Jev because YC's own tagging is patchy

That narrows 6,241 down to at most 320 finalists. Jev then scores every finalist in one parallel request and returns a
calibrated probability rather than generated text, which is why the percentages on screen are real and why it lands in
about a second.

## Everything else

`NOTES.md` is the long version: the retrieval pipeline in detail, the physics and frame-pacing work, the sprite atlas, and
the measurements behind all of it.

## Licence

The code is MIT. The logos, the YC data and the Apple models bundled with it are not mine to license; see [LICENSE](LICENSE).
