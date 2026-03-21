#!/usr/bin/env python3
import os, json, time, requests
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

def get_all_pages(path, page_size=500):
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
    data = get("/communication-device", {"page": 1})
    devices = data.get("data", [])
    if not devices: raise RuntimeError("No devices found")
    serial = devices[0].get("inverter", {}).get("serial")
    if not serial: raise RuntimeError("No serial found")
    print(f"  Inverter: {serial}")
    return serial

def fetch_day(serial, day):
    date_str = day.isoformat()
    print(f"  Fetching {date_str}...")
    points_raw = get_all_pages(f"/inverter/{serial}/data-points/{date_str}")
    points = []
    for p in points_raw:
        pwr = p.get("power") or {}
        points.append({
            "t":    p.get("time", ""),
            "pv":   (pwr.get("solar") or {}).get("power", 0) or 0,
            "cons": (pwr.get("consumption") or {}).get("power", 0) or 0,
            "bat":  (pwr.get("battery") or {}).get("power", 0) or 0,
            "soc":  (pwr.get("battery") or {}).get("percent", None),
            "grid": (pwr.get("grid") or {}).get("power", 0) or 0,
            "temp": (pwr.get("inverter") or {}).get("temperature", None),
        })
    try:
        ef_raw = get(f"/inverter/{serial}/energy-flows/{date_str}",
                     params={"start_time":"00:00","end_time":"23:59","grouping":30})
        flows = [{"t": e.get("start_time",""), "pv_h": e.get("pv_to_house",0),
                  "grid_h": e.get("grid_to_house",0), "bat_h": e.get("battery_to_house",0),
                  "pv_g": e.get("pv_to_grid",0), "pv_b": e.get("pv_to_battery",0),
                  "bat_g": e.get("battery_to_grid",0)} for e in ef_raw.get("data",[])]
    except: flows = []
    try: totals = get(f"/inverter/{serial}/energy/{date_str}").get("data", {})
    except: totals = {}
    payload = {"date": date_str, "serial": serial,
               "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "data_points": points, "energy_flows": flows, "totals": totals}
    out = DATA_DIR / f"{date_str}.json"
    out.write_text(json.dumps(payload, separators=(",",":")))
    print(f"    Saved {len(points)} points, {len(flows)} flows")
    return date_str

def update_index(dates_written):
    index_path = DATA_DIR / "index.json"
    existing = []
    if index_path.exists():
        try: existing = json.loads(index_path.read_text()).get("dates", [])
        except: pass
    merged = sorted(set(existing) | set(dates_written), reverse=True)
    index_path.write_text(json.dumps({"dates": merged}, separators=(",",":")))

def main():
    DATA_DIR.mkdir(exist_ok=True)
    serial = get_serial()
    today = date.today()
    written = []
    for day in [today - timedelta(days=1), today]:
        try: written.append(fetch_day(serial, day))
        except Exception as e: print(f"  ERROR: {e}")
    update_index(written)
    print("Done.")

if __name__ == "__main__":
    main()
