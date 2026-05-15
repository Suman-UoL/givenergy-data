#!/usr/bin/env python3
"""
Octopus Energy - historical backfill
Fetches all available half-hourly data from START_DATE to yesterday.
Skips dates that already have data (non-empty import array).
Uses correct meter serial for each date range:
  - Z15N353923 : Nov 2024 - 22 Mar 2026
  - 25L3784826 : 23 Mar 2026 onwards
"""
import os, json, time, requests
from datetime import date, timedelta
from pathlib import Path

API_KEY      = os.environ["OCTOPUS_API_KEY"]
BASE         = "https://api.octopus.energy/v1"
DATA_DIR     = Path(__file__).parent.parent / "data" / "octopus"
DATA_DIR.mkdir(parents=True, exist_ok=True)
START_DATE   = date(2024, 11, 1)
METER_CUTOVER = date(2026, 3, 23)


def get_meters(target_date):
    if target_date < METER_CUTOVER:
        elec_serial = "Z15N353923"
        exp_serial  = "Z15N353923"
        gas_serial  = "E6S08626771556"
    else:
        elec_serial = "25L3784826"
        exp_serial  = "25L3784826"
        gas_serial  = "E6S20977962562"
    return [
        {"label": "import", "mpan": "2300000724370", "serial": elec_serial, "kind": "electricity"},
        {"label": "export", "mpan": "2394300330547", "serial": exp_serial,  "kind": "electricity"},
        {"label": "gas",    "mprn": "8903647106",    "serial": gas_serial,  "kind": "gas"},
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
    payload = {
        "date": date_str,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "meters": {}
    }
    for m in get_meters(target_date):
        label = m["label"]
        try:
            if m["kind"] == "electricity":
                path = f"/electricity-meter-points/{m['mpan']}/meters/{m['serial']}/consumption/"
            else:
                path = f"/gas-meter-points/{m['mprn']}/meters/{m['serial']}/consumption/"
            records = get_all_pages(path, {"period_from": period_from, "period_to": period_to})
            payload["meters"][label] = records
            print(f"    {label}: {len(records)} intervals")
        except Exception as e:
            print(f"    {label}: ERROR {e}")
            payload["meters"][label] = []
    out = DATA_DIR / f"{date_str}.json"
    out.write_text(json.dumps(payload, separators=(",", ":")))
    return date_str


def needs_fetch(target_date: date):
    out = DATA_DIR / f"{target_date.isoformat()}.json"
    if not out.exists():
        return True
    try:
        d = json.loads(out.read_text())
        return len(d.get("meters", {}).get("import", [])) == 0
    except:
        return True


def main():
    today  = date.today()
    target = START_DATE
    written = []
    while target < today:
        if needs_fetch(target):
            print(f"  Fetching {target}...")
            written.append(fetch_day(target))
        else:
            print(f"  {target} already has data, skipping")
        target += timedelta(days=1)

    index_path = DATA_DIR / "index.json"
    existing = []
    if index_path.exists():
        try: existing = json.loads(index_path.read_text()).get("dates", [])
        except: pass
    merged = sorted(set(existing) | set(written), reverse=True)
    index_path.write_text(json.dumps({"dates": merged}, separators=(",", ":")))
    print(f"Done. {len(written)} days fetched/updated.")


if __name__ == "__main__":
    main()
