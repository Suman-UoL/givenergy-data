#!/usr/bin/env python3
"""Read only diagnostic: shows what the GivEnergy API returns for battery data.
Writes nothing. The inverter serial is masked because Actions logs are public."""
import os, json, requests
from datetime import date, timedelta

KEY = os.environ["GIVENERGY_API_KEY"]
BASE = "https://api.givenergy.cloud/v1"
H = {"Authorization": f"Bearer {KEY}", "Accept": "application/json", "Content-Type": "application/json"}
day = (date.today() - timedelta(days=1)).isoformat()
SERIAL = ""

def mask(s):
    return s.replace(SERIAL, "SERIAL") if SERIAL else s

def show(title, method, path, **kw):
    print(f"\n=== {title}: {method} {mask(path)}")
    try:
        r = requests.request(method, BASE + path, headers=H, timeout=30, **kw)
        print("HTTP", r.status_code)
        print(mask(r.text[:700]))
        return r
    except Exception as e:
        print("ERROR", type(e).__name__)

def shape(o, prefix=""):
    if isinstance(o, dict):
        for k, v in o.items():
            shape(v, f"{prefix}.{k}" if prefix else k)
    elif isinstance(o, list):
        print(f"{prefix}: list of {len(o)}")
        if o: shape(o[0], prefix + "[0]")
    else:
        print(f"{prefix} = {o!r}")

r = requests.get(f"{BASE}/communication-device", headers=H, params={"page": 1}, timeout=30)
SERIAL = ((r.json().get("data") or [{}])[0].get("inverter") or {}).get("serial", "")
print("Serial found:", bool(SERIAL), "| day tested:", day)

r = requests.get(f"{BASE}/inverter/{SERIAL}/data-points/{day}", headers=H, params={"page": 1, "pageSize": 3}, timeout=30)
print("\n=== data points: HTTP", r.status_code)
try:
    pts = r.json().get("data", [])
    print("points on first page:", len(pts))
    if pts:
        print("--- structure of first point (names and values) ---")
        shape(pts[0])
except Exception as e:
    print("parse error", type(e).__name__)

show("system data latest", "GET", f"/inverter/{SERIAL}/system-data/latest")
show("energy flows as currently coded (GET)", "GET", f"/inverter/{SERIAL}/energy-flows/{day}",
     params={"start_time": "00:00", "end_time": "23:59", "grouping": 30})
show("energy flows (POST)", "POST", f"/inverter/{SERIAL}/energy-flows",
     json={"start_time": day, "end_time": day, "grouping": 1, "types": [0, 1, 2, 3, 4, 5, 6]})
show("daily totals as currently coded", "GET", f"/inverter/{SERIAL}/energy/{day}")
