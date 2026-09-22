"""Companies with no logo on YC get a plain lettered tile, so every company has an image and can be found in the app."""
import hashlib, json, os
from PIL import Image, ImageDraw, ImageFont

PALETTE = ["#3e63dd", "#8e4ec6", "#d6409f", "#e5484d", "#f76b15", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#ad7f58", "#46a758", "#e93d82"]
FONT = ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", 64, index=1)  # bold face
os.makedirs("placeholders", exist_ok=True)
made = 0
for c in json.load(open("companies.json")):
    if c["logo_file"]:
        continue
    words = [w for w in "".join(ch if ch.isalnum() else " " for ch in c["name"]).split() if w]
    initials = (words[0][0] + (words[1][0] if len(words) > 1 else "")).upper() if words else "?"
    color = PALETTE[int(hashlib.sha1(c["slug"].encode()).hexdigest(), 16) % len(PALETTE)]
    img = Image.new("RGB", (150, 150), color)
    draw = ImageDraw.Draw(img)
    box = draw.textbbox((0, 0), initials, font=FONT)
    draw.text(((150 - (box[2] - box[0])) / 2 - box[0], (150 - (box[3] - box[1])) / 2 - box[1]), initials, font=FONT, fill="white")
    img.save(f"placeholders/{c['slug']}.png")
    made += 1
print(made, "lettered tiles written")
