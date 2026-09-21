"""Pixel math -> the two texts Jev judges: human-style color words, and shape facts. No neural network anywhere."""
import colorsys
from collections import Counter

import numpy as np
from PIL import Image

NOTE = "Automatic measurements of one app icon, made by simple pixel math. No person or AI described it, and it can miss things."
HUES = [(12, "red"), (38, "orange"), (52, "yellow-orange"), (66, "yellow"), (88, "yellow-green (lime)"), (160, "green"), (178, "green-blue (teal)"),
        (198, "light blue (cyan)"), (236, "blue"), (268, "blue-purple (indigo)"), (295, "purple"), (335, "pink"), (350, "pink-red"), (361, "red")]


def rich_name(rgb):
    h, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    deg = h * 360
    if v < 0.2:
        return "black"
    if s < 0.14:
        if v > 0.75 and s >= 0.045 and 15 <= deg <= 70:
            return "cream or beige"
        return "white" if v > 0.84 else "light gray" if v > 0.6 else "gray" if v > 0.35 else "dark gray"
    base = next(name for limit, name in HUES if deg < limit)
    if base in ("orange", "yellow-orange") and v < 0.55:
        return "brown"
    return ("dark " if v < 0.5 else "pale " if s < 0.38 and v > 0.78 else "") + base


def color_text(path, f):
    px = np.asarray(Image.open(path).convert("RGB").resize((48, 48), Image.LANCZOS))
    total = 48 * 48
    names = Counter(rich_name(tuple(p)) for row in px for p in row)
    main = [(n, c / total) for n, c in names.most_common(6) if c / total >= 0.04]
    ring = [rich_name(tuple(px[y, x])) for y in range(48) for x in range(48) if x in (2, 45) or y in (2, 45)]
    background = Counter(ring).most_common(1)[0][0]
    center = Counter(rich_name(tuple(px[y, x])) for y in range(16, 32) for x in range(16, 32)).most_common(2)
    tone = "dark overall" if f["brightness"] < 0.3 else "light overall" if f["brightness"] > 0.72 else "medium brightness"
    text = (f"Colors by area: {', '.join(f'{n} {round(s * 100)}%' for n, s in main)}. The background (outer edge) is {background}. "
            f"The middle of the icon is mostly {' and '.join(n for n, _ in center)}. The icon is {tone}.")
    return text, [n for n, _ in main[:3]]


def shape_text(f):
    s = f["shape"]
    if not s:
        return "No clear foreground shape stands out from the background."
    pct = lambda x: f"{round(x * 100)}%"  # noqa: E731
    fg = ", ".join(f"{c} {pct(p)}" for c, p in f["fg_colors"] if p >= 0.08)
    parts = [f"On a {f['background']} background there is a foreground covering {pct(f['fg_share'])} of the icon, colored {fg}.",
             f"It is made of {f['blobs']} separate piece{'s' if f['blobs'] != 1 else ''}."]
    w, h = s["bbox_w"], s["bbox_h"]
    span = "fills the whole icon" if w > 0.92 and h > 0.92 else f"spans {pct(w)} of the width and {pct(h)} of the height"
    parts.append(f"The foreground {span}, centered at {pct(s['cx'])} across and {pct(s['cy'])} down.")
    if s["elongation"] > 1.6:
        a = s["angle"]
        parts.append(f"The shape is elongated {'horizontally' if a < 25 or a > 155 else 'vertically' if 65 < a < 115 else 'diagonally'}.")
    else:
        parts.append("The shape is compact, about as wide as it is tall.")
    if f["holes"]:
        parts.append(f"It has {f['holes']} enclosed hole{'s' if f['holes'] != 1 else ''} (background showing through closed loops, like inside the letter O or the digit 8).")
    sym = [n for n, v in (("left-right", s["sym_lr"]), ("top-bottom", s["sym_ud"])) if v > 0.85]
    parts.append(f"It is symmetric {' and '.join(sym)}." if sym else "It is not symmetric.")
    parts.append(f"The shape is {'solid' if s['fill'] > 0.7 else 'open or thin, with a lot of background inside its outline'}.")
    return " ".join(parts)
