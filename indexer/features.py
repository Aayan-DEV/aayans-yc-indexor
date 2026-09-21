"""Pixel-math features for one icon. No neural network, no OCR, no human input. numpy + PIL only."""
import colorsys
from collections import Counter, deque

import numpy as np
from PIL import Image

COLORS = ["black", "white", "gray", "beige", "red", "orange", "brown", "yellow", "green", "teal", "blue", "purple", "pink"]
N = 64


def hue_name(rgb):
    h, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    deg = h * 360
    if v < 0.22:
        return "black"
    if s < 0.16:
        if v > 0.75 and s >= 0.05 and 15 <= deg <= 70:
            return "beige"
        return "white" if v > 0.82 else "gray"
    for limit, name in ((15, "red"), (42, "orange"), (68, "yellow"), (165, "green"), (200, "teal"), (248, "blue"), (300, "purple"), (345, "pink")):
        if deg < limit:
            return "brown" if name == "orange" and v < 0.6 else name
    return "red"


def _components(mask):
    """4-connected components of a boolean grid. Returns a list of pixel lists, largest first."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not seen[y, x]:
                q, cells = deque([(y, x)]), []
                seen[y, x] = True
                while q:
                    cy, cx = q.popleft()
                    cells.append((cy, cx))
                    for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
                out.append(cells)
    return sorted(out, key=len, reverse=True)


def extract(path):
    img = Image.open(path).convert("RGB")
    px = np.asarray(img.resize((N, N), Image.LANCZOS)).astype(float)
    names = np.array([[hue_name(tuple(p)) for p in row] for row in px])
    total = N * N
    palette = {c: float((names == c).sum()) / total for c in COLORS}

    ring = np.ones((N, N), bool)
    ring[4:-4, 4:-4] = False
    background = Counter(names[ring]).most_common(1)[0][0]
    bg_rgb = np.median(px[ring & (names == background)], axis=0)
    fg = np.sqrt(((px - bg_rgb) ** 2).sum(axis=2)) > 70  # foreground = clearly different from the background color
    fg_share = float(fg.mean())

    blobs = [c for c in _components(fg) if len(c) >= total * 0.006]
    holes = 0
    if fg.any():
        for comp in _components(~fg):
            ys, xs = zip(*comp)
            if min(ys) > 0 and min(xs) > 0 and max(ys) < N - 1 and max(xs) < N - 1 and len(comp) >= total * 0.004:
                holes += 1  # a background pocket fully enclosed by foreground, like the inside of an O or an 8

    shape = {}
    if fg.any():
        ys, xs = np.nonzero(fg)
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        cov = np.cov(np.vstack([xs, ys]))
        evals, evecs = np.linalg.eigh(cov)
        major = evecs[:, 1]
        angle = abs(np.degrees(np.arctan2(major[1], major[0]))) % 180
        lr = float((fg & fg[:, ::-1]).sum() / max(1, (fg | fg[:, ::-1]).sum()))
        ud = float((fg & fg[::-1, :]).sum() / max(1, (fg | fg[::-1, :]).sum()))
        shape = {"bbox_w": bw / N, "bbox_h": bh / N, "cx": xs.mean() / N, "cy": ys.mean() / N, "fill": float(fg[y0:y1 + 1, x0:x1 + 1].mean()),
                 "elongation": float(np.sqrt(evals[1] / max(evals[0], 1e-6))), "angle": float(angle), "sym_lr": lr, "sym_ud": ud}
    fg_colors = Counter(names[fg]).most_common(3) if fg.any() else []

    gray = px.mean(axis=2)
    gx, gy = np.abs(np.diff(gray, axis=1))[:-1, :], np.abs(np.diff(gray, axis=0))[:, :-1]
    mag = np.hypot(gx, gy)
    strong = mag > 40
    edge_density = float(strong.mean())
    axis_aligned = float(((np.minimum(gx, gy) < 0.2 * np.maximum(gx, gy)) & strong).sum() / max(1, strong.sum()))
    horiz_share = float(((gy > gx) & strong).sum() / max(1, strong.sum()))  # edges that run left-right
    hist = np.histogram(gray, bins=24, range=(0, 255))[0] / total
    smooth_shading = float((hist > 0.01).sum()) / 24  # many brightness levels in use = shading or gradients, few = flat fills

    layout = [[Counter(names[r * N // 3:(r + 1) * N // 3, c * N // 3:(c + 1) * N // 3].ravel()).most_common(1)[0][0] for c in range(3)] for r in range(3)]
    return {"palette": palette, "background": background, "fg_share": fg_share, "fg_colors": [(c, n / max(1, fg.sum())) for c, n in fg_colors],
            "blobs": len(blobs), "blob_sizes": [len(b) / total for b in blobs[:4]], "holes": holes, "shape": shape, "edge_density": edge_density,
            "axis_aligned": axis_aligned, "horiz_share": horiz_share, "smooth_shading": smooth_shading, "layout": layout,
            "brightness": float(gray.mean() / 255), "names": names, "fg": fg}
