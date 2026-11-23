"""Monthly physical counts and posted warehouse movements in base units."""
from calendar import monthrange
from datetime import date, timedelta

def inventory_fixture():
    warehouses = [("CCS", "Principal · Caracas"), ("VAL", "Regional · Valencia")]
    categories = ["Café e infusiones", "Despensa", "Aceites", "Despensa", "Despensa"]
    data = dict(warehouse=warehouses, article=[], stock_cut=[], stock_move=[], stock_day=[])
    for i, category in enumerate(categories):
        product = str(i)
        data["article"].append((product, f"AND-{101+i}", category, "ud"))
        for warehouse, _ in warehouses:
            factor = 1 if warehouse == "CCS" else 2
            opening = [55, 160, 35, 80, 70][i] * factor
            for month in range(1, 11):
                period = f"2026-{month:02}"
                key = f"{warehouse}-{product}-{period}"
                sold = [110, 8, 35, 0, 12][i] * factor
                receipts = sold
                if i == 2 and month == 10:
                    receipts = 0
                moves = [(2, "receipt", receipts), (9, "sale", -(sold//2)),
                         (25, "sale", -(sold-sold//2))]
                if i == 0:
                    moves += [(14, "return", 3), (20, "adjustment", -3)]
                if i == 3:
                    moves += [(12, "transfer", -2 if warehouse == "CCS" else 2)]
                closing = opening + sum(units for _, _, units in moves)
                reference = f"CUT-{key}"
                if opening is not None and not (i == 4 and warehouse == "VAL"):
                    balance = opening
                    for day in range(1, monthrange(2026,month)[1]+1):
                        levels = [balance]
                        for move_day, _, units in moves:
                            if move_day == day:
                                balance += units
                                levels.append(balance)
                        availability = "full" if min(levels)>0 else "partial" if max(levels)>0 else "out"
                        data["stock_day"].append((reference,f"{period}-{day:02}",availability))
                data["stock_cut"].append((reference, period, product, warehouse,
                    opening if i != 4 or warehouse != "VAL" else None, closing,
                    [65,30,10,None,15][i]))
                for j, (day, kind, units) in enumerate(moves):
                    if units:
                        ref = f"TR-{period}" if kind == "transfer" else f"M-{key}-{j}"
                        data["stock_move"].append((f"{key}-{j}",reference,
                            f"{period}-{day:02}",kind,units,ref))
                opening = closing
    data.update(stock_policy=[],inbound=[])
    for cut,period,product,warehouse,opening,closing,minimum in data["stock_cut"]:
        lead = None if product=="1" and warehouse=="VAL" else 14
        reserve = min(closing,6) if product=="0" else 0
        data["stock_policy"].append((cut,reserve,lead,12,int(opening is not None),1))
        if product=="2" and warehouse=="VAL" and period=="2026-10":
            y,m=map(int,period.split("-"))
            arrival=date(y,m,monthrange(y,m)[1])+timedelta(days=1)
            data["inbound"].append(("OC-2026-031",cut,arrival.isoformat(),90,"confirmed"))
    return data
