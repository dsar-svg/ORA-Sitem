import argparse
from threading import Lock
from time import monotonic
import gzip
import json
import logging
import os
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit, parse_qs
from erp_auth import configured_provider, Sessions, LoginDenied, AdditionalVerification, ProviderUnavailable
from access import roster, identity, basic_scope
from demo import Demo
from odoo_sales import CARACAS, Reader, sales_report
from datetime import date, datetime
from model import SCHEMA, read_model, sync
from inventory_view import slim_inventory, cut_moves
from agent import ATTACHMENT_TYPES, Book, AgentUnavailable, ask
from roles import ROLES, PLAN_ROLES, assignments, role_of, scoped
import calendar

ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.getenv("ORA_DATA_DIR", ROOT / "data")) / "andina.sqlite3"
ASSETS = {"/": ("index.html","text/html"), "/style.css": ("style.css","text/css"),
          "/portal.js": ("portal.js","text/javascript"), "/metrics.js": ("metrics.js","text/javascript")}

for module in ("agent.js","ora.js","boot.js","inventory.js","theme.js","filters.js","customers.js","map.js","reports.js","exports.js","tour.js","restock.js"):
    ASSETS["/" + module] = (module, "text/javascript")
BOUNDARY = "cartography/VEN-ADM1-9469f09.geojson"
ASSETS["/" + BOUNDARY] = (BOUNDARY, "application/geo+json")
for font in ("source-sans-3",):
    ASSETS[f"/fonts/{font}.ttf"] = (f"fonts/{font}.ttf","font/ttf")
ASSETS["/fonts/geist.woff2"] = ("fonts/geist.woff2","font/woff2")
for asset in ("exceljs.min.js","jspdf.umd.min.js","jspdf.plugin.autotable.min.js"):
    ASSETS["/vendor/" + asset] = ("vendor/" + asset, "text/javascript")
PLANS = {"basico": ["sales"], "intermedio": ["sales","ar","ap","clients","inventory"], "avanzado": ["sales","ar","ap","clients","inventory"]}
PLAN = os.getenv("ORA_PLAN","intermedio").lower()
if PLAN not in PLANS:
    raise ValueError("ORA_PLAN debe ser basico, intermedio o avanzado")

ERP = configured_provider(ROOT,PLAN)
SALES_MONTH = os.getenv("ORA_SALES_MONTH", "")
if SALES_MONTH:
    date.fromisoformat(SALES_MONTH + "-01")
    if not ERP or not (ERP.company_id or "").isdigit():
        raise ValueError("Los reportes de Odoo requieren ODOO_COMPANY_ID")
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
for name, mime in (("icon.svg","image/svg+xml"),("manifest.webmanifest","application/manifest+json")):
    ASSETS["/" + name] = (name, mime)
PUBLIC_PATHS = ("/style.css","/login.js","/fonts/source-sans-3.ttf","/fonts/geist.woff2","/icon.svg","/manifest.webmanifest")
LOG = logging.getLogger("ora")


class ReportCache:
    """Recent Odoo reports per user, company, month and view, so moving between sections does not re-read the ERP.
    The open month is kept 5 minutes; closed months an hour. shortcut: process memory, lost on restart; move to SQLite when running several replicas."""
    def __init__(self, size=48):
        self.items, self.size, self.lock = {}, size, Lock()

    def get(self, key):
        with self.lock:
            entry = self.items.get(key)
            if entry and entry[0] > monotonic():
                return entry[1]
            self.items.pop(key, None)
            return None

    def put(self, key, report, closed):
        with self.lock:
            if len(self.items) >= self.size:
                self.items.pop(min(self.items, key=lambda k: self.items[k][0]))
            self.items[key] = (monotonic() + (3600 if closed else 300), report)


REPORTS = ReportCache()
AGENT_PLANS = {"intermedio","avanzado"}
ROLE_TABLE = assignments(PLAN)


def role_for(user, account=None, asked=None):
    """The seat's role and seller id. Only the local demo, with synthetic data and no seats, may switch roles to show them."""
    if asked in PLAN_ROLES[PLAN] and not ERP and not USERS:
        role, _ = role_of(user, {(user or "").casefold(): (asked, None)}, PLAN, PLANS[PLAN])
        return role, "01"
    role, seller = role_of(user, ROLE_TABLE, PLAN, PLANS[PLAN])
    return role, seller or (str(account.uid) if account and account.uid else None)


def modules_for(user, account=None, asked=None):
    return list(role_for(user, account, asked)[0].modules)


def for_role(report, user, account=None, asked=None):
    role, seller = role_for(user, account, asked)
    return {**scoped(report, role, seller), "role": {"key": role.key, "name": role.name}}
AGENT_READY = bool(os.getenv("OPENAI_API_KEY"))
# Inline style attributes carry bar widths and theme tokens; scripts stay same-origin only.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")

class Handler(BaseHTTPRequestHandler):
    timeout = 30  # slow or idle clients release their thread
    server_version = "ORA"
    sys_version = ""

    def secure(self):
        self.send_header("Referrer-Policy","same-origin")
        self.send_header("X-Frame-Options","DENY")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Content-Security-Policy",CSP)
        if PUBLIC_ORIGIN:
            self.send_header("Strict-Transport-Security","max-age=31536000")

    def client(self):
        # Behind the HTTPS proxy the peer is the proxy; its first forwarded hop is the visitor.
        forwarded = self.headers.get("X-Forwarded-For","") if PUBLIC_ORIGIN else ""
        return forwarded.split(",")[0].strip() or self.client_address[0]

    def guarded(self, handler):
        try:
            handler()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            LOG.exception("Error no controlado · %s %s · cliente %s", self.command, urlsplit(self.path).path, self.client())
            try:
                self.reply(500,"Ocurrió un error inesperado. Inténtalo de nuevo; si continúa, avisa a soporte.".encode())
            except OSError:
                pass

    def do_GET(self):
        self.guarded(self.get)

    def do_POST(self):
        self.guarded(self.post)

    def reply(self, status, content=b"", mime="text/plain", **headers):
        self.send_response(status)
        self.send_header("Content-Type",mime+"; charset=utf-8")
        self.send_header("Content-Length",str(len(content)))
        self.send_header("Cache-Control","no-store")
        self.secure()
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

    def same_origin(self):
        port=self.server.server_port
        origins={PUBLIC_ORIGIN} if PUBLIC_ORIGIN else {f"http://127.0.0.1:{port}",f"http://localhost:{port}"}
        return self.headers.get("Origin") in origins

    def report_month(self, month):
        latest = datetime.now(CARACAS).date().isoformat()[:7]
        try:
            date.fromisoformat(month+"-01")
            return len(month)==7 and os.getenv("ORA_START_MONTH","2026-01")<=month<=latest
        except ValueError:
            return False

    def agent(self):
        def answer(status, message):
            self.reply(status, json.dumps({"error":message}, ensure_ascii=False).encode(), "application/json")
        if not self.same_origin():
            return answer(403, "Abre ORA desde su dirección configurada.")
        account = SESSIONS.account(self.headers.get("Cookie","")) if ERP else None
        user = account.login if account else (None if ERP else identity(self.headers.get("Authorization",""), USERS))
        if not user:
            return answer(401, "Tu sesión terminó. Vuelve a iniciar sesión.")
        if PLAN not in AGENT_PLANS:
            return answer(403, "Ora está incluida en los planes Gestión y Dirección.")
        if not SESSIONS.attempt("agent:"+user, 20):
            return answer(429, "Hiciste muchas preguntas seguidas. Espera unos minutos.")
        try:
            size = int(self.headers.get("Content-Length","0"))
            if self.headers.get_content_type()!="application/json" or not 0<size<=8_000_000:
                raise ValueError()
            body = json.loads(self.rfile.read(size))
            question, month = body["question"].strip(), body["month"]
            history = [{"role":m["role"],"content":m["content"]} for m in body.get("history",[])][-12:]
            asked = body.get("role") if isinstance(body.get("role"), str) else None
            files = [{"name":str(f["name"])[:120],"type":f["type"],"data":f["data"]} for f in body.get("files",[])]
            if len(files)>3 or any(f["type"] not in ATTACHMENT_TYPES or not isinstance(f["data"],str) for f in files)                     or sum(len(f["data"]) for f in files)>7_000_000:
                raise ValueError()
            if (not 0<len(question)<=2000 or not isinstance(month,str) or not self.report_month(month)
                    or any(m["role"] not in ("user","assistant") or not isinstance(m["content"],str) or len(m["content"])>6000 for m in history)):
                raise ValueError()
        except (ValueError, KeyError, TypeError, AttributeError):
            return answer(400, "La pregunta no es válida.")
        role, seller = role_for(user, account, asked)
        if SALES_MONTH:
            try:
                data = sales_report(ERP.host, account, month, "clients", sellers=role.own)
            except LoginDenied:
                return answer(401, "Tu sesión de Odoo terminó. Vuelve a iniciar sesión.")
            except PermissionError:
                return answer(403, "Tu usuario de Odoo no tiene permiso para leer estos datos.")
            except ProviderUnavailable as error:
                LOG.warning("Odoo no disponible para el agente · %s · %r", user, error.__cause__ or error)
                return answer(502, "No se pudo leer Odoo. Intenta de nuevo.")
        else:
            data = read_model(DATABASE, include_inventory=False)
            year, number = map(int, month.split("-"))
            data["cutoff"] = f"{month}-{calendar.monthrange(year,number)[1]:02d}"
        try:
            book = Book(scoped(data, role, seller), Reader(ERP.host, account) if SALES_MONTH else None, role=role, seller=seller)
            text, documents, tools, usage = ask(book, question, history, datetime.now(CARACAS).date().isoformat(), month, attachments=files)
        except AgentUnavailable as error:
            return answer(503, str(error))
        except LoginDenied:
            return answer(401, "Tu sesión de Odoo terminó. Vuelve a iniciar sesión.")
        LOG.info("Agente · %s · %s · mes %s · herramientas %s · tokens %s", user, role.key, month, ",".join(tools) or "-", usage)
        self.reply(200, json.dumps({"answer":text,"documents":documents,"files":book.files}, ensure_ascii=False).encode(), "application/json")

    def post(self):
        if self.path=="/api/agent":
            self.agent()
            return
        if not ERP or self.path not in ("/login","/logout"):
            self.reply(404)
            return
        if not self.same_origin():
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
        if not SESSIONS.attempt("ip:"+self.client(),20) or (login in ERP.seats and not SESSIONS.attempt(login)):
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

    def get(self):
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
            if account is None and path not in PUBLIC_PATHS:
                if path=="/":
                    self.reply(303,Location="/login")
                else:
                    self.reply(401)
                return
            user=account.login if account else ""
        else:
            user=identity(self.headers.get("Authorization",""), USERS)
        if user is None:
            self.reply(401,**{"WWW-Authenticate":'Basic realm="ORA piloto", charset="UTF-8"'})
            return
        asked = parse_qs(urlsplit(self.path).query).get("rol",[None])[0]
        modules = modules_for(user, account, asked)
        if path=="/restock.js" and "inventory" not in modules:
            self.reply(403)
            return
        if path == "/api/moves":
            if "inventory" not in modules:
                self.reply(403)
                return
            options = parse_qs(urlsplit(self.path).query)
            month, cut = options.get("month",[""])[0], options.get("cut",[""])[0]
            if not cut or len(cut) > 200:
                self.reply(400)
                return
            if SALES_MONTH:
                if not self.report_month(month):
                    self.reply(400)
                    return
                key = (account.login, ERP.company_id, month, "inventory")
                try:
                    report = REPORTS.get(key)
                    if report is None:
                        report = sales_report(ERP.host, account, month, "inventory")
                        REPORTS.put(key, report, month < datetime.now(CARACAS).date().isoformat()[:7])
                except LoginDenied:
                    self.reply(401)
                    return
                except PermissionError:
                    self.reply(403)
                    return
                except ProviderUnavailable:
                    self.reply(502)
                    return
            else:
                report = read_model(DATABASE, include_inventory=True)
            self.reply(200, json.dumps(cut_moves(report, cut), ensure_ascii=False).encode(), "application/json")
            return
        if path in ("/api/report","/api/demo"):  # /api/demo kept for pages loaded before the rename
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
                if view is not None and view not in modules:
                    self.reply(403)
                    return
                key = (account.login, ERP.company_id, month, view)
                try:
                    report = REPORTS.get(key)
                    if report is None:
                        report = sales_report(ERP.host, account, month, view, sellers=role_for(user, account)[0].own)
                        REPORTS.put(key, report, month < latest)
                except LoginDenied:
                    SESSIONS.account(self.headers.get("Cookie",""), logout=True)
                    self.reply(401)
                    return
                except PermissionError:
                    self.reply(403)
                    return
                except ProviderUnavailable as error:
                    LOG.warning("Odoo no disponible · vista %s · mes %s · %s · %r", view, month, account.login, error.__cause__ or error)
                    self.reply(502)
                    return
                report["plan"] = PLAN
                payload = for_role(report, user, account)  # only what the role may see; the cached report stays whole
                if view:
                    payload = {**payload, "modules": modules, "firstMonth": earliest, "lastMonth": latest}
                # Inventory leaves daily rows and move lists on the server; the browser asks /api/moves per product.
                body = json.dumps(slim_inventory(payload) if view == "inventory" else payload).encode()
                # Inventory snapshots carry one row per product, warehouse and day; JSON compresses ~15x.
                if "gzip" in self.headers.get("Accept-Encoding",""):
                    self.reply(200, gzip.compress(body, 6), "application/json", **{"Content-Encoding":"gzip","Vary":"Accept-Encoding"})
                else:
                    self.reply(200, body, "application/json")
                return
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
            model = for_role(model, user, account, asked)
            if "inventory" in modules:
                model = slim_inventory(model)
            content = json.dumps(model, ensure_ascii=False).encode()
            mime = "application/json"
        elif path in ASSETS:
            name, mime = ASSETS[path]
            content = (ROOT / "web" / name).read_bytes()
            if path == "/":
                # The plan is known here, so the sidebar paints with its final sections instead of after /api/demo.
                for module in ("sales","ar","ap","clients","inventory"):
                    if module not in modules:
                        content = content.replace(f'data-module="{module}"'.encode(), f'data-module="{module}" hidden'.encode())
                # Identity and source are known before /api/demo, so the header and profile paint final values.
                plan_name = {"basico":"Básico","intermedio":"Intermedio","avanzado":"Avanzado"}[PLAN]
                fills = {'<span>Perfil de demo</span>': f'<span>{escape(user)}</span>' if user and user != "demo-local" else None,
                         '<strong id="company">ORA</strong>': f'<strong id="company">{escape(account.company)}</strong>' if account else None,
                         '<span class="badge"></span>': f'<span class="badge">{"Odoo" if SALES_MONTH else "Demo"} · {plan_name}</span>',
                         '<body>': '<body data-home="'+modules[0]+'" data-role="'+role_for(user, account, asked)[0].key+'"'+(' data-live="1"' if SALES_MONTH else '')+(' data-demo-roles="'+",".join(r for r in ROLES if r in PLAN_ROLES[PLAN])+'"' if not ERP and not USERS and PLAN!="basico" else '')+'>',
                         '<button data-section="ora" hidden>': '<button data-section="ora">' if PLAN in AGENT_PLANS and AGENT_READY else None}
                for marker, value in fills.items():
                    if value:
                        content = content.replace(marker.encode(), value.encode())
        else:
            self.reply(404)
            return
        self.reply(200, content, mime)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ORA · portal local de demostración")
    parser.add_argument("command", choices=["demo","serve"], default="serve", nargs="?")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--erp-container", action="store_true",
                        help="Escuchar en todas las interfaces detrás del proxy HTTPS del piloto ERP")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
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
