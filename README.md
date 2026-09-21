# Icon Recall

Describe a startup the way you half remember it. MobileCLIP finds it, and Jev breaks ties on color.

## How it works

**MobileCLIP-S0 on Core ML does the seeing, Jev is the tie-breaker.** Numbers throughout were measured on an Apple Silicon MacBook (M1 Pro); treat them as the shape of the result rather than a promise about your machine.

1. **Any image dropped into `public/icons/` is searchable about 50 ms later.** `lib/library.ts` watches the folder. A warm Swift helper
   (`native/coreml_embed.swift`, built with `npm run build:native`) embeds the image with Apple's MobileCLIP-S0 on Core ML (5 ms) and names
   its colors with pixel math, about 10 ms in total. Deleting a file removes it within about 16 ms. Vectors persist in `data/library.json`,
   so a restart only embeds files it has not seen.
2. **Search** (`app/api/search/route.ts`). The query is tokenized in Node (`lib/clip/tokenizer.ts`, checked token for token against the
   reference), embedded by the same helper (8 ms), and compared with every image. A softmax turns similarities into each image's share of the match.
3. **Jev understands the words.** Looks alone cannot answer "fintech from nigeria", so Jev sorts the description into a category and then judges the
   finalists' written info and colors. The full pipeline is in the last section.
4. **The whole page is a drop target** (`hooks/useImageDrop.ts`, `components/DropZone.tsx`). Drag any number of images over the window and a dotted
   frame appears; drop them and each one is uploaded (4 at a time), indexed, and falls into the pile. A thin bar at the bottom counts them, then reports
   how many were added and the average indexing time. Pasting an image works too. `app/api/upload` accepts PNG, JPEG, WebP, GIF and AVIF up to 40 MB,
   and recognises a picture it already has by its content hash, whatever the file is called.
5. **The page also polls `/api/library`**, so images copied into the folder by hand fall into the pile as well. Images are served by
   `app/library/[file]`, which only serves files the library knows about.

Models live in `models/` (114 MB, git-ignored): `mobileclip_s0_image.mlpackage` and `mobileclip_s0_text.mlpackage` from `apple/coreml-mobileclip`.

## Reliability

- **Backend fallback chain.** TypeSafe direct (`TYPE_SAFE_KEY`, 1,200 requests a minute, no daily cap) → classifier.dev batch → Vercel AI Gateway → a local keyword scorer. Measured on TypeSafe direct: median 355 ms, p90 430 ms, zero rate-limit errors across 66 back-to-back searches, 15,200 input tokens = $0.00064 per search. The API response carries `tokens` and `costUsd`. A backend that fails is skipped for 5 minutes so searches stay fast. On Vercel the call is turned around: the description is the state and every icon x text is one question, so all 33 icons ride in a single request instead of 66.
- **Cache.** Keyed by query *and* index file mtime, so rebuilding the index never serves stale results. Identical in-flight searches share one Jev call.
- **WebGL is decoration only.** The metal ring paints behind the submit button; the button itself is plain DOM, so a lost WebGL context cannot break search. Every effect is `ssr: false` with a static fallback.
- A new search aborts the previous request.

## Run

```bash
npm run dev
```

Everything the app needs at runtime is committed: all 6,241 logos in `public/icons`, their vectors and metadata in `data/`,
the packed sprite sheet in `public/atlas`, and the Core ML models in `models/`. There is no index to build before it runs.

Rebuild the packed sprite sheet after adding companies:

```bash
npm run atlas
```

## Config

Copy `.env.example` to `.env.local` and fill in `TYPE_SAFE_KEY`. Next loads `.env.local` on its own; a `.env` one
directory up is read as a fallback, for the case where this sits beside sibling projects that share one key file.
Without the key every search falls back to a local scorer and answers `degraded: true`.

| | |
| --- | --- |
| `TYPE_SAFE_KEY` | required, from typesafe.ai |
| `VERCEL_API_KEY` / `AI_GATEWAY_API_KEY` | optional fallbacks |
| `JEV_PRIMARY` | `vercel` tries the gateway first; the default `batch` judges every finalist in one request |
| `JEV_DETAIL` | characters of each company's description sent per finalist, default 420 |

## Interface

- **Physics floor** (`components/IconFloor.tsx`): every icon is a `matter-js` rigid body. They drop in staggered, pile on the floor, and can be dragged and thrown with the cursor. Fixed 60 Hz timestep and `enableSleeping` keep the pile perfectly still at rest; settled bodies leave the solver and the canvas stops repainting. Reduced-motion settles the pile instantly with no fall.
- **Typing shakes the pile.** Each keystroke sends a tremor scaled by typing speed, rate-limited so a fast burst cannot compound into a throw.
- **Transparent logos sit on light glass.** A see-through logo would vanish on the dark page, so `floor/sprite.ts` paints a near-white sheet with a gloss sweep and a soft rim behind every icon. Light rather than dark, because a dark glyph on dark glass is as invisible as no backing at all. An opaque logo covers it, so nothing has to test which images have transparency.
- **Every match over 30% floats up** (`components/IconFloor.tsx` owns the world, frame loop and drawing; `components/floor/` has `matches.ts` for which match goes where, `forces.ts` for the springs, `layout.ts` for the grid, `overlays.ts` for the container, labels and tooltip, `swaps.ts` for images popping in and out, `scene.ts` for the state they share). Up to 120 matches gather in a container just above the search bar. `gridLayout` picks the largest icon size at which every row still fits between the motion switch and the bar, never below 52 px. If they do not fit at that size, the container shows the full rows that fit plus half a row peeking out, and scrolls with the wheel: no scroll bar, soft edges in the container's own color show that there is more. Each cell reserves room for its probability label, so nothing overlaps at any window size; a resize lays it out again. Only rows that can be seen set off from the pile; the others rise when they are scrolled into view. They never leave the simulation on the way: gravity is cancelled, a soft spring pulls each one to its cell, it grows and an angular spring turns it upright. Matches collide with the pile but never with each other, and a match counts as arrived once it is within most of its own size of its cell (or after 3 s), so pile icons cannot ride on it.
- **Scrolling while matches are still arriving.** Labels move at once, as one layer, so every icon that has reached its cell moves just as rigidly: parked ones are set exactly, settling ones are shifted by the same amount and keep their velocity (`scrollIcons` in `matches.ts`). A label only appears once its icon is within 8 px of its cell, and an arrived icon homes in on a spring five times as stiff and straightens seven times as fast. Check it from the console: `__floor.drift()` reports the worst gap between a labelled icon and its cell. Scrolling hard during the rise it stays at 8 px (it was 259 px when the springs did the following).
- **Settled matches cost nothing.** Once a match is in its cell, upright, full size and still, it is snapped into place and put to sleep (`park` in `forces.ts`). Before that, every match kept bobbing, which meant repainting the whole canvas (8 million pixels in a large Retina window) and moving every label on every frame for as long as results were up. Now labels are placed once, inside one layer that moves as a whole when the container scrolls, the tooltip and the rim of light only touch the DOM when a value changes, and an image swapping in the resting pile repaints only its own patch (`drawSwaps`). Measured with 60 matches up: 3 full repaints in 3 s instead of one per frame, 0 bodies awake.
- **The pile is a moving window.** It draws up to 1,200 of the 6,241 logos. Every second or so one icon shrinks away and another from the library falls in from above the window, already moving, rather than appearing in the gap. The icons around a spot something has just left or joined are woken so they settle into it, otherwise they hang in the air over the hole (`wakeAt` in `floor/forces.ts`). Measured: 77 swaps in 25 s, nothing left hanging, one body awake, 1.05 ms a step.
- **The matches leave in waves, not all at once.** Sixty icons setting off in the same frame is a scrum: they shoulder each other through the pile, take two to four seconds to get out, and arrive scattered. Three set off every 70 ms instead (`WAVE`/`WAVE_GAP` in `matches.ts`), best first, so the grid fills row by row and every icon reaches its cell cleanly. Sixty matches are all away inside a second and a half. A cell that has no icon to spare when its turn comes keeps its place at the head of the queue rather than being skipped.
- **Nothing gets stranded under the search bar.** The half row that peeks out of the bottom of the container has its cell a few pixels *outside* the container, in the gap above the search bar. Flying an icon there left it hovering in plain sight under the bar for seconds and then parking half out of the box, which is what looked like icons rising and then getting stuck or vanishing. Only a cell that is wholly inside the container is worth flying to (`whollyInView`); the peek row is content, like anything else in a scrolling list, so it appears in place. Rows entirely outside are not launched at all. Check it with `__floor.stuck()`: it reports every match that is not in its cell, and `belowBox` is the telling flag. It went from 24 icons stranded for seconds to the 12 peek-row cells parking instantly with a flight time of 0.
- **Scrolling does its work once a frame, not once a wheel event.** A trackpad sends about a hundred wheel events a second, and each one used to move every match, retire the ones scrolled away (a full scan of the pile, twice per retiring icon) and work out which cells were newly in view (another full scan per cell). That is a few million operations a second of pure scanning, which is the lag you could feel. `scene.scroll` is still exact the instant the wheel turns; the work is coalesced into the frame loop, retirements are capped at 8 a frame, and the pile is scanned once per wave instead of once per cell. Measured under synthetic 100 Hz wheel spam for 3 s: 105 fps, container still completely full afterwards.
- **No holes in the grid.** A cell was counted as launched before its icon had actually set off, so if the launch could not start (no spare icon in the pile at that moment, or a picture that never loaded) the cell stayed empty for good, in the middle of the grid. A rank that cannot set off is now simply left for the next pass, and the frame loop gives it another go. A cell waiting on a picture is counted as *pending* rather than launched, too: marking it launched up front and then scrolling away before the picture arrived left the cell marked done for good with nothing in it, and never gave its pile icon back, which emptied the container after a hard scroll. `__floor.holes()` reports how many cells in view are still waiting; it reads 0 with 120 matches sharing a 150-icon pile, and 0 after three seconds of scrolling back and forth as fast as the wheel can go.
- **A router refresh does not restart the pile.** The page is server-rendered fresh on every request, so a refresh hands down a newly shuffled sample. Taking it would tear down the physics world and pour the whole pile in again under the person; the sample is settled on once, on the first render. If the floor does rebuild, the matches are sent to the new one rather than to the one that no longer exists.
- **Tooltip on hover.** The cursor over a floating match opens a rounded box with a caret pointing at it: name, one line about what it is, batch and place. Placement goes above, then beside, then below. The grid grows upward until it is pressed against the top of the window, so the first rows have no room above them; going beside covers two or three neighbours instead of two whole rows, which is what flipping below used to do. It never leaves the window, and the caret keeps pointing at the icon.
- **Reading along a row keeps up with you.** The first card waits 90 ms for the cursor to settle, so sweeping the grid with nothing open does not flash a card per icon. After that the card simply *moves*: it never closes, so there is no fade-out and no 420 ms entrance to sit through. It used to fade out for 150 ms and then play the whole entrance again for every icon, about 570 ms an icon, so reading along a row showed no complete card at all. Now it hops after 35 ms, sliding for a short hop and jumping for a long one so it never travels across the page. Measured sweeping a row at 17 icons a second: 8 complete cards read, 95 fps. Each card's size is measured once and remembered, so hovering back over a match costs no layout at all.
- **The card was never actually arriving.** `.match-tip[data-side=...] > div` carries the offset the card grows *from*. It matched `[data-open="true"] > div` on specificity and came after it in the file, so it won the cascade and an open card sat permanently 6 px off and 3% small; only the blur ever resolved. The offsets are now scoped to `:not([data-open="true"])`.
- **One cog, top right** (`components/ui/Settings.tsx`). Everything adjustable folds away behind it, so the page is only the pile and the search bar: the motion switch, which companies with no logo to keep (Active, Acquired, Closed, each on its own), how many icons the pile draws, and what the searching has cost. It closes on a click anywhere else, on Escape, and whenever a search starts, so it is never sitting over the answer.

- **Square corners, one radius** (`--radius`, 5px). The search bar, the results box, the settings panel and the cog all share it, and every chip and button is 4px, so the page reads as squares with just enough roundness to not be sharp. The settings panel is set in Geist Mono and drawn as bordered cells with small capitalised headers rather than as a padded card: it looks like an instrument panel instead of like more of the page. The liquid switches stay round, because the blob that stretches between the two ends is the whole effect.
- **How much there is to search** sits under the right edge of the bar: Y Combinator's square next to the number of companies indexed (`components/ui/YCMark.tsx`). The mark is drawn rather than fetched, because at 13 px a bitmap of it is soft. The line is absolutely positioned, since the bar's own box is what the match container is anchored above and anything adding to its height would push the grid.
- **A search copies itself.** Every answer goes onto the clipboard, tab separated so it drops straight into a spreadsheet: match, name, what they do, batch, where, the company's own site and its YC page. The browser only allows a clipboard write while a keypress is still recent and a search takes a second or two, so when it is refused the list waits under a "Copy the list" button instead of being lost.
- **Motion switch** (top left, `components/ui/LiquidToggle.tsx`). A liquid toggle with no dependencies: the thumb on one spring, a smaller drop on a second spring that chases it, and an SVG goo filter (blur, then an alpha threshold) that melts them into one shape. It can be pressed or dragged. Off closes the sensor feed and restores ordinary gravity; the choice is kept in `localStorage`.
- **Probability labels.** Each match carries its probability in a small pill above it. The pills are plain DOM moved from the frame loop (no React state) and fade in on arrival and out over 420 ms.
- **Enter searches.** Only Enter or the orb runs a search. Typing lets the matches fall back into the pile and the labels fade out.
- **Tilt and shake the MacBook** (`native/motion.swift`, `lib/motion.ts`, `components/floor/tilt.ts`). Apple Silicon MacBooks have an accelerometer and gyro behind the sensor processing unit. No public API or browser event exposes them, but they are HID devices (vendor page 0xFF00, usage 3 and 9; the lid angle is page 0x20, usage 138). The Swift helper wakes the driver, reads about 1,600 reports a second (22 bytes, x/y/z as int32 at bytes 6/10/14, divided by 65,536), and streams 60 averaged samples a second as server-sent events on `127.0.0.1:3917`, only to pages served from localhost. It usually opens without root; some Macs need sudo. `instrumentation.ts` starts it with the server (build it once: `npm run build:motion`). The page turns it into gravity: the slow part of the signal is where gravity points, jolts are exaggerated 2.5x, the lid angle says how much of "down" lies in the screen plane, and turning the laptop flat on the desk pulls sideways. Sleeping icons are woken when gravity has moved by 0.1 g. Without the helper nothing changes. If left and right are mirrored, set `FLIP_X` in `tilt.ts` to -1.
- **Nothing overlaps, nothing escapes** (`components/floor/bounds.ts`, `forces.ts`). Each 1/60 s step is three substeps with 4 position passes each; a speed cap keeps any icon from covering more than 45% of its size between two collision checks (that is what let hard hits leave icons inside one another); four 400 px walls, the top one closing once the pile has poured in; the pointer cannot drag past the edge; a once-a-second patrol brings back anything that still got out. Check it from the console: `__floor.jolt()` throws the whole pile at full strength, `__floor.overlaps()` must then report `{ deep: 0, outside: 0 }`.
- **One sheet, not a thousand images** (`scripts/build-atlas.mjs`, `lib/atlas.ts`, `components/floor/atlas.ts`). The pile used to fetch one PNG per icon through the `/library/[file]` Node route: at 1,000 icons that is 1,000 requests, and images were still arriving **17 seconds** after the page opened. They are now packed into one 3168x1650 lossless WebP, 2.68 MB for 1,200 logos at 64 px each, served immutable. One request, 83 ms to decode, and it is a quarter the bytes of the PNGs it replaces. Run `npm run atlas` after adding companies to the library.
- **One canvas, not a thousand canvases.** Every pile icon used to get its own offscreen canvas, so a frame meant switching source texture a thousand times, and a thousand full-size images stayed decoded in memory. They now share one atlas canvas with a cell per body, each baked at exactly the device pixels it is drawn at, so a settled icon lands 1:1 on screen with no resampling at all and a frame is a thousand blits out of one texture. Cells have a 2 px transparent gutter, because a rotating icon samples a pixel or two past its own edge. A resize rebuilds the one canvas instead of a thousand. Full-size pictures are loaded only for the handful of matches that are actually enlarged, and are dropped again when a match retires.
- **The physics is paced to the screen, not to 60 Hz.** A 1/60 s step is three 1/180 s substeps, and they used to be fired in a burst: on a 120 Hz display that meant one frame did all three and the next did none, so frame gaps alternated about 6 ms, 10.5 ms, 6 ms, 10.5 ms. The work is under a millisecond either way, but the *pacing* is what the eye reads, and 88% of frames were part of that alternation. Draining one substep at a time gives 1, 1, 2, 1, 1, 2 instead of 3, 0, 3, 0. The simulation sees exactly the same fixed 1/180 s steps; only when they arrive changed. At 500 icons, at rest: p95 went from **23.7 ms to 10.7 ms**, p99 from **35.2 ms to 11.3 ms**, and frames over 12 ms from **30 in 2.5 s to 1**.
- **Typing was costing 60 late frames in three seconds**, and none of it was physics. Every keystroke re-renders the page, and the floor re-rendered with it: 180 probability labels reconciled, and because their `ref` was an inline arrow, 180 refs dropped and re-taken, thirteen times a second. The floor and the settings panel are memoised and every prop they take is stable, and the label refs are made once. Typing 58 characters now moves the reading not at all: 120 fps, p95 9.2 ms, the same one late frame it had sitting still.
- **Handing icons back is the expensive half of scrolling**, not moving them. A retiring match is rescaled, dropped into the pile, has its cell of the atlas redrawn, and wakes every neighbour so the pile makes room. Doing that while the wheel was still turning kept the pile permanently churning: physics went from 0.30 ms a substep to 1.36, and a hard scroll cost 87 late frames at p95 25 ms. None of it is urgent, because 500 icons in the pile is far more than the eighty-odd cells in view need, so it now waits for the scroll to go quiet (140 ms) unless the spare icons genuinely run low. That check is itself a scan of the pile, so it runs a few times a second rather than every frame. Hard scrolling is now **120 fps, p95 9.2 ms, 1 late**, and the cells that waited fill within a moment of stopping (`__floor.holes()` back to 0).
- **Smooth is a percentile, not an average.** 120 fps with one 40 ms frame a second reads as a stutter and the mean hides it completely, which is why every measurement here is p50/p95/late rather than fps. The settings panel shows the live reading (`Frames > Pacing`), taken inside the frame loop and read four times a second, written straight to the DOM because re-rendering a panel every frame to report how smooth the frames are would be its own joke. `__floor.paced()` gives the same numbers in the console.
- **Frame budget.** Plain 4-corner bodies, waking only the neighbours of a rising icon, a typing tremor limited to 28 bodies, `setTransform` drawing, and the enlarged copies of matches rendered three a frame rather than all at once. That last one took search-landing from 11 late frames in six seconds to 1. At 500 icons: 120 fps, about 0.3 ms a substep at rest and 1.5 ms with the whole pile in the air, draw 0.35 ms. `window.__floor` shows `stepMs`, `drawMs`, `awake`, `holes`, `paced()`, `gx`, `gy` live.
- **The orb is the search button**: it breathes while idle and spins up while Jev is judging.
- **Results are images only**: no titles, only the probability pill.

## Effects

`voice-glow` (the glow under the input rises with typing, and gathers into a travelling beam while Jev works) and `thinking-orbs` (the orb *is* the search button: breathing when idle, searching while Jev works).

## YC company logos and their written info

The prep pipeline that produced `data/companies.json` lives outside this repo and is not needed to run it. It parsed all 6,241 YC companies (Summer 2005 to Winter 2027) parsed from the YC directory by `parse.py`: `companies.json` and `companies.csv`
(slug, name, tagline, location, batch, season, year, industry, subindustry, url, logo_url, logo_file) plus `logos/<slug>.png` for the 5,616 that have a logo
(`download.py`, safe to re-run; one logo, `brainhi`, returns 403 at the source). The 624 companies without a logo get a lettered tile
(`placeholders.py` writes `placeholders/<slug>.png`), so every company is searchable. In the app all 6,241 are `public/icons/yc_<slug>.png`, and
`data/companies.json` (read by `lib/meta.ts`) gives each one its company details. Lettered tiles are marked `placeholder` and never shown in the resting pile.

## Reading what is written

Meaning vectors come from **bge-small-en-v1.5** (`lib/text/embed.ts`, 384 wide, run locally through transformers.js;
`node scripts/build-meaning.mjs` rebuilds `data/meta_vectors_v3.f32` in about two minutes). MobileCLIP's text tower used to
do this job and it was the wrong tool: it exists to match captions to pictures, not prose to prose, and it reads at most
77 tokens, which is why the indexed text had to be cut to 320 characters.

Measured by ranking the right company out of 6,241 across 36 real requests:

| | Median rank | Top-1 | Top-10 | Top-60 |
| --- | --- | --- | --- | --- |
| **bge-small-en-v1.5** | **1** | **47%** | **75%** | **92%** |
| MobileCLIP text tower | 12 | 28% | 47% | 69% |
| Full text in 2.8 overlapping CLIP windows | 21 | 14% | 47% | 61% |
| Apple `NLEmbedding.sentenceEmbedding` | 658 | 3% | 8% | 17% |
| Apple `NLContextualEmbedding`, mean-pooled | 1120 | 6% | 8% | 17% |

Three of those were tried before paying for a download and all three lost, so none is worth revisiting. Reading the full
description in windows is worse than the short version because the short version leads with name, tagline and tags, which is
the densest signal, and the marketing prose that follows only dilutes it. With bge there is no 77-token cap, so the whole
description is indexed now.

Jev reads 420 characters of each description rather than 170. Context.dev's most useful line starts at character 180, so Jev
had never once seen it. Honestly measured: unchanged on the benchmark, about 15% more tokens, and right on principle.

## What a company actually does

YC's tags are what a founder typed into a form once. `node scripts/tag-companies.mjs` asks Jev what each company really
does, in that same vocabulary, judging from the write-up and from what Jev already knows about it. 6,241 companies, about
five minutes and **$0.80**, written to `data/jev_tags.json` and merged everywhere the tags are used: the tag channel, the
word index and the indexed meaning text.

**5,986 of 6,241 companies, 96%, gained a word YC never gave them.** Context.dev comes back `Web Development 0.73` and
`Data Engineering 0.46` rather than only `APIs`, so a search for web scraping can reach it although the word "scrape"
appears nowhere in anything it has written. Stripe comes back `Payments 0.96`, which YC never said. Unbabel gets tags at
all, where YC gave it none.

Measured on 41 requests, by asking whether the tag channel can reach the right company at all:

| | Right company reachable by tag |
| --- | --- |
| YC's tags | 28 of 41 |
| **with Jev's added** | **39 of 41** |

The end-to-end benchmark below does not move, and that is the honest picture: it is made of well-known companies with
plain descriptions, which the other channels already found. What this buys is a second, independent route to the answer
for everything in the long tail, which is where the misses actually live.

A tag or category small enough to read in full (80 companies or fewer, which is 254 of the 337 tags) is now read in full
whatever Jev's confidence, since reading a small one entirely costs almost nothing.

## Naming the thing

The hardest searches are the ones where the person does not know the word. "My client wants the program in Chinese so his
employees can use it, whatever it's called" is asking for software localisation, and it shares not one word with Quetzal's
"translation and internationalization for software". It used to return HR tools, and not because Jev judged badly: Quetzal was
nominated by no channel at all, so Jev never saw it. **Jev can only judge what it is shown**, which is the same failure as
"newest startup" in another costume.

So Jev is asked what the thing is called, out of YC's own 337 tags (`lib/search/tags.ts`), in the same call as everything else.
It answers `International` at probability 1.0, a tag only six companies carry, and those six become candidates. Quetzal now comes
first at 86% and Lingo.dev second at 83%. The vocabulary goes out as two questions because one `choice` takes at most 255 options,
and nothing in it is invented here: it is the words YC files these companies under, so the app stays as open as the data is.

**A second look, when the first finds nothing convincing.** If the best answer after judging is under 0.65, the words the best few
answers are filed under become the next place to search, and Jev reads whatever that brings back. Where to look next is decided by
what the first pass turned up, not by anything written down here. "An elephant riding a bicycle" follows Developer Tools and
Machine Learning and comes back with Pachyderm (the word means elephant), PeerDB (an elephant in its tagline) and Bicycle AI.
Only weak searches pay for it; a confident one never makes the second call.

So a search is: ask several questions at once and get probabilities back, use them to decide where to look, judge what comes back,
and go deeper only if the answer is not good enough yet.

## Two kinds of question

The app answers two different questions, and Jev decides which one you asked (`lib/jev/understand.ts`, one call that also
gives the category, so it costs no extra wait).

- **"Which one did I mean?"** ranks a shortlist. That is the pipeline below, and it is what a half-remembered description needs.
- **"Give me all of them."** filters instead (`lib/search/filter.ts`). A similarity score has no zero point, so 0.256 means
  nothing on its own and ranking is the only thing a shortlist can do. The way round it is to give every image its own small
  multiple-choice quiz: your words against 28 fixed generic descriptions (`lib/search/backdrop.ts`). DoorDash scores 100% on
  "red or orange", Instacart 85% (it is also green), Stripe 0% (the quiz says blue). Now the number means the same for every
  query, so one threshold works everywhere, and the answer can be 5 images or 500. The backdrop never changes, so its scores
  are worked out once at startup and a search only adds one pass over numbers it already has.
  - Framing words matter more than you would think: "companies with all shades of red/orange type logos" found 51 images and
    "a logo that is red or orange" found 477, both about 97% right. So the scaffolding is stripped and the request is asked
    three ways, and each image keeps its best result.
  - A rare word is a name, not a description. "corgi" belongs to two companies, so "all corgi startups" is those two and every
    dog-shaped logo is a coincidence. "blue" belongs to dozens, so it describes the picture.
  - For what a company does, the category Jev named is the set: "all payments companies" is everyone in Fintech > Payments,
    read by Jev in parallel batches rather than cut to a shortlist.

Measured on the library: "red or orange" returns 480 images, 96% of them genuinely red or orange; "blue" returns 600 (the cap),
99% right. What it cannot do: count, and read (see below).

## When a company is from

A YC batch is a season and a year, and that is a hard fact about every company here, so "the newest batch", "winter 2019"
and "the oldest startups" are all answerable. Jev is told today's date and the ten most recent batches with their sizes
(`lib/search/time.ts`), and every candidate carries its batch, in the short form as well as the long one. Knowing the dates is
only half of it though: "newest startup" shares no words and no meaning with the newest company, so nothing would ever put it
forward and Jev would never get to choose it. When Jev says the timing matters, the two ends of the timeline (the 60 newest and
the 60 oldest) become candidates in their own right. It has to be sure about that, because every company has a date and almost
no request is about one: at a lower bar "self driving cars" pulled in the timeline too and cost 60% more for nothing. The batch list
runs into the future on purpose: YC announces batches ahead of time and companies are already in them, so the newest batch
is the one furthest ahead whether or not it has started.

Naming a year also settles what kind of request it is. "companies from winter 2019" read as a wintry picture and came back
with 564 white logos, because a year is written down and never seen; a query naming one is never treated as a look.

Measured: "companies from winter 2019" returns 30 companies, all of them Winter 2019, at 93%. "startups from the summer 2027
batch" finds the single company in it, at 93%. "the oldest yc startups" leads with Reddit (Summer 2005), Disqus and Loopt. "newest startup" answers Memorable (Summer 2027), then Rote (Winter 2027).

## What the logos say

MobileCLIP cannot read. Asked for "a logo with letters in it" it found 2% of the 624 tiles that are nothing but letters, so
text needs its own sense. `scripts/read-letters.mjs` runs Apple's Vision over every image once, locally and free, about 110 ms
each and 12 minutes for the library, and writes `data/letters.json` (read by `lib/letters.ts`). Of the 6,287 images read at the time, 1,348 say
something: `wepay a CHASE O company`, `Corgi Labs`, `FAIRE`.

The words go into the word index, so a company is findable by what its own logo says, and they answer text questions exactly:
"logos that say pay" gives WePay, LotusPay, Touch and Pay, Payflow and PAYZE, and nothing else. "logos with no text in them"
gives only wordless marks.

Only Vision's careful pass is used. Its quick one reads the odd stylised single letter that the careful one skips, but it also
reads a "7" out of the DoorDash mark and an "&J" out of Airbnb's, and inventing writing is worse than missing it. So a logo
that is one stylised glyph is usually counted as having no text.

**Search over looks and written info** (`lib/search/rank.ts` is the pipeline, `app/api/search/route.ts` only caches and retries):

1. A description that is just a company's name ("stripe", "doordash logo") picks that logo outright.
2. MobileCLIP scores the looks of every image (softmax share of the match).
3. Jev sorts the description into the 58 "Industry > Subindustry" categories in ONE `choice` question (`lib/jev/understand.ts`, about 900 tokens).
   Two extra options: "only about looks" (0.6 and up skips the written info) and "some other kind of product". Without the second one
   "image generation" was filed under looks because of the word "image", and MobileCLIP then floated the logo that reads "Mage".
   This step always runs: a one-word description ("payments app") is "covered" by any company with that word in its name.
4. **When Jev is sure which corner of the library a request is about, the whole corner is read.** Whitespace sat in exactly
   the right category, carried exactly the right tag, and its own YC description says "inventory planning", yet a search for
   software that works out reordering points never showed it to Jev at all: only the best 48 of that category's 139 companies
   were read, and it sat outside. Being skipped before anyone reads your words is not the same as being judged and rejected.
   Above 0.55 confidence a category or tag is now read in full, up to 200 from any one of them and 320 finalists in total, and
   the judging goes out as several calls side by side rather than one enormous one. Whitespace now comes back 6th at 70%.
   Cost about 40,000 tokens a search instead of 24,000; latency unchanged, because the calls run at the same time.
5. Six channels nominate finalists, one of which looks **inside** company names. A name is a single word to the index, so
   "crawl" never reached Firecrawl and "pay" never reached LotusPay. Any word of four letters or more that appears inside a
   name now counts, which costs one pass over 6,241 short strings. "crawl the internet" used to return nothing relevant at
   all; Firecrawl is now first.
6. Five channels nominate finalists (the fifth: large companies whose info matches, 6): looks (10), shared words (12, IDF-weighted, names count triple), similar meaning (12, each company's info
   embedded once with the MobileCLIP text encoder, stored in `data/meta_vectors.f32`), and Jev's categories (up to 60, so a small category is read in full).
   A description that is only about looks keeps the looks finalists alone.
5. Jev reads every finalist's written info and measured colors in ONE TypeSafe call (`lib/jev/judge.ts`: the description is the state, each finalist
   one yes/no question, several may fit). It is skipped for a look-only description that names no color.
   On the looks-only path there is one more source: a company whose NAME holds one of the person's words ("all corgi startups" reads as a
   picture of a dog, and only the logo with a dog in it came back, not Corgi Insurance). Jev is asked about those in a small separate call,
   and an answer of 0.6 or more joins the looks results without changing them. It costs look-only searches about 350 ms.
5b. **The badge is the ranking.** What a hit shows is how likely it is the one you mean: how well Jev says it fits, times how
   likely you meant it at all (YC's top companies get 2.2x the odds, large ones less). The list is sorted by exactly that number.
   It used to be sorted by a separate fused score in which being well known counted for five times as much, so "ai company brains"
   put Scale AI first at 75% while the company whose tagline is literally "Your Company Brain" sat eighth at 89%. Being well known
   now only settles a tie.
5c. **Jev's answer is not thrown away for a description of what a company does.** There used to be one guard for all searches:
   if Jev's best answer did not stand clear of its typical one, the whole verdict was dropped and the image model decided. That
   guard belongs only to descriptions of how something looks, where Jev is reading text about a picture it cannot see. Everywhere
   else the fallback is worse than the thing it replaces, and the test punished exactly the searches that went well: the better the
   shortlist, the more alike its answers, the narrower the spread. "I need to handle my payments, but Stripe is really expensive,
   something cheaper" retrieved 130 payments companies and ranked them properly, then dropped the lot and answered Strive Math, a
   coding school whose logo reads like the word Stripe. It now answers Paystack, Razorpay, GoCardless and Malga, and puts Stripe
   itself 105th at 21%, because Jev understood the person wants an alternative. Nothing about that is written down here.
7. Fusion: `max(looks^0.35, 0.25) x Jev odds relative to the median finalist`. Jev only counts when it has an opinion
   (best answer 0.3 above its median, or 0.8 and up); a look-only description leaves it in a noisy 0.2 to 0.5 band.
7. **Something always comes up.** The point of asking Jev is to get a probability for the closest thing it can find, and a low
   probability is still an answer: the nine best guesses float even when none of them really fit. When the image model is not sure
   of anything either (nothing looks like "an elephant riding a bicycle"), the written channels join in and Jev is asked which
   startup such a thing could possibly be. It answers PeerDB, whose tagline carries an elephant, and Pachyderm, which means one.
8. Every hit carries a `probability`, a tagline and a detail line, and `matches` says how many float up: everything Jev puts at 0.3 or more, at most 120.

A search is two Jev calls one after the other: 620 to 700 ms and about $0.0002. The first search after a restart takes about 1.9 s.

The library is now the 6,241 YC companies and nothing else: the 46 app icons it started with were moved to `removed-icons/`.
That also removes the targets of the look-only benchmark below (set A), so those two rows are history, not a current measurement.

Measured with `scripts/eval_search.py` (`--looks-only` = MobileCLIP alone, `--misses` lists the misses):

| Descriptions | MobileCLIP alone | Full pipeline |
| --- | --- | --- |
| Looks, with color words (33), before the icons were removed | 67% top-1 | 64% top-1, 30/33 in top 5 |
| Looks, no color words (33), same | 48% top-1 | 48% top-1 |
| What the company does (28) | 0% top-1 | 100% top-1, 28/28 in top 5 |
| Looks + info mixed (6) | 0% top-1 | 67% top-1, 6/6 in top 5 |

The look-only numbers are lower than with 44 images because 6,000 logos are real competition ("a letter g" has dozens of fair answers), not because of Jev.
**What a candidate costs.** Each one is a line Jev reads, and about three quarters of it is the company's write-up.
Cutting the write-up out entirely saves 34% of the tokens and scores exactly the same on the 34-query benchmark, so it
looks like free money. It is not: on the long-tail requests the benchmark cannot see, the write-up is what decides.
Whitespace lands 11th with it and 22nd without. It is kept, and `JEV_DETAIL` re-runs that measurement. Colours are now
only sent when the request mentions one, which was pure waste otherwise.

**Well-known companies.** The prep step merges YC's open data (`yc_oss_all.json`, 10.5 MB from `yc-oss.github.io/api/companies/all.json`):
long description, tags, team size, status and the top-company flag, and it added the one company the directory pages never listed (Y Combinator itself).
Words and meaning-vectors (`data/meta_vectors_v2.f32`) now include tags and the start of the description. Two things make famous companies show up:

- Jev reads all 91 top companies on every search, from short lines, in a second call that runs alongside the main one. No shortlist found them
  reliably: Stripe's text barely says "payments", Airbnb's never says "rent a room", but Jev knows them by name.
- A company that fits (Jev 0.5 and up) is lifted 5x if it is a top company, and up to 1.5x by team size. A company that does not fit gets no lift.

Cost is now about 16,000 tokens = $0.0007 per search (two parallel judge calls plus the category call), 650 to 750 ms.
The benchmark's info targets are all famous companies, so its 100% partly reflects that lift.

**Scale.** Indexing runs at about 9 ms per image. The pile shows a sample of 600 (your own images first, then random real logos); a match outside
the sample takes over a buried slot, so it still rises out of the pile. `/api/library?since=` only returns what arrived after the page loaded.
Images with a see-through background are put on white before embedding and on a light tile in the pile.
