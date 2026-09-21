"""Build data/index.json: one text description per icon, made by free local tools (pixel colors, CLIP concepts, Apple OCR).

Run with the Python env that has torch + transformers:
  ../experiments/jev_vague_match/.venv/bin/python indexer/build_index.py
"""
import colorsys
import json
import pathlib
import subprocess
import tempfile
from collections import Counter

import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

from vocab import OBJECTS, STYLES

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS = ROOT / "public" / "icons"
SWIFT_OCR = ROOT.parent / "experiments" / "jev_vague_match" / "apple_vision.swift"
MODEL = "openai/clip-vit-base-patch32"
STRONG, MAYBE = 0.030, 0.015  # how far above the generic "an app icon" baseline a concept must score


def hue_name(rgb):
    h, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    if v < 0.22:
        return "black"
    deg = h * 360
    if s < 0.16:
        if v > 0.75 and s >= 0.05 and 15 <= deg <= 70:
            return "beige or cream"
        return "white" if v > 0.82 else "gray"
    for limit, name in ((15, "red"), (42, "orange"), (68, "yellow"), (165, "green"), (200, "teal"), (248, "blue"), (300, "purple"), (345, "pink")):
        if deg < limit:
            return "brown" if name == "orange" and v < 0.6 else name
    return "red"


def colors(img):
    small = img.convert("RGB").resize((48, 48))
    px = list(small.get_flattened_data()) if hasattr(small, 'get_flattened_data') else list(small.getdata())
    counts = Counter(hue_name(p) for p in px)
    main = [f"{name} ({round(n / len(px) * 100)}%)" for name, n in counts.most_common(4) if n / len(px) >= 0.07]
    border = [px[y * 48 + x] for y in range(48) for x in range(48) if x in (3, 44) or y in (3, 44)]
    return main, Counter(hue_name(p) for p in border).most_common(1)[0][0]


def clip_concepts(model, proc, images):
    texts = ["an app icon"] + [f"an app icon showing {o}" for o in OBJECTS] + [f"an app icon with {s}" for s in STYLES]
    with torch.no_grad():
        out = model(**proc(text=texts, images=images, return_tensors="pt", padding=True))
    sim = out.logits_per_image / model.logit_scale.exp()
    lift = sim[:, 1:] - sim[:, :1]
    results = []
    for row in lift:
        obj = sorted(zip(OBJECTS, row[:len(OBJECTS)].tolist()), key=lambda kv: -kv[1])
        sty = sorted(zip(STYLES, row[len(OBJECTS):].tolist()), key=lambda kv: -kv[1])
        clearly = [o for o, d in obj if d >= STRONG][:6]
        # Small flat icons rarely clear the strict bar, so the best few guesses are always kept, in order.
        guesses = [o for o, d in obj if o not in clearly and d > 0][: max(3, 7 - len(clearly))]
        results.append({"clearly": clearly, "maybe": guesses, "style": [s for s, d in sty[:3] if d > 0]})
    return results


OCR_CACHE = pathlib.Path(__file__).parent / "ocr_cache.json"


def ocr(files):
    """Apple Vision reads text inside each icon. It needs PNG input, so convert to a temp folder first. Results are cached."""
    cached = json.loads(OCR_CACHE.read_text()) if OCR_CACHE.exists() else {}
    files = [f for f in files if f.stem not in cached]
    if not files:
        return cached
    with tempfile.TemporaryDirectory() as tmp:
        pngs = []
        for f in files:
            out = pathlib.Path(tmp) / (f.stem + ".png")
            Image.open(f).convert("RGB").save(out)
            pngs.append(str(out))
        run = subprocess.run(["swift", str(SWIFT_OCR), *pngs], capture_output=True, text=True, timeout=900)
    found = {}
    for line in run.stdout.splitlines():
        if line.startswith("{"):
            d = json.loads(line)
            found[pathlib.Path(d["image"]).stem] = {"text": d["text"], "tags": []}
    cached.update(found)
    OCR_CACHE.write_text(json.dumps(cached, indent=1))
    return cached


def main():
    titles = json.loads((pathlib.Path(__file__).parent / "titles.json").read_text())
    files = sorted(ICONS.glob("*.webp"))
    images = [Image.open(f).convert("RGB") for f in files]
    model, proc = CLIPModel.from_pretrained(MODEL).eval(), CLIPProcessor.from_pretrained(MODEL)
    concepts = clip_concepts(model, proc, images)
    read = ocr(files)
    index = []
    for f, img, c in zip(files, images, concepts):
        icon_id, slug = f.stem.split("_", 1)
        main_colors, background = colors(img)
        o = read.get(f.stem, {"text": [], "tags": []})
        lines = [f"App name: {titles.get(icon_id, slug)}.",
                 f"Main colors: {', '.join(main_colors)}. Background or edge color: {background}.",
                 f"A vision model says the icon clearly shows: {', '.join(c['clearly']) or 'nothing it is sure about'}.",
                 f"Its next best guesses, most likely first: {', '.join(c['maybe']) or 'none'}.",
                 f"Visual style: {', '.join(c['style']) or 'unclear'}.",
                 f"Text an OCR tool read inside the icon (often wrong on logos): {'; '.join(o['text']) or 'none'}."]
        index.append({"id": icon_id, "slug": slug, "title": titles.get(icon_id, slug), "src": f"/icons/{f.name}",
                      "colors": main_colors, "background": background, "concepts": c, "text": o["text"], "description": "\n".join(lines)})
    (ROOT / "data" / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False))
    print(f"indexed {len(index)} icons")
    for e in index[:4]:
        print("\n" + e["description"])


if __name__ == "__main__":
    main()
