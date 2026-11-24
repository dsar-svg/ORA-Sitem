"""The agent's figures must match the screens, and its loop must run tools and stop cleanly."""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

import agent
from demo import Demo
from model import read_model, sync


def demo_book():
    with TemporaryDirectory() as folder:
        db = Path(folder) / "demo.sqlite3"
        sync(db, "andina", Demo())
        data = read_model(db, include_inventory=False)
    data["cutoff"] = "2026-10-31"
    return agent.Book(data)


class AgentTests(unittest.TestCase):
    def test_figures_match_the_sales_and_receivables_screens(self):
        book = demo_book()
        sales = book.ventas("2026-10", "vendedor", "", 5)
        self.assertEqual((sales["facturacion_neta"], sales["facturas"], sales["notas_de_credito"]), ("USD 8.056,00", 26, 1))
        self.assertEqual(sales["grupos"][0]["importe"], "USD 2.811,60")
        ar = book.cartera("", False, "tramo", 10, "")
        self.assertEqual((ar["saldo"], ar["vencido"], ar["documentos"]), ("USD 21.955,37", "USD 15.599,15", 87))
        self.assertLessEqual(len(ar["documentos_de_respaldo"]), agent.MAX_DOCS)
        self.assertIn("FAC-26-", ar["documentos_de_respaldo"][0]["numero"])
        self.assertEqual(agent.money(-11210, "USD"), "USD -112,10")

    def test_loop_runs_tools_and_returns_cited_documents(self):
        book = demo_book()
        use = NS(type="tool_use", id="t1", name="ventas", input={"mes": "2026-10", "agrupar_por": "total", "filtro": "", "limite": 5})
        replies = [NS(stop_reason="tool_use", content=[use], usage=NS(input_tokens=10, output_tokens=5)),
                   NS(stop_reason="end_turn", content=[NS(type="text", text="Vendiste USD 8.056,00.")], usage=NS(input_tokens=20, output_tokens=8))]
        client = NS(beta=NS(messages=NS(create=lambda **kw: replies.pop(0))))
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test"}), patch("anthropic.Anthropic", return_value=client):
            text, docs, tools, usage = agent.ask(book, "¿Cuánto vendí?", [], "2026-11-24", "2026-10", web=False)
        self.assertEqual((text, tools, usage), ("Vendiste USD 8.056,00.", ["ventas"], {"input": 30, "output": 13}))
        self.assertTrue(docs and all("numero" in d for d in docs))

    def test_unconfigured_agent_says_so(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(agent.AgentUnavailable):
                agent.ask(demo_book(), "hola", [], "2026-11-24", "2026-10")


if __name__ == "__main__":
    unittest.main()
