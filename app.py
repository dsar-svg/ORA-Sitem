import argparse
import gzip
import json
import os
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit, parse_qs
from erp_auth import configured_provider, Sessions, LoginDenied, AdditionalVerification, ProviderUnavailable
from access import roster, identity, basic_scope
from demo import Demo
from odoo_sales import CARACAS, sales_report
from datetime import date, datetime
from model import SCHEMA, read_model, sync

ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.getenv("ORA_DATA_DIR", ROOT / "data")) / "andina.sqlite3"
ASSETS = {"/": ("index.html","text/html"), "/style.css": ("style.css","text/css"),
          "/portal.js": ("portal.js","text/javascript"), "/metrics.js": ("metrics.js","text/javascript")}

for module in ("boot.js","inventory.js","theme.js","filters.js","customers.js","map.js","reports.js","exports.js","tour.js","restock.js"):
    ASSETS["/" + module] = (module, "text/javascript")
BOUNDARY = "cartography/VEN-ADM1-9469f09.geojson"
ASSETS["/" + BOUNDARY] = (BOUNDARY, "application/geo+json")
for font in ("source-sans-3",):
    ASSETS[f"/fonts/{font}.ttf"] = (f"fonts/{font}.ttf","font/ttf")
for asset in ("exceljs.min.js","jspdf.umd.min.js","jspdf.plugin.autotable.min.js"):
    ASSETS["/vendor/" + asset] = ("vendor/" + asset, "text/javascript")
PLANS = {"basico": ["sales"], "intermedio": ["sales","ar","clients","inventory"], "avanzado": ["sales","ar","clients","inventory"]}
PLAN = os.getenv("ORA_PLAN","intermedio").lower()
if PLAN not in PLANS:
    raise ValueError("ORA_PLAN debe ser basico, intermedio o avanzado")

ERP = configured_provider(ROOT,PLAN)
SALES_MONTH = os.getenv("ORA_SALES_MONTH", "")
if SALES_MONTH:
    date.fromisoformat(SALES_MONTH + "-01")
    if not ERP or not (ERP.company_id or "").isdigit() or PLAN == "basico":
        raise ValueError("Ventas Odoo requiere ODOO_COMPANY_ID y plan Intermedio o Avanzado")
USERS = {} if ERP else roster(PLAN)
SESSIONS = Sessions()
PUBLIC_ORIGIN = os.getenv("ORA_PUBLIC_ORIGIN","").rstrip("/")
if PUBLIC_ORIGIN and (urlsplit(PUBLIC_ORIGIN).scheme!="https" or not urlsplit(PUBLIC_ORIGIN).hostname
                      or urlsplit(PUBLIC_ORIGIN).path or urlsplit(PUBLIC_ORIGIN).query or urlsplit(PUBLIC_ORIGIN).fragment
                      or urlsplit(PUBLIC_ORIGIN).username is not None):
    raise ValueError("ORA_PUBLIC_ORIGIN debe ser el origen público HTTPS")
BRANCH = os.getenv("ORA_BRANCH","Caracas")
LOGIN_MESSAGES = {
    "datos": "Introduce tu correo y contraseña para continuar.",
    "acceso": "Acceso no confirmado. Revisa tus datos y que tu cuenta esté habilitada para ORA.",
    "factor": "Odoo requiere verificación adicional. Esta versión de ORA admite acceso con contraseña local.",
    "espera": "Espera cinco minutos antes de volver a intentar.",
    "conexion": "Odoo no pudo validar el acceso. Inténtalo de nuevo más tarde.",
}
ASSETS["/login.js"] = ("login.js","text/javascript")

class Handler(BaseHTTPRequestHandler):
    def reply(self, status, content=b"", mime="text/plain", **headers):
        self.send_response(status)
        self.send_header("Content-Type",mime+"; charset=utf-8")
        self.send_header("Content-Length",str(len(content)))
        self.send_header("Cache-Control","no-store")
        self.send_header("Referrer-Policy","same-origin")
        self.send_header("X-Frame-Options","DENY")
        for key,value in headers.items():
            self.send_header(key,value)
        self.end_headers()
        self.wfile.write(content)

    def login_page(self):
        code=parse_qs(urlsplit(self.path).query).get("aviso",[""])[0]
        message=LOGIN_MESSAGES.get(code,"")
        page=(ROOT/"web"/"login.html").read_text("utf-8")
        page=page.replace("{{host}}",escape(ERP.host)).replace("{{message}}",escape(message))
        self.reply(200,page.encode(),"text/html")

    def do_POST(self):
        if not ERP or self.path not in ("/login","/logout"):
            self.reply(404)
            return
        port=self.server.server_port
        origins={PUBLIC_ORIGIN} if PUBLIC_ORIGIN else {f"http://127.0.0.1:{port}",f"http://localhost:{port}"}
        if self.headers.get("Origin") not in origins:
            self.reply(403,"Abre ORA desde su dirección configurada y vuelve a iniciar sesión.".encode())
            return
        flags="; Path=/; HttpOnly; SameSite=Strict"+("; Secure" if PUBLIC_ORIGIN else "")
        cookie=self.headers.get("Cookie","")
        if self.path=="/logout":
            SESSIONS.account(cookie,logout=True)
            self.reply(303,Location="/login",**{"Set-Cookie":"ora_session=; Max-Age=0"+flags})
            return
        try:
            size=int(self.headers.get("Content-Length","0"))
            if self.headers.get_content_type()!="application/x-www-form-urlencoded" or not 0<size<=8192:
                raise ValueError()
            fields=parse_qs(self.rfile.read(size).decode(),strict_parsing=True,max_num_fields=2)
            login,=fields["email"]
            password,=fields["password"]
            login=login.strip().casefold()
        except (ValueError,KeyError):
            self.reply(303,Location="/login?aviso=datos")
            return
        if login in ERP.seats and not SESSIONS.attempt(login):
            self.reply(303,Location="/login?aviso=espera",**{"Retry-After":"300"})
            return
        try:
            account=ERP.authenticate(login,password)
        except AdditionalVerification:
            self.reply(303,Location="/login?aviso=factor")
            return
        except LoginDenied:
            self.reply(303,Location="/login?aviso=acceso")
            return
        except ProviderUnavailable:
            self.reply(303,Location="/login?aviso=conexion")
            return
        SESSIONS.account(cookie,logout=True)
        token=SESSIONS.create(account)
        self.reply(303,Location="/",**{"Set-Cookie":"ora_session="+token+"; Max-Age=3600"+flags})

    def do_GET(self):
        path = urlsplit(self.path).path
        account=None
        if ERP:
            account=SESSIONS.account(self.headers.get("Cookie",""))
            if path=="/login":
                if account:
                    self.reply(303,Location="/")
                else:
                    self.login_page()
                return
            if account is None and path not in ("/style.css","/login.js","/fonts/source-sans-3.ttf"):
                if path=="/":
                    self.reply(303,Location="/login")
                else:
                    self.reply(401)
                return
            user=account.login if account else ""
        else:
            user=identity(self.headers.get("Authorization",""), USERS)
        if user is None:
            self.send_response(401)
            self.send_header("WWW-Authenticate",'Basic realm="ORA piloto", charset="UTF-8"')
            self.end_headers()
            return
        if path=="/restock.js" and "inventory" not in PLANS[PLAN]:
            self.send_error(403)
            return
        if path == "/api/demo":
            if SALES_MONTH:
                options = parse_qs(urlsplit(self.path).query)
                view = options.get("view",[None])[0]
                latest = datetime.now(CARACAS).date().isoformat()[:7]
                earliest = os.getenv("ORA_START_MONTH","2026-01")
                month = options.get("month",[SALES_MONTH])[0]
                try:
                    date.fromisoformat(month+"-01")
                    if len(month)!=7 or not earliest<=month<=latest:
                        raise ValueError()
                except ValueError:
                    self.reply(400)
                    return
                if view is not None and view not in PLANS[PLAN]:
                    self.reply(403)
                    return
                try:
                    report = sales_report(ERP.host, account, month, view)
                except LoginDenied:
                    SESSIONS.account(self.headers.get("Cookie",""), logout=True)
                    self.reply(401)
                    return
                except PermissionError:
                    self.reply(403)
                    return
                except ProviderUnavailable:
                    self.reply(502)
                    return
                report["plan"] = PLAN
                if view:
                    report.update(modules=PLANS[PLAN],firstMonth=earliest,lastMonth=latest)
                body = json.dumps(report).encode()
                # Inventory snapshots carry one row per product, warehouse and day; JSON compresses ~15x.
                if "gzip" in self.headers.get("Accept-Encoding",""):
                    self.reply(200, gzip.compress(body, 6), "application/json", **{"Content-Encoding":"gzip","Vary":"Accept-Encoding"})
                else:
                    self.reply(200, body, "application/json")
                return
            modules = PLANS[PLAN]
            model = read_model(DATABASE, include_inventory="inventory" in modules)
            if ERP and any(c["source"]!="demo-v1" for c in model["company"]):
                # Real snapshots require an explicit ERP company and record-permission mapping.
                self.reply(403)
                return
            if PLAN=="basico":
                basic_scope(model,BRANCH)
            model["branch"] = BRANCH if PLAN=="basico" else None
            model["user"] = user
            if account:
                model["erpCompany"]=account.company
            coverage = model.pop("history_coverage")
            model["history"] = {}
            if coverage and "ar" in modules:
                h = coverage[0]
                model["history"] = {"start":h["start_date"],"through":h["through_date"],
                                    "opening":bool(h["zero_opening"]),"applications":bool(h["applications_complete"])}
            model.update(modules=modules, plan=PLAN)
            content = json.dumps(model, ensure_ascii=False).encode()
            mime = "application/json"
        elif path in ASSETS:
            name, mime = ASSETS[path]
            content = (ROOT / "web" / name).read_bytes()
            if path == "/":
                # The plan is known here, so the sidebar paints with its final sections instead of after /api/demo.
                for module in ("sales","ar","clients","inventory"):
                    if module not in PLANS[PLAN]:
                        content = content.replace(f'data-module="{module}"'.encode(), f'data-module="{module}" hidden'.encode())
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", mime + "; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(content)))
        self.end_headers()
        self.wfile.write(content)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ORA · portal local de demostración")
    parser.add_argument("command", choices=["demo","serve"], default="serve", nargs="?")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--erp-container", action="store_true",
                        help="Escuchar en todas las interfaces detrás del proxy HTTPS del piloto ERP")
    args = parser.parse_args()
    if args.erp_container and (not ERP or not PUBLIC_ORIGIN or not os.getenv("ORA_PLAN")):
        parser.error("El contenedor requiere Odoo, ORA_PUBLIC_ORIGIN y ORA_PLAN configurados")
    if SALES_MONTH and args.command == "serve":
        pass  # Live reports read directly from Odoo under the user's session.
    elif args.command == "demo" or not DATABASE.exists():
        sync(DATABASE,"andina",Demo())
        print("Datos sintéticos cargados.",flush=True)
    else:
        # Historical snapshots without daily observations keep their original data.
        with sqlite3.connect(DATABASE) as db:
            db.executescript(SCHEMA)
    if args.command == "serve":
        host = "0.0.0.0" if args.erp_container else "127.0.0.1"
        server = ThreadingHTTPServer((host,args.port), Handler)
        print(f"ORA disponible en {PUBLIC_ORIGIN or f'http://{host}:{server.server_port}'}",flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
