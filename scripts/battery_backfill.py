#!/usr/bin/env python3
"""Add battery power and charge to existing daily files. Gateway readings (solar, grid,
consumption) are not re-fetched or changed. Usage: battery_backfill.py START END [--force]"""
import sys, json, time
from datetime import date, timedelta
import fetch   # reuses the API helpers and matching rules from fetch.py

DATA_DIR = fetch.DATA_DIR

def merge_day(path, battery_serial, force=False):
    day = json.loads(path.read_text())
    pts = day.get("data_points", [])
    if not pts: return "empty"
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
