#!/usr/bin/env python3
"""
Octopus Energy - daily consumption fetcher
Fetches yesterday's half-hourly data for all meters and saves to data/octopus/YYYY-MM-DD.json
"""
import os, json, time, requests
from datetime import date, timedelta
from pathlib import Path

API_KEY  = os.environ["OCTOPUS_API_KEY"]
BASE     = "https://api.octopus.energy/v1"
DATA_DIR = Path(__file__).parent.parent / "data" / "octopus"
DATA_DIR.mkdir(parents=True, exist_ok=True)

METERS = [
    {"label": "import", "mpan": "2300000724370", "serial": "25L3784826", "kind": "electricity"},
    {"label": "export", "mpan": "2394300330547", "serial": "25L3784826", "kind": "electricity"},
    {"label": "gas",    "mprn": "8903647106",    "serial": "E6S20977962562", "kind": "gas"},
]

def get(path, params=None):
    r = requests.get(f"{BASE}{path}", auth=(API_KEY, ""), params=params, timeout=30)
    r.raise_for_status()
    return r.json()

def get_all_pages(path, params=None):
    results, url = [], f"{BASE}{path}"
    p = dict(params or {})
    p.setdefault("page_size", 25000)
    p["order_by"] = "period"
    while url:
        r = requests.get(url, auth=(API_KEY, ""), params=p, timeout=30)
        r.raise_for_status()
        d = r.json()
        results.extend(d.get("results", []))
        url = d.get("next")
        p = {}  # next URL already has params
        time.sleep(0.2)
    return results

def fetch_day(target_date: date):
    date_str   = target_date.isoformat()
    period_from = f"{date_str}T00:00:00Z"
    period_to   = f"{date_str}T23:59:59Z"

    payload = {"date": date_str, "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "meters": {}}

    for m in METERS:
        label = m["label"]
        try:
            if m["kind"] == "electricity":
                path = f"/electricity-meter-points/{m['mpan']}/meters/{m['serial']}/consumption/"
            else:
                path = f"/gas-meter-points/{m['mprn']}/meters/{m['serial']}/consumption/"
            records = get_all_pages(path, {"period_from": period_from, "period_to": period_to})
            payload["meters"][label] = records
            print(f"  {label}: {len(records)} intervals")
        except Exception as e:
            print(f"  {label}: ERROR {e}")
            payload["meters"][label] = []

    out = DATA_DIR / f"{date_str}.json"
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"  Saved {out}")
    return date_str

def update_index(dates_written):
    index_path = DATA_DIR / "index.json"
    existing = []
    if index_path.exists():
        try: existing = json.loads(index_path.read_text()).get("dates", [])
        except: pass
    merged = sorted(set(existing) | set(dates_written), reverse=True)
    index_path.write_text(json.dumps({"dates": merged}, separators=(",", ":")))

def main():
    yesterday = date.today() - timedelta(days=1)
    print(f"Fetching {yesterday}")
    written = [fetch_day(yesterday)]
    update_index(written)
    print("Done.")

if __name__ == "__main__":
    main()
