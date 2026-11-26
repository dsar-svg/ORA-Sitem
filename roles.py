"""Roles: what each seat sees. A role picks the sections, whether product cost is visible and whether the data is
limited to the user's own sales (vendedor). Everything is applied on the server, so the browser never receives
what the role may not see.

ORA_ROLES="ana@empresa.com:direccion,luis@empresa.com:vendedor"
Without ORA_ROLES every seat is Dirección (single-manager pilots). With it, seats not listed get Vendedor, the
narrowest role. A third part sets the seller id when it is not the Odoo user id (demo data: "demo-local:vendedor:02").
"""
from dataclasses import dataclass
import os

CUSTOMER_SIDE = ("sales", "ar", "clients")


@dataclass(frozen=True)
class Role:
    key: str
    name: str
    modules: tuple
    cost: bool = False  # product cost, margin and purchase prices
    own: bool = False   # only the user's own invoices, customers and receivables

    @property
    def customers(self):
        return any(m in self.modules for m in CUSTOMER_SIDE)

    @property
    def purchases(self):
        return "ap" in self.modules


ROLES = {r.key: r for r in (
    Role("direccion", "Dirección", ("sales", "ar", "ap", "clients", "inventory"), cost=True),
    Role("ventas", "Gerente de ventas", ("sales", "clients", "ar", "inventory"), cost=True),
    Role("vendedor", "Vendedor", ("sales", "clients", "ar", "inventory"), own=True),
    Role("cobranza", "Cobranza", ("ar", "clients")),
    Role("compras", "Compras y almacén", ("inventory", "ap"), cost=True),
)}
PLAN_ROLES = {"basico": {"direccion"}, "intermedio": {"direccion", "vendedor", "cobranza"}, "avanzado": set(ROLES)}


def assignments(plan, text=None):
    """Parses ORA_ROLES into {login: (role key, seller id or None)}; fails at startup on unknown or out-of-plan roles."""
    text = os.getenv("ORA_ROLES", "") if text is None else text
    found = {}
    for entry in filter(None, (e.strip() for e in text.split(","))):
        login, _, rest = entry.partition(":")
        key, _, seller = rest.partition(":")
        key = key.strip().casefold()
        if key not in ROLES:
            raise ValueError(f"ORA_ROLES: rol desconocido '{key}'. Usa: {', '.join(ROLES)}")
        if key not in PLAN_ROLES[plan]:
            raise ValueError(f"ORA_ROLES: el rol '{key}' no está incluido en el plan {plan}")
        found[login.strip().casefold()] = (key, seller.strip() or None)
    return found


def role_of(user, table, plan, modules):
    """The user's role, its sections within the plan, and the seller id for own-scope roles."""
    key, seller = table.get((user or "").casefold(), ("vendedor" if table else "direccion", None))
    role = ROLES[key]
    if plan == "basico":
        role = Role(role.key, role.name, role.modules)  # Básico never shows cost
    return Role(role.key, role.name, tuple(m for m in modules if m in role.modules), role.cost, role.own), seller


def scoped(report, role, seller=None):
    """A copy of the report with only what the role may see. The cached report itself is left untouched."""
    out = dict(report)
    if not role.cost:
        out.pop("product_cost", None)
    if not role.purchases:
        out.pop("payable", None)
    if not role.customers:
        for key in ("document", "line", "assignment", "settlement", "customer_profile", "location", "credit_line"):
            out[key] = []
        if "arDocument" in out:
            out["arDocument"] = []
    elif role.own:
        own_sales(out, str(seller) if seller else "")
    return out


def own_sales(data, seller):
    """Keeps the seller's invoices and receivables, their customers, and the payments of those customers."""
    mine = {a["document"] for a in data.get("assignment", []) if a["seller"] == seller}
    data["document"] = [d for d in data.get("document", []) if d["id"] in mine]
    customers = {d["customer"] for d in data["document"]}
    if "arDocument" in data:
        # Receivable items carry the seller of their invoice; unassigned items (payments, credits) follow the customer.
        invoices = [d for d in data["arDocument"] if d.get("seller") == seller]
        customers |= {d["customer"] for d in invoices}
        data["arDocument"] = [d for d in data["arDocument"]
                              if d.get("seller") == seller or (not d.get("seller") and d["customer"] in customers)]
        kept = {d["id"] for d in data["arDocument"]}
    else:
        kept = mine
    data["settlement"] = [s for s in data.get("settlement", []) if s["document"] in kept]
    for key in ("line", "assignment"):
        data[key] = [r for r in data.get(key, []) if r["document"] in mine]
    data["customer"] = [c for c in data.get("customer", []) if c["id"] in customers]
    for key in ("customer_profile", "location", "credit_line"):
        data[key] = [r for r in data.get(key, []) if r["customer"] in customers]
    data["seller"] = [s for s in data.get("seller", []) if s["id"] == seller]
