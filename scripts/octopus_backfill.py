#!/usr/bin/env python3
"""
Octopus Energy - historical backfill
Fetches all available half-hourly data from START_DATE to yesterday.
Skips dates that already have a data file.
"""
import os, json, time, requests
from datetime import date, timedelta
from pathlib import Path

API_KEY   = os.environ["OCTOPUS_API_KEY"]
BASE      = "https://api.octopus.energy/v1"
DATA_DIR  = Path(__file__).parent.parent / "data" / "octopus"
DATA_DIR.mkdir(parents=True, exist_ok=True)
START_DATE = date(2024, 11, 1)

METERS = [
    {"label": "import", "mpan": "2300000724370", "serial": "25L3784826", "kind": "electricity"},
    {"label": "export", "mpan": "2394300330547", "serial": "25L3784826", "kind": "electricity"},
    {"label": "gas",    "mprn": "8903647106",    "serial": "E6S20977962562", "kind": "gas"},
]

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
        p = {}
        time.sleep(0.2)
    return results

def fetch_day(target_date: date):
    date_str    = target_date.isoformat()
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
        except Exception as e:
            print(f"    {label}: ERROR {e}")
            payload["meters"][label] = []
    out = DATA_DIR / f"{date_str}.json"
    out.write_text(json.dumps(payload, separators=(",", ":")))
    return date_str

def main():
    today = date.today()
    target = START_DATE
    written = []
    while target < today:
        out = DATA_DIR / f"{target.isoformat()}.json"
        if out.exists():
            print(f"  {target} already exists, skipping")
        else:
            print(f"  Fetching {target}...")
            written.append(fetch_day(target))
        target += timedelta(days=1)

    # update index
    index_path = DATA_DIR / "index.json"
    existing = []
    if index_path.exists():
        try: existing = json.loads(index_path.read_text()).get("dates", [])
        except: pass
    merged = sorted(set(existing) | set(written), reverse=True)
    index_path.write_text(json.dumps({"dates": merged}, separators=(",", ":")))
    print(f"Backfill complete. {len(written)} new days written.")

if __name__ == "__main__":
    main()
