"""Warehouse-level cuts rebuilt from posted Odoo stock lines in base product units."""
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal



def midnight_utc(day):
    return day.isoformat()+" 04:00:00"


def inventory(reader,data,first,end,today):
    # Three months of observations support each consumption window in Reposición.
    start = first
    for _ in range(2):
        start = (start-timedelta(days=1)).replace(day=1)
    locations, stores = {}, {}
    for r in reader.rows("stock.location","usage warehouse_id complete_name",[],shared=True):
        wh = r["warehouse_id"]
        key = str(wh[0]) if wh else "loc-"+str(r["id"])
        if r["usage"]=="internal":
            stores[key] = wh[1] if wh else r["complete_name"]
        locations[r["id"]] = (r["usage"],key)
    balances, names = defaultdict(Decimal), {}
    scope = reader.scope()+[["state","=","done"],["product_id.type","=","product"]]
    for field,sign in (("location_id",-1),("location_dest_id",1)):
        groups = reader.call("stock.move.line","read_group",dict(
            domain=scope+[["date","<",midnight_utc(start)],[field+".usage","=","internal"]],
            fields=["quantity_product_uom:sum"],groupby=["product_id",field],lazy=False))
        for g in groups:
            loc = locations.get(g[field][0])
            if not loc:
                raise PermissionError()
            if loc and loc[0]=="internal":
                pid,name = g["product_id"]
                names[pid] = name
                balances[pid,loc[1]] += sign*g["quantity_product_uom"]
    moves = defaultdict(list)
    domain = scope[1:]+[["date",">=",midnight_utc(start)],["date","<",midnight_utc(end+timedelta(days=1))]]
    for r in reader.rows("stock.move.line","date reference product_id location_id location_dest_id quantity_product_uom",domain):
        src = locations.get(r["location_id"][0])
        dst = locations.get(r["location_dest_id"][0])
        if not src or not dst:
            raise PermissionError()
        if src==dst:
            continue
        pid,name = r["product_id"]
        names[pid] = name
        timestamp = (datetime.fromisoformat(r["date"])-timedelta(hours=4)).isoformat()
        for loc,other,sign in ((src,dst,-1),(dst,src,1)):
            if loc[0]!="internal":
                continue
            kind = {"internal":"transfer","customer":"sale" if sign<0 else "return",
                    "supplier":"receipt" if sign>0 else "adjustment"}.get(other[0],"adjustment")
            moves[timestamp[:7],pid,loc[1]].append((timestamp,sign*r["quantity_product_uom"],kind,r["reference"] or str(r["id"])))
            balances.setdefault((pid,loc[1]),Decimal(0))
    reserves, minimum, incoming = defaultdict(Decimal),defaultdict(Decimal),defaultdict(list)
    if end==today:
        for r in reader.rows("stock.quant","product_id location_id reserved_quantity",
                             [["reserved_quantity","!=",0],["location_id.usage","=","internal"]]):
            loc = locations.get(r["location_id"][0])
            if loc:
                reserves[r["product_id"][0],loc[1]] += r["reserved_quantity"]
        for r in reader.rows("stock.warehouse.orderpoint","product_id location_id product_min_qty",[["active","=",True]]):
            loc = locations.get(r["location_id"][0])
            if loc:
                pid,name = r["product_id"]
                names[pid]=name
                minimum[pid,loc[1]] += r["product_min_qty"]
                balances.setdefault((pid,loc[1]),Decimal(0))
        for r in reader.rows("stock.move","product_id location_dest_id product_qty date",
                             [["state","in",["confirmed","waiting","assigned","partially_available"]],
                              ["location_id.usage","=","supplier"],["location_dest_id.usage","=","internal"]]):
            loc = locations.get(r["location_dest_id"][0])
            if loc:
                arrival = (datetime.fromisoformat(r["date"])-timedelta(hours=4)).date().isoformat()
                incoming[r["product_id"][0],loc[1]].append(dict(id=str(r["id"]),arrival=arrival,
                    open_units=float(r["product_qty"]),state="confirmed"))
    articles = {}
    for r in reader.related("product.product","default_code categ_id uom_id",names,shared=True):
        articles[r["id"]] = dict(product=str(r["id"]),sku=r["default_code"] or "—",
                                category=r["categ_id"][1],unit=r["uom_id"][1])
    data["warehouse"] = [dict(id=k,name=v) for k,v in stores.items()]
    data["product"] = [dict(id=str(k),name=v) for k,v in names.items() if k in articles]
    data["article"] = list(articles.values())
    month = start
    while month<=end:
        period = month.isoformat()[:7]
        following = (month.replace(day=28)+timedelta(days=4)).replace(day=1)
        for (pid,wh),opening in list(balances.items()):
            movement = sorted(moves.get((period,pid,wh),[]),key=lambda m:m[0])
            if pid not in articles or not (opening or movement or (pid,wh) in minimum or moves.get((first.isoformat()[:7],pid,wh))):
                continue
            cut = f"{period}/{pid}/{wh}"
            balance = opening
            daily = defaultdict(list)
            for timestamp,units,kind,ref in movement:
                day=timestamp[:10]
                daily[day].append(units)
                data["stock_move"].append(dict(cut=cut,posted=day,kind=kind,units=float(units),reference=ref))
            day=month
            while day<following and day<=end:
                levels=[balance]
                for delta in daily[day.isoformat()]:
                    balance+=delta
                    levels.append(balance)
                status="full" if min(levels)>0 else "out" if max(levels)<=0 else "partial"
                data["stock_day"].append(dict(cut=cut,posted=day.isoformat(),availability=status))
                day+=timedelta(days=1)
            balances[pid,wh]=balance
            current=end==today and month==first
            data["stock_cut"].append(dict(id=cut,period=period,product=str(pid),warehouse=wh,
                opening=float(opening),closing=float(balance),minimum=float(minimum[pid,wh]) if current and (pid,wh) in minimum else None))
            data["stock_policy"].append(dict(cut=cut,sales_complete=True,receipts_complete=current,
                reserved=float(reserves[pid,wh]) if current else None))
            if current:
                data["inbound"].extend(dict(cut=cut,**i) for i in incoming[pid,wh])
        month=following
