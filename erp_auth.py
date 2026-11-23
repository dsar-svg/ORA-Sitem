"""Password authentication through the ERP configured for this ORA installation."""
from collections import deque
from dataclasses import dataclass
from http.client import HTTPSConnection, HTTPException
from http.cookies import SimpleCookie, CookieError
import json
import os
from pathlib import Path
import secrets
from threading import Lock
from time import monotonic
from urllib.parse import urlsplit


class LoginDenied(Exception):
    pass


class AdditionalVerification(LoginDenied):
    pass


class ProviderUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Account:
    login: str
    company: str


class OdooLogin:
    def __init__(self, url, database, seats, company_id=None):
        address = urlsplit(url)
        if (address.scheme != "https" or not address.hostname or address.username is not None
                or address.path.strip("/") or address.query or address.fragment or not database):
            raise ValueError("Configura el dominio HTTPS de Odoo y el nombre de la base")
        self.host = address.netloc
        self.database = database
        self.seats = seats
        self.company_id = company_id

    def authenticate(self, login, password):
        if login not in self.seats or not password:
            raise LoginDenied()
        body = json.dumps({"jsonrpc":"2.0","method":"call","id":1,
                           "params":{"db":self.database,"login":login,"password":password}})
        connection = HTTPSConnection(self.host, timeout=12)
        try:
            connection.request("POST", "/web/session/authenticate", body.encode(),
                               {"Content-Type":"application/json","Accept":"application/json"})
            response = connection.getresponse()
            if response.status != 200:
                raise ProviderUnavailable()
            raw = response.read(512_001)
            if len(raw)>512_000:
                raise ProviderUnavailable()
            reply = json.loads(raw)
        except (OSError, HTTPException, ValueError) as err:
            raise ProviderUnavailable() from err
        finally:
            connection.close()
        if not isinstance(reply,dict):
            raise ProviderUnavailable()
        if "error" in reply:
            info = reply.get("error") or {}
            data = info.get("data") if isinstance(info,dict) else None
            name = data.get("name") if isinstance(data,dict) else None
            if name in ("odoo.exceptions.AccessDenied","odoo.exceptions.AccessError"):
                raise LoginDenied()
            raise ProviderUnavailable()
        info = reply.get("result")
        if not isinstance(info,dict):
            raise ProviderUnavailable()
        if "uid" in info and info["uid"] is None:
            raise AdditionalVerification()
        if (type(info.get("uid")) is not int or info["uid"]<=0 or info.get("db")!=self.database
                or info.get("is_internal_user") is not True or info.get("username","").casefold()!=login):
            raise LoginDenied()
        companies = info.get("user_companies") or {}
        cid = self.company_id or str(companies.get("current_company"))
        company = (companies.get("allowed_companies") or {}).get(cid)
        if not company:
            raise LoginDenied()
        return Account(login,company["name"])


def configured_provider(root, plan):
    # This optional file accepts installation settings only. Process variables take precedence.
    keys = {"ODOO_URL","NEXT_PUBLIC_ODOO_URL","ODOO_DB","ORA_ERP_USERS","ODOO_COMPANY_ID"}
    settings = {}
    path = Path(root)/".env.odoo"
    if path.is_file():
        for line in path.read_text("utf-8-sig").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() in keys:
                settings[key.strip()] = value.strip()
    settings.update({k:os.environ[k] for k in keys if k in os.environ})
    if not settings:
        return None
    seats = {v.strip().casefold() for v in settings.get("ORA_ERP_USERS","").split(",") if v.strip()}
    if not seats or any("@" not in s for s in seats) or len(seats)>{"basico":3,"intermedio":10,"avanzado":25}[plan]:
        raise ValueError("ORA_ERP_USERS debe identificar los correos habilitados dentro del cupo del plan")
    return OdooLogin(settings.get("ODOO_URL") or settings.get("NEXT_PUBLIC_ODOO_URL",""),
                     settings.get("ODOO_DB",""),seats,settings.get("ODOO_COMPANY_ID"))


class Sessions:
    def __init__(self):
        self.records = {}
        self.attempts = {}
        self.lock = Lock()

    def attempt(self, login):
        # Called only for configured seats. Count concurrent attempts before contacting the ERP.
        with self.lock:
            now = monotonic()
            times = self.attempts.setdefault(login,deque())
            while times and times[0] <= now-300:
                times.popleft()
            if len(times)>=5:
                return False
            times.append(now)
            return True

    def create(self, account):
        with self.lock:
            now = monotonic()
            self.records = {k:v for k,v in self.records.items() if v[0]>now}
            token = secrets.token_urlsafe(32)
            self.records[token] = (now+3600,account)
            self.attempts.pop(account.login,None)
            return token

    def account(self, cookie, logout=False):
        jar = SimpleCookie()
        try:
            jar.load(cookie or "")
        except CookieError:
            return None
        entry = jar.get("ora_session")
        if entry:
            with self.lock:
                record = self.records.get(entry.value)
                if record:
                    expiry, account = record
                    if logout or expiry<=monotonic():
                        del self.records[entry.value]
                    if expiry>monotonic():
                        return account
        return None
