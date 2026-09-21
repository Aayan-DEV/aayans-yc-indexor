"""Build data/index.json with pixel math only: a color text and a shape text per icon. About 5 ms per icon, no model, no GPU.

Needs numpy + Pillow:  ../../experiments/jev_vague_match/.venv/bin/python build_index.py
(The older CLIP-based indexer is kept as build_index_clip.py.)
"""
import json
import pathlib
import time

from describe import NOTE, color_text, shape_text
from features import extract

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    titles = json.loads((pathlib.Path(__file__).parent / "titles.json").read_text())
    t0 = time.perf_counter()
    index = []
    for path in sorted((ROOT / "public" / "icons").glob("*.webp")):
        icon_id, slug = path.stem.split("_", 1)
        f = extract(path)
        colors, top = color_text(path, f)
        shape = shape_text(f)
        index.append({"id": icon_id, "slug": slug, "title": titles.get(icon_id, slug), "src": f"/icons/{path.name}", "colors": top,
                      "background": f["background"], "colorText": colors, "shapeText": shape, "description": f"{colors} {shape}"})
    (ROOT / "data" / "index.json").write_text(json.dumps({"note": NOTE, "icons": index}, indent=1, ensure_ascii=False))
    print(f"indexed {len(index)} icons in {(time.perf_counter() - t0) * 1000:.0f} ms, pixel math only")
    print(index[0]["colorText"], "\n", index[0]["shapeText"])


if __name__ == "__main__":
    main()
