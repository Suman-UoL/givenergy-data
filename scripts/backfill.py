#!/usr/bin/env python3
import sys, os, json, time, requests
from datetime import date, timedelta
from pathlib import Path

API_KEY = os.environ["GIVENERGY_API_KEY"]
BASE    = "https://api.givenergy.cloud/v1"
DATA_DIR = Path(__file__).parent.parent / "data"
HEADERS = {"Authorization": f"Bearer {API_KEY}", "Accept": "application/json", "Content-Type": "application/json"}

def get(path, params=None):
    r = requests.get(f"{BASE}{path}", headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()

def get_all_pages(path, page_size=288):
    results, page = [], 1
    while True:
        data = get(path, {"page": page, "pageSize": page_size})
        batch = data.get("data", [])
        if not batch: break
        results.extend(batch)
        if page >= data.get("meta", {}).get("last_page", 1): break
        page += 1
        time.sleep(0.3)
    return results

def get_serial():
    return get("/communication-device", {"page":1})["data"][0]["inverter"]["serial"]

def fetch_day(serial, day):
    date_str = day.isoformat()
    out = DATA_DIR / f"{date_str}.json"
    if out.exists():
        print(f"  {date_str} exists — skipping")
        return date_str
    print(f"  Fetching {date_str}...", end=" ", flush=True)
    points_raw = get_all_pages(f"/inverter/{serial}/data-points/{date_str}")
    points = [{"t": p.get("time",""), "pv": (p.get("solar")or{}).get("power",0),
                "cons": p.get("consumption",0), "bat": (p.get("battery")or{}).get("power",0),
                "soc": (p.get("battery")or{}).get("percent",None),
                "grid": (p.get("grid")or{}).get("power",0)} for p in points_raw]
    try:
        ef = get(f"/inverter/{serial}/energy-flows/{date_str}", params={"start_time":"00:00","end_time":"23:59","grouping":30})
        flows = [{"t": e.get("start_time",""), "pv_h": e.get("pv_to_house",0), "grid_h": e.get("grid_to_house",0),
                  "bat_h": e.get("battery_to_house",0), "pv_g": e.get("pv_to_grid",0),
                  "pv_b": e.get("pv_to_battery",0), "bat_g": e.get("battery_to_grid",0)} for e in ef.get("data",[])]
    except: flows = []
    try: totals = get(f"/inverter/{serial}/energy/{date_str}").get("data", {})
    except: totals = {}
    payload = {"date": date_str, "serial": serial, "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "data_points": points, "energy_flows": flows, "totals": totals}
    out.write_text(json.dumps(payload, separators=(",",":")))
    print(f"{len(points)} pts")
    return date_str

def update_index(dates):
    p = DATA_DIR / "index.json"
    existing = []
    if p.exists():
        try: existing = json.loads(p.read_text()).get("dates", [])
        except: pass
    merged = sorted(set(existing)|set(dates), reverse=True)
    p.write_text(json.dumps({"dates": merged}, separators=(",",":")))
    print(f"index.json: {len(merged)} dates")

def main():
    if len(sys.argv) != 3:
        print("Usage: python scripts/backfill.py YYYY-MM-DD YYYY-MM-DD"); sys.exit(1)
    start, end = date.fromisoformat(sys.argv[1]), date.fromisoformat(sys.argv[2])
    if start > end: start, end = end, start
    DATA_DIR.mkdir(exist_ok=True)
    serial = get_serial()
    print(f"Inverter: {serial}\nBackfilling {start} → {end}\n")
    written, day = [], start
    while day <= end:
        try: written.append(fetch_day(serial, day))
        except Exception as e: print(f"ERROR {day}: {e}")
        day += timedelta(days=1)
        time.sleep(1)
    update_index(written)

if __name__ == "__main__":
    main()
