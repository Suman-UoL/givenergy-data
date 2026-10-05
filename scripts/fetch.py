#!/usr/bin/env python3
import os, json, time, requests
from bisect import bisect_left
from datetime import date, datetime, timedelta
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

def get_serials():
    """Return (primary_serial, battery_serial). The primary device (the Gateway) supplies
    solar, grid and consumption. The battery inverter supplies battery power and charge."""
    devices, page = [], 1
    while True:
        data = get("/communication-device", {"page": page})
        devices.extend(data.get("data", []))
        if page >= data.get("meta", {}).get("last_page", 1): break
        page += 1
    inverters = [d.get("inverter") or {} for d in devices]
    serials = [i["serial"] for i in inverters if i.get("serial")]
    if not serials: raise RuntimeError("No devices found")
    battery = next((i["serial"] for i in inverters
                    if i.get("serial") and (i.get("connections") or {}).get("batteries")), None)
    primary = next((x for x in serials if x != battery), serials[0])
    if battery == primary: battery = None
    print(f"  Devices: {len(serials)}, battery inverter found: {battery is not None}")
    return primary, battery

def epoch(t):
    return datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp()

def fetch_battery_points(serial, date_str):
    """Battery readings for the day as a time sorted list of (epoch, percent, power, inverter temp)."""
    out = []
    for p in get_all_pages(f"/inverter/{serial}/data-points/{date_str}"):
        pwr = p.get("power") or {}
        bat = pwr.get("battery") or {}
        try: ts = epoch(p.get("time", ""))
        except Exception: continue
        out.append((ts, bat.get("percent"), bat.get("power"), (pwr.get("inverter") or {}).get("temperature")))
    out.sort()
    return out

def nearest(bpts, keys, ts, tol=180):
    """Closest battery reading within tol seconds, else None."""
    if not keys: return None
    i = bisect_left(keys, ts)
    cands = [bpts[j] for j in (i - 1, i) if 0 <= j < len(bpts)]
    best = min(cands, key=lambda r: abs(r[0] - ts))
    return best if abs(best[0] - ts) <= tol else None

def fetch_day(serial, day, battery_serial=None):
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
    if battery_serial:
        try:
            bpts = fetch_battery_points(battery_serial, date_str)
            keys = [b[0] for b in bpts]
            matched = 0
            for pt in points:
                try: b = nearest(bpts, keys, epoch(pt["t"]))
                except Exception: b = None
                if b:
                    matched += 1
                    pt["soc"] = b[1]
                    pt["bat"] = b[2] or 0
                    if b[3] is not None: pt["temp"] = b[3]
            print(f"    Battery matched on {matched} of {len(points)} points")
        except Exception as e:
            print(f"  WARNING: battery data not added: {e}")
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
    serial, battery_serial = get_serials()
    today = date.today()
    written = []
    for day in [today - timedelta(days=1), today]:
        try: written.append(fetch_day(serial, day, battery_serial))
        except Exception as e: print(f"  ERROR: {e}")
    update_index(written)
    print("Done.")

if __name__ == "__main__":
    main()
