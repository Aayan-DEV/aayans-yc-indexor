"""Accuracy check for /api/search against the running dev server.
Set A: the 66 look-only benchmark descriptions (33 with color words, 33 without) for the original icons.
Set B: descriptions of what a YC company does, or a mix of looks and info. Target = one logo id.
Usage: python3 eval_search.py [a|b|all]"""
import json, sys, time, urllib.request
sys.path.insert(0, "../../experiments/jev_blind_search")
from queries import QUERIES, QUERIES_NOCOLOR

INFO = {
    "yc_doordash": "app that brings restaurant food to your door", "yc_airbnb": "book a place to stay anywhere in the world",
    "yc_coinbase": "buy and sell crypto", "yc_instacart": "marketplace for getting groceries delivered",
    "yc_gitlab": "whole devops platform in a single application", "yc_dropbox": "back up and share files in the cloud",
    "yc_twitch": "community for live streaming entertainment", "yc_reddit": "the front page of the internet",
    "yc_stripe": "economic infrastructure for the internet", "yc_zapier": "easiest way to automate your work",
    "yc_docker": "software development platform with containers", "yc_pagerduty": "visibility into critical apps and services when they break",
    "yc_algolia": "search api that developers like", "yc_segment": "apis to collect and control customer data",
    "yc_mixpanel": "event analytics for people who build products", "yc_cruise": "self driving cars",
    "yc_oklo": "always on power from advanced fission plants", "yc_helion-energy": "building the first fusion power plant",
    "yc_ginkgo-bioworks": "making biology easier to engineer", "yc_rigetti-computing": "quantum supercomputing",
    "yc_soylent": "simple nutritious affordable food drink", "yc_9gag": "make the world happier with funny posts",
    "yc_weebly": "build a free website that grows with your business", "yc_codecademy": "online platform to learn technical skills like coding",
    "yc_flexport": "platform for global logistics and freight", "yc_wave": "mobile money app for africa from senegal",
    "yc_razorpay": "full stack financial solutions for businesses in india", "yc_xendit": "payment infrastructure for southeast asia",
}
MIXED = {
    "yc_gitlab": "orange fox logo, devops company", "yc_twitch": "purple logo, live game streaming", "yc_airbnb": "pink red logo, travel stays",
    "yc_dropbox": "blue open box, cloud file storage", "yc_instacart": "carrot logo grocery delivery", "yc_reddit": "alien mascot, internet forum",
}

LOOKS_ONLY = "--looks-only" in sys.argv  # what MobileCLIP alone answers, for comparison

def ask(q):
    req = urllib.request.Request("http://localhost:3000/api/search", data=json.dumps({"query": q, "looksOnly": LOOKS_ONLY}).encode(), headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))

def run(name, pairs, match):
    top1 = top5 = floated = wrong_float = jevs = 0; ms = []; tokens = 0; misses = []
    for target, q in pairs:
        d = ask(q); ids = [h["id"] for h in d["hits"]]
        ok1 = bool(ids) and match(ids[0], target); ok5 = any(match(i, target) for i in ids[:5])
        top1 += ok1; top5 += ok5; ms.append(d["ms"]); tokens += d.get("tokens") or 0; jevs += d["decidedBy"] == "mobileclip + jev"
        floated += d["confident"] and ok1; wrong_float += d["confident"] and not ok1
        if not ok1: misses.append((q, target, ids[:3], d["decidedBy"], d["confident"]))
    n = len(pairs); ms.sort()
    print(f"{name}: top-1 {top1}/{n} ({100*top1/n:.0f}%)  top-5 {top5}/{n}  floated right {floated}, floated wrong {wrong_float}  jev calls {jevs}  median {ms[n//2]} ms  p90 {ms[int(n*0.9)]} ms  tokens {tokens} (${tokens/1e6*0.042:.5f})")
    if "--misses" in sys.argv:
        for m in misses: print("   miss:", m)

which = next((a for a in sys.argv[1:] if not a.startswith("--")), "all")
starts = lambda i, t: i.startswith(t + "_")
same = lambda i, t: i == t
if which in ("a", "all"):
    run("looks, with color words", list(QUERIES.items()), starts)
    run("looks, no color words  ", list(QUERIES_NOCOLOR.items()), starts)
if which in ("b", "all"):
    run("what the company does  ", list(INFO.items()), same)
    run("looks + info mixed     ", list(MIXED.items()), same)
