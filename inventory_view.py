"""Inventory reduced on the server: per-cut figures replace daily rows and movement lists in what the browser receives.

The browser used to receive every stock move and one availability row per product, warehouse and day (16 MB for
a real company). It now gets one row per cut with the figures web/inventory.js and web/restock.js need, and asks for
a cut's movements only when the user opens it (/api/moves).
"""
from calendar import monthrange


def period_days(period, cutoff=None):
    if cutoff and cutoff.startswith(period):
        return int(cutoff[8:10])
    year, month = map(int, period.split("-"))
    return monthrange(year, month)[1]


def stock_figures(cut, moves, days):
    """Same arithmetic as calculateStock in web/inventory.js: net outflow, sales and mean of the daily closes."""
    daily, out, sold = [0.0] * days, 0.0, 0.0
    for m in moves:
        index = int(m["posted"][8:10]) - 1
        if 0 <= index < days:
            daily[index] += m["units"]
        if m["kind"] == "sale":
            sold -= m["units"]
        if m["kind"] in ("sale", "return"):
            out -= m["units"]
    mean = None
    if cut["opening"] is not None:
        balance, total = cut["opening"], 0.0
        for delta in daily:
            balance += delta
            total += balance
        mean = None if balance != cut["closing"] else total / days
    return dict(out=out, sold=sold, mean=mean)


def slim_inventory(report):
    """Returns a copy of the report without stock_move and stock_day, with per-cut figures and availability counts."""
    cutoff = report.get("cutoff")
    moves = {}
    for m in report.get("stock_move", []):
        moves.setdefault(m["cut"], []).append(m)
    cuts = []
    for c in report.get("stock_cut", []):
        days = period_days(c["period"], cutoff)
        cuts.append({**c, **stock_figures(c, moves.get(c["id"], []), days), "moves": len(moves.get(c["id"], []))})
    counts = {}
    covered = {c["id"]: period_days(c["period"], cutoff) for c in report.get("stock_cut", [])}
    for d in report.get("stock_day", []):
        if d["cut"] in covered and int(d["posted"][8:10]) <= covered[d["cut"]]:
            row = counts.setdefault(d["cut"], {"cut": d["cut"], "full": 0, "partial": 0, "out": 0})
            row[d["availability"]] += 1
    slim = {k: v for k, v in report.items() if k not in ("stock_move", "stock_day")}
    slim.update(stock_cut=cuts, stock_avail=list(counts.values()))
    return slim


def cut_moves(report, cut):
    return [m for m in report.get("stock_move", []) if m["cut"] == cut]
