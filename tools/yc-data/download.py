"""Download every logo in companies.json that is not on disk yet. Safe to re-run."""
import concurrent.futures as cf, json, os, subprocess

cos = json.load(open("companies.json"))
os.makedirs("logos", exist_ok=True)

def get(c):
    if not c["logo_url"]: return None
    dest = f"logos/{c['slug']}.png"
    if os.path.exists(dest) and os.path.getsize(dest) > 0: return True
    for _ in range(3):
        r = subprocess.run(["curl", "-sS", "-f", "-L", "--max-time", "30", "-o", dest, c["logo_url"]], capture_output=True)
        if r.returncode == 0 and os.path.getsize(dest) > 0: return True
    if os.path.exists(dest): os.remove(dest)
    return False

with cf.ThreadPoolExecutor(12) as ex: res = list(ex.map(get, cos))
print("on disk:", sum(1 for r in res if r), "| failed:", [c["slug"] for c, r in zip(cos, res) if r is False])
