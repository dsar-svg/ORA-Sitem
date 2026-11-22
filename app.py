import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit
from access import roster, identity, basic_scope
from demo import Demo
from model import SCHEMA, read_model, sync

ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.getenv("ORA_DATA_DIR", ROOT / "data")) / "andina.sqlite3"
ASSETS = {"/": ("index.html","text/html"), "/style.css": ("style.css","text/css"),
          "/portal.js": ("portal.js","text/javascript"), "/metrics.js": ("metrics.js","text/javascript")}

for module in ("inventory.js","theme.js","filters.js","customers.js","map.js","reports.js","exports.js","tour.js","restock.js"):
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

USERS = roster(PLAN)
BRANCH = os.getenv("ORA_BRANCH","Caracas")

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        user = identity(self.headers.get("Authorization",""), USERS)
        if user is None:
            self.send_response(401)
            self.send_header("WWW-Authenticate",'Basic realm="ORA piloto", charset="UTF-8"')
            self.end_headers()
            return
        path = urlsplit(self.path).path
        if path=="/restock.js" and "inventory" not in PLANS[PLAN]:
            self.send_error(403)
            return
        if path == "/api/demo":
            modules = PLANS[PLAN]
            model = read_model(DATABASE, include_inventory="inventory" in modules)
            if PLAN=="basico":
                basic_scope(model,BRANCH)
            model["branch"] = BRANCH if PLAN=="basico" else None
            model["user"] = user
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
    args = parser.parse_args()
    if args.command == "demo" or not DATABASE.exists():
        sync(DATABASE,"andina",Demo())
        print("Datos sintéticos cargados.",flush=True)
    else:
        # Historical snapshots without daily observations keep their original data.
        with sqlite3.connect(DATABASE) as db:
            db.executescript(SCHEMA)
    if args.command == "serve":
        server = ThreadingHTTPServer(("127.0.0.1",args.port), Handler)
        print(f"ORA disponible en http://127.0.0.1:{server.server_port}",flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
