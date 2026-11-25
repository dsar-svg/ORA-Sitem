from datetime import date
from unittest import TestCase
from unittest.mock import Mock

from odoo_inventory import inventory
from odoo_sales import receivables, drop_group, tax_key, bolivar_rate, payables, product_costs
from erp_auth import ProviderUnavailable


class LiveReportsTests(TestCase):
    def test_prior_installment_and_payments_at_cutoff(self):
        reader = Mock()
        reader.rows.return_value = [dict(id=10, move_id=[90,"INV90"],partner_id=[2,"Cliente"],
            amount_currency=120, currency_id=[1,"USD"],date="2025-12-01",date_maturity="2026-01-01",
            matched_debit_ids=[],matched_credit_ids=[3,4],payment_id=False),
            dict(id=12, move_id=[91,"PAY91"],partner_id=[2,"Cliente"],amount_currency=-50,currency_id=[1,"USD"],
            date="2025-12-05",date_maturity="2025-12-05",matched_debit_ids=[],matched_credit_ids=[],payment_id=[7,"PAY91"])]
        reader.related.return_value = [dict(id=i,max_date=day,debit_move_id=[10,"INV90"],
            credit_move_id=[11,"PAGO"],debit_amount_currency=amount,credit_amount_currency=amount)
            for i,day,amount in [(3,"2026-01-15",20),(4,"2026-02-01",100)]]
        data=dict(customer=[],settlement=[])
        receivables(reader,data,"2026-01-01","2026-01-31")
        self.assertEqual(data["arDocument"][0]["gross"],12000)
        self.assertEqual([d["payment"] for d in data["arDocument"]],[False,True])
        self.assertEqual(data["settlement"],[dict(id="3",document="10",posted="2026-01-15",amount=2000)])
        reader.related.return_value=[]
        with self.assertRaises(PermissionError):
            receivables(reader,data,"2026-01-01","2026-01-31")

    def test_group_company_sales_are_excluded_by_tax_id(self):
        self.assertEqual(tax_key("J-050119373-8"),tax_key("J501193738"))
        reader = Mock()
        reader.related.return_value = [dict(id=5,vat="J501193738"),dict(id=6,vat="V-123")]
        data = dict(document=[dict(id="1",customer="5"),dict(id="2",customer="6")],
                    line=[dict(document="1"),dict(document="2")],assignment=[dict(document="1",seller="9")],settlement=[],
                    arDocument=[dict(id="30",customer="5")],customer=[dict(id="5",name="Grupo"),dict(id="6",name="Externo")])
        drop_group(reader,data,["J-050119373-8"])
        self.assertEqual([d["id"] for d in data["document"]],["2"])
        self.assertEqual((data["line"],data["assignment"],data["arDocument"]),([dict(document="2")],[],[]))
        self.assertEqual(data["excludedGroup"],["Grupo"])

    def test_warehouse_close_and_return_in_caracas(self):
        reader = Mock()
        reader.scope.return_value = [["company_id","=",9]]
        reader.call.side_effect = [[],[dict(product_id=[1,"P"],location_dest_id=[8,"WH"],quantity_product_uom=10)],
            [dict(product_id=[1,"P"],location_id=[8,"WH"],location_dest_id=[4,"Cliente"],quantity_product_uom=6,
                  __count=2,__range={"date:day":{"from":"2026-01-12 04:00:00"}}),
             dict(product_id=[1,"P"],location_id=[4,"Cliente"],location_dest_id=[8,"WH"],quantity_product_uom=1,
                  __count=1,__range={"date:day":{"from":"2026-01-31 04:00:00"}})]]
        locations = [dict(id=8,warehouse_id=[2,"Almacén"],usage="internal",complete_name="WH"),
                     dict(id=4,warehouse_id=False,usage="customer",complete_name="Cliente")]
        reader.rows.side_effect=[locations]
        reader.related.return_value=[dict(id=1,default_code="ABC",categ_id=[1,"General"],uom_id=[1,"Unidad"])]
        data={k:[] for k in ("stock_cut","stock_move","stock_day","stock_policy","inbound")}
        inventory(reader,data,date(2026,1,1),date(2026,1,31),date(2026,11,23))
        cut=data["stock_cut"][-1]
        self.assertEqual((cut["opening"],cut["closing"]),(10,5))
        self.assertEqual([(m["posted"],m["kind"]) for m in data["stock_move"]],
                         [("2026-01-12","sale"),("2026-01-31","return")])
        self.assertIsNone(data["stock_policy"][-1]["reserved"])

    def test_bolivar_rate_from_localisation(self):
        reader = Mock()
        reader.call.return_value = [dict(name="2026-10-31",inverse_rate=919.8227)]
        self.assertEqual(bolivar_rate(reader,9,"USD","2026-10-31"),dict(rate="919.8227",date="2026-10-31",currency="USD"))
        self.assertIsNone(bolivar_rate(reader,9,"VES","2026-10-31"))
        reader.call.side_effect = ProviderUnavailable()
        self.assertIsNone(bolivar_rate(reader,9,"USD","2026-10-31"))

    def test_payables_and_costs(self):
        reader = Mock()
        reader.rows.return_value = [dict(id=1,name="BILL/1",ref="F-77",partner_id=[4,"Proveedor"],invoice_date="2026-10-02",
            invoice_date_due="2026-11-01",currency_id=[1,"USD"],amount_total=100,amount_residual=40,move_type="in_invoice"),
            dict(id=2,name="RBILL/1",ref=False,partner_id=[4,"Proveedor"],invoice_date="2026-10-05",invoice_date_due=False,
            currency_id=[1,"USD"],amount_total=10,amount_residual=10,move_type="in_refund")]
        data = {"payable":[],"product_cost":[],"company":[{"currency":"USD"}]}
        payables(reader,data)
        self.assertEqual([(p["number"],p["residual"],p["due"]) for p in data["payable"]],[("F-77",4000,"2026-11-01"),("RBILL/1",-1000,"2026-10-05")])
        reader.related.return_value = [dict(id=7,standard_price=5.6)]
        product_costs(reader,data,[7])
        self.assertEqual(data["product_cost"],[dict(product="7",currency="USD",unit_cost=560)])
