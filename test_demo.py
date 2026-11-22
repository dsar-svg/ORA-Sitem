import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from demo import Demo
from model import TABLES, connect, read_model, sync


class DemoTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "andina.sqlite3"
        sync(self.path, "andina", Demo())

    def tables(self):
        result = read_model(self.path)
        return {k: result[k] for k in TABLES}

    def test_replay_is_identical(self):
        before = self.tables()
        sync(self.path, "andina", Demo())
        self.assertEqual(before, self.tables())
        self.assertEqual(len(before["document"]), 300)
        self.assertEqual(len(before["line"]), 600)

    def test_malformed_snapshot_rolls_back(self):
        before = self.tables()
        bad = Demo().snapshot()
        bad["line"].append(("broken","unknown-document","0",1,100,16))
        with self.assertRaises(sqlite3.IntegrityError):
            sync(self.path,"andina",Mock(snapshot=lambda:bad))
        self.assertEqual(before,self.tables())

    def test_company_binding(self):
        other = Demo().snapshot()
        other["company"] = [("otra","Otra empresa","demo-v1")]
        extractor = Mock(snapshot=lambda:other)
        with self.assertRaises(ValueError):
            sync(self.path,"andina",extractor)
        with self.assertRaises(ValueError):
            sync(self.path,"otra",extractor)
        second_path = self.path.with_name("otra.sqlite3")
        sync(second_path,"otra",extractor)
        self.assertEqual(read_model(second_path)["company"][0]["id"],"otra")
        self.assertEqual(read_model(self.path)["company"][0]["id"],"andina")

    def test_inventory_cuts_reconcile(self):
        db = connect(self.path)
        self.addCleanup(db.close)
        mismatches = db.execute("""
            SELECT c.id FROM stock_cut c LEFT JOIN stock_move m ON m.cut=c.id
            WHERE c.opening IS NOT NULL GROUP BY c.id
            HAVING c.opening + COALESCE(SUM(m.units),0) <> c.closing
        """).fetchall()
        self.assertEqual(mismatches, [])
        self.assertEqual(db.execute("SELECT COUNT(*) FROM stock_cut").fetchone()[0], 100)
        excluded = read_model(self.path, include_inventory=False)
        for table in ("warehouse","article","stock_cut","stock_move"):
            self.assertNotIn(table, excluded)

    def test_incomplete_inventory_preserves_snapshot(self):
        before = self.tables()
        partial = Demo().snapshot()
        del partial["stock_move"]
        with self.assertRaises(ValueError):
            sync(self.path,"andina",Mock(snapshot=lambda:partial))
        self.assertEqual(before,self.tables())

    def test_october_control_totals(self):
        db = connect(self.path)
        self.addCleanup(db.close)
        net, = db.execute("""
            SELECT SUM(CASE d.kind WHEN 'credit' THEN -l.net ELSE l.net END)
            FROM document d JOIN line l ON l.document=d.id
            WHERE d.currency='USD' AND d.state='posted'
              AND d.issued BETWEEN '2026-10-01' AND '2026-10-31'
        """).fetchone()
        pending, overdue = db.execute("""
            WITH amounts AS (
              SELECT document, SUM(net+tax) AS gross FROM line GROUP BY document
            ), applied AS (
              SELECT document, SUM(amount) AS amount FROM settlement
              WHERE posted<='2026-10-31' GROUP BY document
            ), balances AS (
              SELECT due, (gross-COALESCE(amount,0)) *
                CASE kind WHEN 'credit' THEN -1 ELSE 1 END AS balance
              FROM document d JOIN amounts a ON a.document=d.id
              LEFT JOIN applied p ON p.document=d.id
              WHERE state='posted' AND currency='USD' AND issued<='2026-10-31'
            )
            SELECT SUM(balance), SUM(CASE WHEN due<'2026-10-31' THEN balance ELSE 0 END)
            FROM balances
        """).fetchone()
        self.assertEqual((net,pending,overdue),(805600,2195537,1559915))


if __name__ == "__main__":
    unittest.main()

