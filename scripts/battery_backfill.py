#!/usr/bin/env python3
"""Add battery power and charge to existing daily files. Gateway readings (solar, grid,
consumption) are not re-fetched or changed. Usage: battery_backfill.py START END [--force]"""
import sys, json, time
from datetime import date, timedelta
import fetch   # reuses the API helpers and matching rules from fetch.py

DATA_DIR = fetch.DATA_DIR

def fill_from_inverter(day_str, serial):
    """Build readings for a UTC day from the battery inverter alone, for days the Gateway has none.
    The inverter reports grid power with the opposite sign to the Gateway, so it is flipped here."""
    lo = fetch.epoch(day_str + "T00:00:00Z")
    out = {}
    for d in (day_str, (date.fromisoformat(day_str) + timedelta(days=1)).isoformat()):
        try: raw = fetch.get_all_pages(f"/inverter/{serial}/data-points/{d}")
        except Exception:
            if d == day_str: raise
            continue
        for p in raw:
            try: t = fetch.epoch(p["time"])
            except Exception: continue
            if not (lo <= t < lo + 86400): continue
            pw = p.get("power") or {}
            bat = pw.get("battery") or {}
            g = (pw.get("grid") or {}).get("power") or 0
            out[t] = {"t": p["time"], "pv": (pw.get("solar") or {}).get("power") or 0,
                      "cons": (pw.get("consumption") or {}).get("power") or 0, "bat": bat.get("power") or 0,
                      "soc": bat.get("percent"), "grid": -g, "temp": (pw.get("inverter") or {}).get("temperature")}
    return [out[t] for t in sorted(out)]

def merge_day(path, battery_serial, force=False):
    day = json.loads(path.read_text())
    pts = day.get("data_points", [])
    if not pts:
        pts = fill_from_inverter(path.stem, battery_serial)
        if not pts: return "empty, no inverter data"
        day["data_points"] = pts
        day["source"] = "battery inverter (grid sign flipped)"
        path.write_text(json.dumps(day, separators=(",", ":")))
        return f"matched {len(pts)} of {len(pts)} (filled from inverter)"
    have = sum(1 for p in pts if p.get("soc") is not None)
    if have >= 0.9 * len(pts) and not force: return "already done"
    bpts = fetch.fetch_battery_points(battery_serial, path.stem)
    if not bpts: return "no battery data"
    keys = [b[0] for b in bpts]
    matched = 0
    for pt in pts:
        try: b = fetch.nearest(bpts, keys, fetch.epoch(pt["t"]))
        except Exception: b = None
        if b:
            matched += 1
            pt["soc"] = b[1]; pt["bat"] = b[2] or 0
            if b[3] is not None: pt["temp"] = b[3]
    if matched == 0: return "no matches"
    path.write_text(json.dumps(day, separators=(",", ":")))
    return f"matched {matched} of {len(pts)}"

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    if len(args) != 2:
        print("Usage: python scripts/battery_backfill.py YYYY-MM-DD YYYY-MM-DD [--force]"); sys.exit(1)
    start, end = date.fromisoformat(args[0]), date.fromisoformat(args[1])
    _, battery = fetch.get_serials()
    if not battery:
        print("No battery inverter found"); sys.exit(1)
    done = skipped = failed = 0
    day = start
    while day <= end:
        path = DATA_DIR / f"{day.isoformat()}.json"
        if path.exists():
            try:
                r = merge_day(path, battery, force)
                print(f"  {day}: {r}")
                if r.startswith("matched"): done += 1
                else: skipped += 1
            except Exception as e:
                failed += 1; print(f"  {day}: ERROR {type(e).__name__}")
            time.sleep(1)
        day += timedelta(days=1)
    print(f"Updated {done} days, skipped {skipped}, failed {failed}")

if __name__ == "__main__":
    main()
