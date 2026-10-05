#!/usr/bin/env python3
"""Read only: compare the Gateway readings stored in the repo with the battery inverter's own
solar, consumption and grid readings, on a sample of days. Writes nothing."""
import sys, json
from datetime import date, datetime, timedelta, timezone
import fetch

def ep(t): return datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp()

def kwh(series):
    """series: time sorted (epoch, pv, cons, grid). Same gap rule as the dashboard (under 30 minutes)."""
    s = dict(pv=0.0, cons=0.0, imp=0.0, exp=0.0)
    for (t0, *_), (t1, pv, c, g) in zip(series, series[1:]):
        dt = (t1 - t0) / 3600
        if not (0 < dt < 0.5): continue
        s["pv"] += abs(pv) * dt; s["cons"] += abs(c) * dt
        if g > 0: s["imp"] += g * dt
        elif g < 0: s["exp"] += -g * dt
    return {k: v / 1000 for k, v in s.items()}

def inverter_series(serial, day):
    """Battery inverter readings for the UTC day (its days run on local time, so read two days)."""
    lo = datetime.fromisoformat(day.isoformat()).replace(tzinfo=timezone.utc).timestamp()
    out = {}
    for d in (day, day + timedelta(days=1)):
        try: raw = fetch.get_all_pages(f"/inverter/{serial}/data-points/{d.isoformat()}")
        except Exception: continue
        for p in raw:
            pw = p.get("power") or {}
            try: t = ep(p["time"])
            except Exception: continue
            if lo <= t < lo + 86400:
                out[t] = (t, (pw.get("solar") or {}).get("power") or 0,
                          (pw.get("consumption") or {}).get("power") or 0, (pw.get("grid") or {}).get("power") or 0)
    return sorted(out.values())

def gateway_series(day):
    f = fetch.DATA_DIR / f"{day.isoformat()}.json"
    if not f.exists(): return []
    return [(ep(p["t"]), p["pv"] or 0, p["cons"] or 0, p["grid"] or 0) for p in json.loads(f.read_text()).get("data_points", [])]

def main():
    _, bat = fetch.get_serials()
    days, d = [], date(2024, 6, 20)
    while d <= date(2026, 10, 3):
        days.append(d); d += timedelta(days=30)
    print("day        | solar kWh gw/inv | consumed gw/inv | import gw/inv | export gw/inv | inv readings")
    tot = {k: [0.0, 0.0] for k in ("pv", "cons", "imp", "exp")}
    for day in days:
        g, i = gateway_series(day), inverter_series(bat, day)
        if len(g) < 100 or len(i) < 100:
            print(f"{day} | skipped (gateway {len(g)}, inverter {len(i)} readings)"); continue
        a, b = kwh(g), kwh(i)
        for k in tot: tot[k][0] += a[k]; tot[k][1] += b[k]
        print(f"{day} | {a['pv']:6.1f} /{b['pv']:6.1f} | {a['cons']:6.1f} /{b['cons']:6.1f} | {a['imp']:6.1f} /{b['imp']:6.1f} | {a['exp']:6.1f} /{b['exp']:6.1f} | {len(i)}")
    print("TOTAL gateway vs inverter:", {k: (round(v[0], 1), round(v[1], 1), round(v[1] / v[0], 2) if v[0] else None) for k, v in tot.items()})

main()
