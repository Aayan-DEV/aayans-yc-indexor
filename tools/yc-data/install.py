"""Copy the downloaded logos and the lettered stand-ins into the app, as public/icons/yc_<slug>.png.

This is the step that was missing: parse.py and download.py fill logos/, placeholders.py fills placeholders/, and
nothing carried them across. The app reads public/icons and nowhere else, so without this the new companies exist in
companies.json and have no picture.

Nothing is re-downloaded and nothing is converted. The files in public/icons are byte-for-byte the ones in logos/ and
placeholders/, only renamed with a yc_ prefix so one folder can hold both.
"""
import json, os, shutil

ICONS = "../../public/icons"
if not os.path.isdir("logos") and not os.path.isdir("placeholders"):
    raise SystemExit("logos/ and placeholders/ are empty. Run download.py and placeholders.py first; neither is committed,\n"
                     "because they would be 53 MB byte-identical to public/icons, which already has all 6,241.")
os.makedirs(ICONS, exist_ok=True)
copied = skipped = missing = 0

for c in json.load(open("companies.json")):
    slug = c["slug"]
    src = next((p for p in (f"logos/{slug}.png", f"placeholders/{slug}.png") if os.path.exists(p)), None)
    if not src:
        missing += 1
        continue
    dest = f"{ICONS}/yc_{slug}.png"
    if os.path.exists(dest) and os.path.getsize(dest) == os.path.getsize(src):
        skipped += 1
        continue
    shutil.copyfile(src, dest)
    copied += 1

print(f"copied {copied}, already there {skipped}, no image {missing}")
