"""Parse YC directory HTML (pasted from ycombinator.com/companies) into companies.json / companies.csv, merging with what is already there."""
import csv, html, json, os, re, sys

CARD = re.compile(r'<a class="!py-4 _company_18olp_357" href="/companies/([^"]+)">(.*?)</a></div></div></div></div></a>', re.S)

def parse(src: str) -> list[dict]:
    out = []
    for slug, body in CARD.findall(src):
        body += "</a>"
        u = lambda m: html.unescape(m.group(1)).strip() if m else ""
        logo = re.search(r'<img[^>]*src="([^"]+)"', body)
        batch = u(re.search(r'href="/companies\?batch=([^"]+)"', body))
        inds = [html.unescape(i) for i in re.findall(r'href="/companies\?industry=([^"]+)"', body)]
        out.append({
            "slug": slug,
            "name": u(re.search(r'_coName_18olp_472">(.*?)</span>', body, re.S)),
            "tagline": re.sub(r"\s+", " ", u(re.search(r'<div class="mb-1.5 text-sm"><span>(.*?)</span></div>', body, re.S))),
            "location": u(re.search(r'_coLocation_18olp_488">(.*?)</span>', body, re.S)),
            "batch": batch, "season": batch.split(" ")[0] if batch else "", "year": int(batch.split(" ")[1]) if batch else None,
            "industry": inds[0] if inds else "", "subindustry": inds[1] if len(inds) > 1 else "",
            "url": f"https://www.ycombinator.com/companies/{slug}", "logo_url": logo.group(1) if logo else None,
        })
    return out

if __name__ == "__main__":
    known = {c["slug"]: c for c in json.load(open("companies.json"))} if os.path.exists("companies.json") else {}
    for path in sys.argv[1:]:
        found = parse(open(path).read())
        fresh = [c for c in found if c["slug"] not in known]
        print(f"{path}: {len(found)} companies, {len(fresh)} new")
        for c in found:
            known[c["slug"]] = {**known.get(c["slug"], {}), **c}
    cos = list(known.values())
    for c in cos:
        f = f"logos/{c['slug']}.png"
        c["logo_file"] = f if os.path.exists(f) and os.path.getsize(f) > 0 else None
    json.dump(cos, open("companies.json", "w"), indent=1, ensure_ascii=False)
    with open("companies.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(cos[0].keys())); w.writeheader(); w.writerows(cos)
    print(len(cos), "companies in total,", sum(1 for c in cos if c["logo_url"]), "have a logo url,", sum(1 for c in cos if c["logo_file"]), "downloaded")
