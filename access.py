"""Trusted, process-local scope for a single-company pilot."""
import base64
import binascii
import hmac
import json
import os

def roster(plan):
    encoded = os.getenv("ORA_USERS_JSON")
    if encoded is None:
        return {}  # One local demo profile.
    users = json.loads(encoded)
    if not isinstance(users, dict) or not users or any(
        not isinstance(k,str) or not k or ":" in k or not isinstance(v,str) or not v
        for k,v in users.items()
    ):
        raise ValueError("ORA_USERS_JSON debe contener usuarios y contraseñas no vacíos")
    if len(users) > {"basico":3,"intermedio":10,"avanzado":25}[plan]:
        raise ValueError("La cantidad de usuarios supera el cupo del plan")
    return users

def identity(header, users):
    if not users:
        return "demo-local"
    try:
        scheme, token = header.split(" ",1)
        name, secret = base64.b64decode(token,validate=True).decode().split(":",1)
    except (ValueError,UnicodeError,binascii.Error):
        return None
    if scheme.lower()=="basic" and name in users and hmac.compare_digest(secret.encode(),users[name].encode()):
        return name
    return None

def basic_scope(model, branch):
    if not branch.strip():
        raise ValueError("Básico requiere una sucursal")
    docs = [d for d in model["document"] if d["branch"]==branch]
    ids = {d["id"] for d in docs}
    model["document"] = docs
    for key in ("line","assignment"):
        model[key] = [r for r in model[key] if r["document"] in ids]
    for dim, source, field in [("customer","document","customer"),("product","line","product"),("seller","assignment","seller")]:
        visible = {r[field] for r in model[source]}
        model[dim] = [r for r in model[dim] if r["id"] in visible]
    for key in ("credit_line","settlement","customer_profile","location"):
        model.pop(key,None)
    model["location"] = []
