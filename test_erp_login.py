"""Exercise ORA's HTTP login against a simulated Odoo 17 authentication response."""
import http.client
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

import app
from demo import Demo
from erp_auth import OdooLogin, Sessions
from model import sync


class LoginTests(unittest.TestCase):
    def apply_mock(self, mock):
        value=mock.start()
        self.addCleanup(mock.stop)
        return value

    def setUp(self):
        directory=TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        db=Path(directory.name)/"demo.sqlite3"
        sync(db,"andina",Demo())
        self.email="persona@example.test"
        for name,value in {"ERP":OdooLogin("https://erp.example.test","test-db",{self.email}),
                           "DATABASE":db,"PUBLIC_ORIGIN":"","SESSIONS":Sessions()}.items():
            self.apply_mock(patch.object(app,name,value))
        self.upstream=self.apply_mock(patch("erp_auth.HTTPSConnection")).return_value
        self.response=self.upstream.getresponse.return_value
        self.response.status=200
        self.info={"uid":7,"db":"test-db","username":self.email,"is_internal_user":True,
                   "user_companies":{"current_company":2,"allowed_companies":{"2":{"name":"Empresa de prueba"}}}}
        self.result(self.info)
        self.server=app.ThreadingHTTPServer(("127.0.0.1",0),app.Handler)
        self.addCleanup(self.server.server_close)
        thread=Thread(target=self.server.serve_forever,daemon=True)
        thread.start()
        self.addCleanup(self.server.shutdown)

    def result(self,info):
        self.response.read.return_value=json.dumps({"result":info}).encode()

    def request(self,path, fields=None,cookie="",origin=None):
        c=http.client.HTTPConnection("127.0.0.1",self.server.server_port)
        headers={"Cookie":cookie}
        if fields is not None:
            headers.update({"Content-Type":"application/x-www-form-urlencoded","Origin":origin or
                            f"http://127.0.0.1:{self.server.server_port}"})
        c.request("GET" if fields is None else "POST",path,None if fields is None else urlencode(fields),headers)
        r=c.getresponse()
        response=r.status,dict(r.getheaders()),r.read()
        c.close()
        return response

    def login(self, **kwargs):
        return self.request("/login",{"email":self.email,"password":"simulated"},**kwargs)

    def test_login_report_and_logout(self):
        self.assertEqual(self.request("/")[1]["Location"],"/login")
        self.assertEqual(self.request("/api/demo")[0],401)
        self.assertIn(b'autocomplete="current-password"',self.request("/login")[2])
        status,headers,_=self.login()
        self.assertEqual(status,303)
        cookie=headers["Set-Cookie"]
        self.assertIn("HttpOnly",cookie)
        self.assertIn("SameSite=Strict",cookie)
        args=self.upstream.request.call_args.args
        self.assertEqual(args[:2],("POST","/web/session/authenticate"))
        self.assertEqual(json.loads(args[2])["params"],{"db":"test-db","login":self.email,"password":"simulated"})
        token=cookie.split(";")[0]
        report=json.loads(self.request("/api/demo",cookie=token)[2])
        self.assertEqual((report["user"],report["erpCompany"]),(self.email,"Empresa de prueba"))
        page=self.request("/",cookie=token)[2].decode()
        self.assertIn("<span>"+self.email+"</span>",page)
        self.assertIn('<strong id="company">Empresa de prueba</strong>',page)
        self.assertNotIn("Perfil de demo",page)
        self.assertEqual(self.request("/logout",{},token)[0],303)
        self.assertEqual(self.request("/api/demo",cookie=token)[0],401)

    @patch("app.SALES_MONTH", "2026-10")
    @patch("odoo_sales.HTTPSConnection")
    def test_live_company_sales(self, transport):
        app.ERP.company_id = "9"
        self.info["user_companies"]["allowed_companies"]["9"] = {"name":"Company B"}
        self.result(self.info)
        self.response.getheaders.return_value = [("Set-Cookie","session_id=upstream; HttpOnly")]
        cookie = self.login()[1]["Set-Cookie"].split(";")[0]
        row = dict(id=4, company_id=[9,"Company B"], name="NC1", invoice_date="2026-10-10",
                   invoice_date_due=False, move_type="out_refund", partner_id=[3,"Customer"],
                   currency_id=[2,"USD"], amount_untaxed=1.11, amount_total=1.29)
        connection = transport.return_value
        response = connection.getresponse.return_value
        response.status = 200
        response.read.return_value = json.dumps({"result":[row]}).encode()
        status, _, body = self.request("/api/demo",cookie=cookie)
        self.assertEqual(status,200)
        data = json.loads(body)
        self.assertEqual(data["company"],[dict(id="9",name="Company B",source="odoo")])
        self.assertEqual(data["modules"],["sales"])
        self.assertEqual((data["document"][0]["kind"],data["document"][0]["net"]),("credit",111))
        args = connection.request.call_args.args
        kwargs = json.loads(args[2])["params"]["kwargs"]
        self.assertIn(["company_id","=",9],kwargs["domain"])
        self.assertEqual(kwargs["context"]["allowed_company_ids"],[9])
        self.assertEqual(args[3]["Cookie"],"session_id=upstream")
        response.read.return_value = json.dumps({"result":[{**row,"company_id":[2,"A"]}]}).encode()
        self.assertEqual(self.request("/api/demo",cookie=cookie)[0],502)

    def test_pending_factor_wrong_database_and_external_account(self):
        for change in ({"uid":None},{"db":"other"},{"is_internal_user":False},{"username":"other@example.test"}):
            self.result({**self.info,**change})
            status,headers,_=self.login()
            self.assertEqual(status,303)
            self.assertEqual(headers["Location"],"/login?aviso="+("factor" if change.get("uid",7) is None else "acceso"))
            self.assertNotIn("Set-Cookie",headers)

    def test_browser_retry_page(self):
        status,headers,_=self.request("/login")
        self.assertEqual(status,200)
        self.assertEqual(headers["Referrer-Policy"],"same-origin")
        self.assertEqual(self.login(origin="null")[0],403)
        status,headers,_=self.request("/login",{"email":"nobody@example.test","password":"simulated"})
        self.assertEqual(status,303)
        status,_,page=self.request(headers["Location"])
        self.assertEqual(status,200)
        self.assertIn(b"Acceso no confirmado",page)
        self.assertNotIn(b"simulated",page)
        self.assertEqual(self.request("/api/demo")[0],401)

    def test_access_and_provider_failure(self):
        self.assertEqual(self.login(origin="https://elsewhere.example")[0],403)
        self.assertEqual(self.request("/login",{"email":"another@example.test","password":"simulated"})[1]["Location"],"/login?aviso=acceso")
        self.upstream.request.assert_not_called()
        self.response.status=503
        self.assertEqual(self.login()[1]["Location"],"/login?aviso=conexion")

    def test_password_denied_and_attempt_limit(self):
        self.response.read.return_value=b'{"error":{"data":{"name":"odoo.exceptions.AccessDenied"}}}'
        for _ in range(5):
            self.assertEqual(self.login()[1]["Location"],"/login?aviso=acceso")
        self.assertEqual(self.login()[1]["Location"],"/login?aviso=espera")

    def test_security_headers_and_unexpected_errors(self):
        status, headers, _ = self.request("/login")
        self.assertEqual(status, 200)
        for name in ("Content-Security-Policy","X-Content-Type-Options","X-Frame-Options"):
            self.assertIn(name, headers)
        self.assertNotIn("Python", headers.get("Server",""))
        cookie = self.login()[1]["Set-Cookie"].split(";")[0]
        self.assertIn("frame-ancestors 'none'", self.request("/",cookie=cookie)[1]["Content-Security-Policy"])
        with patch("app.read_model", side_effect=KeyError("partner")), self.assertLogs("ora", "ERROR"):
            self.assertEqual(self.request("/api/demo",cookie=cookie)[0], 500)

    @patch("app.SALES_MONTH", "2026-10")
    @patch("app.PLAN", "basico")
    def test_basic_plan_reads_live_sales_only(self):
        cookie = self.login()[1]["Set-Cookie"].split(";")[0]
        self.assertEqual(self.request("/api/demo?view=ar",cookie=cookie)[0], 403)
        self.assertIn(b'data-module="ar" hidden', self.request("/",cookie=cookie)[2])

    def test_login_attempts_are_limited_per_address(self):
        self.response.read.return_value=b'{"error":{"data":{"name":"odoo.exceptions.AccessDenied"}}}'
        for i in range(20):
            self.request("/login",{"email":f"otro{i}@example.test","password":"x"})
        self.assertEqual(self.login()[1]["Location"],"/login?aviso=espera")
