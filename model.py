"""A trusted tenant binding selects one SQLite file per company."""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

TABLES = {
    "company": "id,name,source",
    "customer": "id,name",
    "product": "id,name",
    "document": "id,number,kind,state,issued,due,customer,branch,currency",
    "line": "id,document,product,quantity,net,tax",
    "settlement": "id,document,posted,amount",
}
INVENTORY = {
    "warehouse": "id,name",
    "article": "product,sku,category,unit",
    "stock_cut": "id,period,product,warehouse,opening,closing,minimum",
    "stock_move": "id,cut,posted,kind,units,reference",
}
DIMENSIONS = {
    "history_coverage": "id,start_date,through_date,zero_opening,applications_complete",
    "customer_profile": "customer,code,tax_id,contact,email,address",
    "credit_line": "customer,currency,limit_cents",
    "seller": "id,name",
    "assignment": "document,seller",
    "location": "customer,zone,latitude,longitude,precision",
}
REPLENISHMENT = {
    "stock_policy":"cut,reserved,lead_days,safety,sales_complete,receipts_complete",
    "inbound":"id,cut,arrival,open_units,state",
}
TABLES.update(INVENTORY)
TABLES.update(REPLENISHMENT)
TABLES.update(DIMENSIONS)
SCHEMA = """
CREATE TABLE IF NOT EXISTS company(id TEXT PRIMARY KEY,name TEXT NOT NULL,source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customer(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS product(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS document(id TEXT PRIMARY KEY,number TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('invoice','credit')),state TEXT NOT NULL CHECK(state IN ('posted','draft','cancelled')),
 issued TEXT NOT NULL,due TEXT NOT NULL,customer TEXT NOT NULL REFERENCES customer(id),branch TEXT,currency TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS line(id TEXT PRIMARY KEY,document TEXT NOT NULL REFERENCES document(id),
 product TEXT REFERENCES product(id),quantity INTEGER NOT NULL,net INTEGER NOT NULL CHECK(net>=0),tax INTEGER NOT NULL CHECK(tax>=0));
CREATE TABLE IF NOT EXISTS settlement(id TEXT PRIMARY KEY,document TEXT NOT NULL REFERENCES document(id),posted TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0));
CREATE TABLE IF NOT EXISTS warehouse(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS article(product TEXT PRIMARY KEY REFERENCES product(id),sku TEXT NOT NULL,
 category TEXT NOT NULL,unit TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stock_cut(id TEXT PRIMARY KEY,period TEXT NOT NULL,
 product TEXT NOT NULL REFERENCES article(product),warehouse TEXT NOT NULL REFERENCES warehouse(id),
 opening INTEGER,closing INTEGER NOT NULL,minimum INTEGER,UNIQUE(period,product,warehouse));
CREATE TABLE IF NOT EXISTS stock_move(id TEXT PRIMARY KEY,cut TEXT NOT NULL REFERENCES stock_cut(id),
 posted TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('sale','return','receipt','transfer','adjustment')),
 units INTEGER NOT NULL,reference TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customer_profile(customer TEXT PRIMARY KEY REFERENCES customer(id),
 code TEXT, tax_id TEXT, contact TEXT, email TEXT, address TEXT);
CREATE TABLE IF NOT EXISTS credit_line(customer TEXT NOT NULL REFERENCES customer(id),
 currency TEXT NOT NULL,limit_cents INTEGER NOT NULL CHECK(limit_cents>=0),PRIMARY KEY(customer,currency));
CREATE TABLE IF NOT EXISTS seller(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assignment(document TEXT PRIMARY KEY REFERENCES document(id),
 seller TEXT NOT NULL REFERENCES seller(id));
CREATE TABLE IF NOT EXISTS location(customer TEXT PRIMARY KEY REFERENCES customer(id),
 zone TEXT,latitude REAL CHECK(latitude BETWEEN -90 AND 90),longitude REAL CHECK(longitude BETWEEN -180 AND 180),
 precision TEXT NOT NULL CHECK(precision IN ('point','city','municipality')), CHECK((latitude IS NULL)=(longitude IS NULL)));
CREATE TABLE IF NOT EXISTS history_coverage(id INTEGER PRIMARY KEY CHECK(id=1),
 start_date TEXT NOT NULL, through_date TEXT NOT NULL CHECK(through_date>=start_date),
 zero_opening INTEGER NOT NULL CHECK(zero_opening IN (0,1)),
 applications_complete INTEGER NOT NULL CHECK(applications_complete IN (0,1)));
CREATE TABLE IF NOT EXISTS stock_policy(cut TEXT PRIMARY KEY REFERENCES stock_cut(id),
 reserved INTEGER CHECK(reserved>=0),lead_days INTEGER CHECK(lead_days>=0),safety INTEGER CHECK(safety>=0),
 sales_complete INTEGER NOT NULL CHECK(sales_complete IN (0,1)),receipts_complete INTEGER NOT NULL CHECK(receipts_complete IN (0,1)));
CREATE TABLE IF NOT EXISTS inbound(id TEXT PRIMARY KEY,cut TEXT NOT NULL REFERENCES stock_cut(id),
 arrival TEXT NOT NULL,open_units INTEGER NOT NULL CHECK(open_units>=0),state TEXT NOT NULL CHECK(state IN ('confirmed','draft','cancelled')));
CREATE TABLE IF NOT EXISTS sync(completed TEXT NOT NULL);
"""

class Connector(Protocol):
    def snapshot(self) -> dict[str, list[tuple]]:
        """Return a complete, consistent, read-only snapshot for one company and source."""
        ...

def connect(path):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db

def sync(path, company_id, connector: Connector):
    data = connector.snapshot()
    stock_tables = INVENTORY.keys() & data.keys()
    if stock_tables and stock_tables != INVENTORY.keys():
        raise ValueError("Instantánea de inventario incompleta")
    if len(data["company"]) != 1 or data["company"][0][0] != company_id:
        raise ValueError("Empresa de origen incorrecta")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = connect(path)
    try:
        db.executescript(SCHEMA)
        with db:
            db.execute("BEGIN IMMEDIATE")
            bound = db.execute("SELECT id,source FROM company").fetchone()
            if bound and tuple(bound) != (company_id, data["company"][0][2]):
                raise ValueError("El destino pertenece a otra empresa o fuente")
            for table in reversed(TABLES):
                db.execute(f"DELETE FROM {table}")
            for table, columns in TABLES.items():
                marks = ",".join("?" for _ in columns.split(","))
                db.executemany(f"INSERT INTO {table} ({columns}) VALUES ({marks})", data.get(table, []) if table in INVENTORY or table in REPLENISHMENT or table in DIMENSIONS else data[table])
            db.execute("DELETE FROM sync")
            db.execute("INSERT INTO sync VALUES (?)", (datetime.now(timezone.utc).isoformat(),))
    finally:
        db.close()

def read_model(path, include_inventory=True):
    db = connect(path)
    try:
        db.execute("BEGIN")
        result = {t: [dict(r) for r in db.execute(f"SELECT * FROM {t}")] for t in TABLES if include_inventory or (t not in INVENTORY and t not in REPLENISHMENT)}
        result["synced"] = db.execute("SELECT completed FROM sync").fetchone()[0]
        return result
    finally:
        db.close()
