#!/usr/bin/env python3
"""Read only diagnostic: lists the devices on the GivEnergy account and shows which
one reports battery data. Writes nothing. Serials and identifying values are hidden
because Actions logs are public."""
import os, re, requests
from datetime import date, timedelta

KEY = os.environ["GIVENERGY_API_KEY"]
BASE = "https://api.givenergy.cloud/v1"
H = {"Authorization": f"Bearer {KEY}", "Accept": "application/json", "Content-Type": "application/json"}
day = (date.today() - timedelta(days=1)).isoformat()
HIDE = re.compile(r"serial|uuid|(^|_)id$|address|name|postcode|mac|(^|_)ip|lat|lon|email|phone|town|city|street", re.I)

def shape(o, prefix=""):
    if isinstance(o, dict):
        for k, v in o.items():
            p = f"{prefix}.{k}" if prefix else k
            if HIDE.search(k) and not isinstance(v, (dict, list)):
                print(f"{p} = <hidden>")
            else:
                shape(v, p)
    elif isinstance(o, list):
        print(f"{prefix}: list of {len(o)}")
        if o: shape(o[0], prefix + "[0]")
    else:
        print(f"{prefix} = {o!r}")

def get(path, params=None):
    return requests.get(BASE + path, headers=H, params=params, timeout=30)

devices, page = [], 1
while True:
    r = get("/communication-device", {"page": page})
    d = r.json()
    devices += d.get("data", [])
    if page >= d.get("meta", {}).get("last_page", 1): break
    page += 1
print("Communication devices on account:", len(devices))
for i, dev in enumerate(devices, 1):
    print(f"\n##### DEVICE {i}")
    shape(dev)

serials = []
for dev in devices:
    s = (dev.get("inverter") or {}).get("serial")
    if s and s not in serials: serials.append(s)
print("\nDistinct inverter serials:", len(serials))

for i, s in enumerate(serials, 1):
    print(f"\n##### INVERTER {i}")
    r = get(f"/inverter/{s}/system-data/latest")
    j = (r.json() or {}).get("data") or {}
    b = j.get("battery") or {}
    print("latest: HTTP", r.status_code, "| status", j.get("status"), "| time", j.get("time"),
          "| battery percent", b.get("percent"), "| battery power", b.get("power"),
          "| solar", (j.get("solar") or {}).get("power"), "| grid", (j.get("grid") or {}).get("power"))
    r = get(f"/inverter/{s}/data-points/{day}", {"page": 1, "pageSize": 200})
    pts = (r.json() or {}).get("data") or []
    bp = [p["power"]["battery"]["percent"] for p in pts if (p.get("power") or {}).get("battery", {}).get("percent") is not None]
    bw = [p["power"]["battery"]["power"] for p in pts if (p.get("power") or {}).get("battery", {}).get("power") is not None]
    print(f"data points {day}: HTTP {r.status_code}, {len(pts)} points, with battery percent {len(bp)}, with battery power {len(bw)}")
    if bp: print("battery percent range:", min(bp), "to", max(bp))
    if bw: print("battery power range:", min(bw), "to", max(bw))
