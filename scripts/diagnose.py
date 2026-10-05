#!/usr/bin/env python3
"""Read only diagnostic for the battery backfill. Writes nothing. Serials are never printed
because Actions logs are public."""
import os, requests
from collections import Counter
from datetime import date, timedelta

KEY = os.environ["GIVENERGY_API_KEY"]
BASE = "https://api.givenergy.cloud/v1"
H = {"Authorization": f"Bearer {KEY}", "Accept": "application/json", "Content-Type": "application/json"}

def get(path, params=None):
    return requests.get(BASE + path, headers=H, params=params, timeout=40)

devs, page = [], 1
while True:
    d = get("/communication-device", {"page": page}).json()
    devs += d.get("data", [])
    if page >= d.get("meta", {}).get("last_page", 1): break
    page += 1
inv = [x.get("inverter") or {} for x in devs]
bat = next(i["serial"] for i in inv if i.get("serial") and (i.get("connections") or {}).get("batteries"))
gw = next(i["serial"] for i in inv if i.get("serial") and i["serial"] != bat)

def pages(serial, day, size):
    """Return (list of points, per page counts, meta of first page)."""
    out, counts, page, meta0 = [], [], 1, None
    while True:
        j = get(f"/inverter/{serial}/data-points/{day}", {"page": page, "pageSize": size}).json()
        meta0 = meta0 or j.get("meta")
        b = j.get("data", [])
        counts.append(len(b)); out += b
        if not b or page >= j.get("meta", {}).get("last_page", 1): break
        page += 1
    return out, counts, meta0

def hours(pts):
    return Counter((p.get("time") or "")[11:13] for p in pts)

print("##### PAGING AND COVERAGE")
for day in ((date.today() - timedelta(days=1)).isoformat(), (date.today() - timedelta(days=2)).isoformat()):
    for size in (500, 200):
        for label, s in (("gateway", gw), ("battery", bat)):
            pts, counts, meta = pages(s, day, size)
            ts = sorted(p.get("time", "") for p in pts)
            m = {k: (meta or {}).get(k) for k in ("current_page", "last_page", "per_page", "total")}
            print(f"{day} size {size} {label}: {len(pts)} points, pages {counts}, meta {m}, first {ts[0][11:19] if ts else None}, last {ts[-1][11:19] if ts else None}")
    g, _, _ = pages(gw, day, 500); b, _, _ = pages(bat, day, 500)
    hg, hb = hours(g), hours(b)
    print(f"{day} points per UTC hour (gateway/battery):", " ".join(f"{h}:{hg.get(h,0)}/{hb.get(h,0)}" for h in sorted(set(hg) | set(hb))))

print("\n##### EARLIEST BATTERY HISTORY (first of each month)")
d = date(2023, 11, 1)
while d <= date.today():
    day = d.isoformat()
    try:
        pts, counts, _ = pages(bat, day, 500)
        withb = sum(1 for p in pts if ((p.get("power") or {}).get("battery") or {}).get("percent") is not None)
        print(f"{day}: {len(pts)} points, {withb} with battery percent")
    except Exception as e:
        print(f"{day}: error {type(e).__name__}")
    d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
