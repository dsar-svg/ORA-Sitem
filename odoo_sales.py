"""Read-only Odoo 17 queries scoped to the authenticated session and company."""
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from time import monotonic
from http.client import HTTPSConnection, HTTPException

from erp_auth import LoginDenied, ProviderUnavailable

CARACAS = timezone(timedelta(hours=-4))


def cents(value):
    # Odoo stores amounts rounded to the currency; float artifacts beyond cents round half up.
    return int((Decimal(str(value)) * 100).quantize(Decimal(1), ROUND_HALF_UP))


MAX_REPLY = int(os.getenv("ORA_ODOO_MAX_MB","120")) * 1024 * 1024
DEADLINE = float(os.getenv("ORA_REPORT_SECONDS","170"))  # below the browser's 180 s wait


class Reader:
    def __init__(self, host, account):
        if not account.upstream_cookie:
            raise LoginDenied()
        self.host, self.account = host, account
        self.until = monotonic() + DEADLINE

    def call(self, model, method, kwargs):
        kwargs["context"] = {"allowed_company_ids":[self.account.company_id], "active_test":False,
                             "tz":"America/Caracas"}
        params = dict(model=model, method=method, args=[], kwargs=kwargs)
        left = self.until - monotonic()
        if left <= 0:
            raise ProviderUnavailable("El reporte superó el tiempo máximo de lectura de Odoo")
        connection = HTTPSConnection(self.host, timeout=min(45, left))
        try:
            connection.request("POST", f"/web/dataset/call_kw/{model}/{method}",
                               json.dumps({"jsonrpc":"2.0","method":"call","id":1,"params":params}),
                               {"Content-Type":"application/json","Cookie":"session_id="+self.account.upstream_cookie})
            response = connection.getresponse()
            if response.status != 200:
                raise ProviderUnavailable()
            raw = response.read(MAX_REPLY + 1)
            if len(raw) > MAX_REPLY:
                raise ProviderUnavailable("Odoo devolvió más datos de los admitidos")
            reply = json.loads(raw, parse_float=Decimal)
        except (OSError, HTTPException, ValueError) as error:
            raise ProviderUnavailable() from error
        finally:
            connection.close()
        if "error" in reply:
            error = reply["error"] if isinstance(reply["error"], dict) else {}
            name = (error.get("data") or {}).get("name")
            if name == "odoo.http.SessionExpiredException":
                raise LoginDenied()
            if name in ("odoo.exceptions.AccessError", "odoo.exceptions.AccessDenied"):
                raise PermissionError()
            raise ProviderUnavailable()
        if not isinstance(reply.get("result"),list):
            raise ProviderUnavailable()
        return reply["result"]

    def scope(self, shared=False):
        return [["company_id","in",[False,self.account.company_id]]] if shared else [["company_id","=",self.account.company_id]]

    def rows(self, model, fields, domain, shared=False):
        last = 0
        while True:
            batch = self.call(model,"search_read",dict(domain=self.scope(shared)+domain+[["id",">",last]],
                              fields=list(dict.fromkeys(["id","company_id",*fields.split()])),
                              limit=500,order="id asc"))
            for row in batch:
                company = row["company_id"]
                if (company[0] if company else None) != self.account.company_id and not (shared and not company):
                    raise ProviderUnavailable()
                if row["id"] <= last:
                    raise ProviderUnavailable()
                last = row["id"]
                yield row
            if len(batch)<500:
                break

    def related(self, model, fields, ids, shared=False):
        values = sorted(set(ids))
        for index in range(0,len(values),300):
            yield from self.rows(model,fields,[["id","in",values[index:index+300]]],shared)


def finance_sales(reader, data, start, end, detail):
    domain = [["state","=","posted"],["move_type","in",["out_invoice","out_refund"]],
              ["invoice_date",">=",start],["invoice_date","<=",end]]
    fields = "name invoice_date invoice_date_due move_type partner_id currency_id amount_untaxed amount_total invoice_user_id"
    customers, sellers, products, ids = {}, {}, {}, []
    for r in reader.rows("account.move",fields,domain):
        rid, pid = str(r["id"]),str(r["partner_id"][0])
        customers[pid] = r["partner_id"][1]
        ids.append(r["id"])
        data["document"].append(dict(id=rid,number=r["name"],customer=pid,issued=r["invoice_date"],
            due=r["invoice_date_due"] or "",state="posted",kind="credit" if r["move_type"]=="out_refund" else "invoice",
            currency=r["currency_id"][1],net=cents(r["amount_untaxed"]),gross=cents(r["amount_total"])))
        if r.get("invoice_user_id"):
            sid, name = r["invoice_user_id"]
            sellers[str(sid)] = name
            data["assignment"].append(dict(document=rid,seller=str(sid)))
    if detail:
        for offset in range(0,len(ids),400):
            domain = [["move_id","in",ids[offset:offset+400]],["display_type","=","product"]]
            for r in reader.rows("account.move.line","move_id product_id quantity price_subtotal price_total",domain):
                product = r["product_id"]
                pid = str(product[0]) if product else None
                if product:
                    products[pid] = product[1]
                net = cents(r["price_subtotal"])
                data["line"].append(dict(document=str(r["move_id"][0]),product=pid,quantity=float(r["quantity"]),
                                         net=net,tax=cents(r["price_total"])-net))
    for key, items in (("customer",customers),("seller",sellers),("product",products)):
        data[key] = [dict(id=k,name=v) for k,v in items.items()]


def receivables(reader,data,start,end):
    # Include open items, activity in the period, and older items settled after opening.
    domain = [["parent_state","=","posted"],["account_id.account_type","=","asset_receivable"],
              ["date","<=",end],"|","|","|",["reconciled","=",False],["date",">=",start],
              ["matched_debit_ids.max_date",">=",start],["matched_credit_ids.max_date",">=",start]]
    fields = "move_id partner_id currency_id amount_currency balance date date_maturity matched_debit_ids matched_credit_ids payment_id"
    names = {c["id"]:c["name"] for c in data["customer"]}
    items, partials = {},set()
    for r in reader.rows("account.move.line",fields,domain):
        signed = cents(r["amount_currency"])
        if not signed:
            continue
        pid, name = r["partner_id"] or (0,"Sin cliente")
        names[str(pid)] = name
        items[r["id"]] = dict(id=str(r["id"]),number=r["move_id"][1],customer=str(pid),currency=r["currency_id"][1],
                              issued=r["date"],due=r["date_maturity"] or r["date"],state="posted",
                              kind="invoice" if signed>0 else "credit",gross=abs(signed),ledger=True,
                              payment=bool(r["payment_id"]) and signed<0)
        partials.update(r["matched_debit_ids"]+r["matched_credit_ids"])
    seen = set()
    for p in reader.related("account.partial.reconcile","max_date debit_move_id credit_move_id debit_amount_currency credit_amount_currency",partials):
        seen.add(p["id"])
        if p["max_date"]>end:
            continue
        for side in ("debit","credit"):
            rid = p[side+"_move_id"][0]
            if rid in items:
                data["settlement"].append(dict(id=str(p["id"]),document=str(rid),posted=p["max_date"],
                                               amount=cents(p[side+"_amount_currency"])))
    if seen != partials:
        raise PermissionError()
    data["arDocument"] = list(items.values())
    data["customer"] = [dict(id=k,name=v) for k,v in names.items()]
    data["history"] = dict(start=start,through=end,opening=True,applications=True)


def profiles(reader,data):
    ids = [int(c["id"]) for c in data["customer"] if c["id"]!="0"]
    fields = "ref vat phone email street city partner_latitude partner_longitude"
    for r in reader.related("res.partner",fields,ids,shared=True):
        cid = str(r["id"])
        data["customer_profile"].append(dict(customer=cid,code=r["ref"] or None,tax_id=r["vat"] or None,
            contact=r["phone"] or None,email=r["email"] or None,address=r["street"] or None))
        lat,lon = r["partner_latitude"],r["partner_longitude"]
        located = bool(lat or lon)
        data["location"].append(dict(customer=cid,zone=r["city"] or None,latitude=float(lat) if located else None,
                                     longitude=float(lon) if located else None,precision="point"))
    # Credit limits are company-dependent, denominated in the company currency.
    try:
        companies = reader.call("res.company","search_read",dict(domain=[["id","=",reader.account.company_id]],
                                fields=["currency_id"],limit=1))
        if companies:
            currency = companies[0]["currency_id"][1]
            for r in reader.related("res.partner","credit_limit",ids,shared=True):
                if r["credit_limit"]>0:
                    data["credit_line"].append(dict(customer=str(r["id"]),currency=currency,limit_cents=cents(r["credit_limit"])))
    except PermissionError:
        pass  # The directory also serves users without access to credit limits.


def tax_key(vat):
    """Normalize a RIF/VAT so J-050119373-8 and J501193738 compare equal."""
    text = re.sub(r"[^0-9A-Z]", "", str(vat or "").upper())
    match = re.fullmatch(r"([A-Z]*)0*(\d+)", text)
    return (match.group(1)+match.group(2)) if match else text


def drop_group(reader, data, company_vats):
    """Remove sales and receivables with group companies, matched by tax id, so totals show external business only."""
    # Placeholder ids such as "1" exist on some companies; short keys would exclude unrelated customers.
    keys = {tax_key(v) for v in [*company_vats, *os.getenv("ORA_GROUP_VATS","").split(",")] if len(tax_key(v)) >= 6}
    docs = data["document"] + data.get("arDocument", [])
    ids = [int(d["customer"]) for d in docs if d["customer"] != "0"]
    if not keys or not ids:
        return
    group = {str(r["id"]) for r in reader.related("res.partner","vat",ids,shared=True) if tax_key(r["vat"]) in keys}
    if not group:
        return
    data["excludedGroup"] = sorted({c["name"] for c in data["customer"] if c["id"] in group})
    # Move ids (documents) and journal item ids (receivables) are separate id spaces.
    moves = {d["id"] for d in data["document"] if d["customer"] in group}
    items = {d["id"] for d in data.get("arDocument", []) if d["customer"] in group}
    data["document"] = [d for d in data["document"] if d["id"] not in moves]
    if "arDocument" in data:
        data["arDocument"] = [d for d in data["arDocument"] if d["id"] not in items]
        data["settlement"] = [r for r in data["settlement"] if r["document"] not in items]
    for key in ("line", "assignment"):
        data[key] = [r for r in data[key] if r["document"] not in moves]
    data["customer"] = [c for c in data["customer"] if c["id"] not in group]


def bolivar_rate(reader,company_id,currency,end):
    """Bs per unit of the company currency at the cutoff, as the ERP's Venezuelan localisation stores it."""
    if currency in ("VES","VEF"):
        return None
    try:
        rows = reader.call("res.currency.rate","search_read",dict(
            domain=[["currency_id.name","=",currency],["company_id","in",[company_id,False]],["name","<=",end]],
            fields=["name","inverse_rate"],order="name desc",limit=1))
    except (PermissionError, ProviderUnavailable):
        return None  # field absent: no localisation rate, so no Bs equivalent
    if not rows or not rows[0].get("inverse_rate") or float(rows[0]["inverse_rate"]) <= 1:
        return None
    return dict(rate=str(rows[0]["inverse_rate"]),date=rows[0]["name"],currency=currency)


def sales_report(host,account,month,view=None):
    first = date.fromisoformat(month+"-01")
    start = (first-timedelta(days=1)).replace(day=1)
    today = datetime.now(CARACAS).date()
    end = min(today,(first.replace(day=28)+timedelta(days=4)).replace(day=1)-timedelta(days=1))
    reader = Reader(host,account)
    keys = ("document customer line product assignment seller location settlement customer_profile credit_line "
            "warehouse article stock_cut stock_move stock_day stock_policy inbound").split()
    data = {key:[] for key in keys}
    data.update(company=[dict(id=str(account.company_id),name=account.company,source="odoo")],
                modules=["sales"],user=account.login,erpCompany=account.company,reportMonth=month,cutoff=end.isoformat())
    company_vats = []
    try:
        # The company currency is the portal's default; other currencies stay one filter away.
        found = reader.call("res.company","search_read",dict(domain=[],fields=["currency_id","vat"],limit=100))
        company_vats = [c["vat"] for c in found if c.get("vat")]
        own = [c for c in found if c["id"] == account.company_id]
        if own:
            data["company"][0]["currency"] = own[0]["currency_id"][1]
    except PermissionError:
        pass
    if data["company"][0].get("currency"):
        data["bolivar"] = bolivar_rate(reader,account.company_id,data["company"][0]["currency"],end.isoformat())
    if view in (None,"sales","clients"):
        finance_sales(reader,data,start.isoformat(),end.isoformat(),view is not None)
    if view in ("ar","clients"):
        receivables(reader,data,first.isoformat(),end.isoformat())
    if view in (None,"sales","ar","clients"):
        drop_group(reader,data,company_vats)
    if view=="clients":
        profiles(reader,data)
    if view=="inventory":
        from odoo_inventory import inventory
        inventory(reader,data,first,end,today)
    data["synced"] = datetime.now(timezone.utc).isoformat()
    return data
