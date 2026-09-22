"""Merge YC's open data (yc_oss_all.json, from https://yc-oss.github.io/api/companies/all.json) into companies.json:
long description, tags, team size, the top-company flag, status, stage, website. Adds any company the directory pages
never listed (Y Combinator itself, batch "Unspecified"). Then writes the app's copy, ../../data/companies.json.
Safe to re-run. Run download.py and placeholders.py afterwards if a company was added."""
import csv, json, os, re

oss = {c["slug"]: c for c in json.load(open("yc_oss_all.json"))}
cos = json.load(open("companies.json"))
have = {c["slug"] for c in cos}

for slug, o in oss.items():
    if slug in have: continue
    m = re.match(r"(Winter|Summer|Spring|Fall) (\d{4})", o.get("batch") or "")
    logo = o.get("small_logo_thumb_url") or ""
    cos.append({"slug": slug, "name": o["name"], "tagline": o.get("one_liner") or "", "location": o.get("all_locations") or "", "batch": o.get("batch") or "",
                "season": m.group(1) if m else "", "year": int(m.group(2)) if m else None, "industry": o.get("industry") or "", "subindustry": (o.get("subindustry") or "").split(" -> ")[-1],
                "url": o.get("url") or f"https://www.ycombinator.com/companies/{slug}", "logo_url": "" if "missing" in logo else logo, "logo_file": ""})
    print("added:", slug)

clean = lambda t: re.sub(r"\s+", " ", t or "").strip()
for c in cos:
    o = oss.get(c["slug"])
    if not o: continue
    c.update(description=clean(o.get("long_description")), tags=o.get("tags") or [], team_size=o.get("team_size") or 0, top_company=bool(o.get("top_company")),
             status=o.get("status") or "", stage=o.get("stage") or "", website=o.get("website") or "")
    if os.path.exists(f"logos/{c['slug']}.png"): c["logo_file"] = f"logos/{c['slug']}.png"

json.dump(cos, open("companies.json", "w"), indent=1, ensure_ascii=False)
fields = list(cos[0].keys()) + [k for k in ("description", "tags", "team_size", "top_company", "status", "stage", "website") if k not in cos[0]]
with open("companies.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(dict.fromkeys(fields)), extrasaction="ignore"); w.writeheader()
    for c in cos: w.writerow({**c, "tags": "; ".join(c.get("tags", []))})

app = {}
for c in cos:
    m = {k: c.get(k) for k in ("name", "tagline", "location", "batch", "year", "industry", "subindustry", "url")}
    m.update(description=(c.get("description") or "")[:700], tags=c.get("tags", []), teamSize=c.get("team_size", 0), top=c.get("top_company", False), status=c.get("status", ""), website=c.get("website") or "")
    if not c.get("logo_file"): m["placeholder"] = True
    app[f"yc_{c['slug']}"] = m
json.dump(app, open("../../data/companies.json", "w"), ensure_ascii=False)
print(len(cos), "companies |", sum(1 for c in cos if c.get("description")), "with a long description |", sum(1 for c in cos if c.get("top_company")), "top companies")
