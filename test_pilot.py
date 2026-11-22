import base64
import json
import os
import unittest
from unittest.mock import patch
from access import basic_scope,identity,roster
from demo import Demo
from model import TABLES

class PilotScope(unittest.TestCase):
    def test_basic_entitlements(self):
        data=Demo().snapshot()
        model={k:[dict(zip(v.split(","),row)) for row in data[k]] for k,v in TABLES.items()
               if k not in ("article","warehouse","stock_cut","stock_move")}
        basic_scope(model,"Caracas")
        ids={d["id"] for d in model["document"]}
        self.assertTrue(ids)
        self.assertEqual({d["branch"] for d in model["document"]},{"Caracas"})
        self.assertTrue(all(l["document"] in ids for l in model["line"]+model["assignment"]))
        self.assertNotIn("settlement",model)
        self.assertNotIn("credit_line",model)

    def test_basic_user_limit_and_identity(self):
        users={f"user{n}":f"credential-{n}" for n in range(3)}
        with patch.dict(os.environ,{"ORA_USERS_JSON":json.dumps(users)}):
            self.assertEqual(roster("basico"),users)
        with patch.dict(os.environ,{"ORA_USERS_JSON":json.dumps({**users,"extra":"fourth"})}):
            with self.assertRaises(ValueError):roster("basico")
        encode=lambda value:"Basic "+base64.b64encode(value.encode()).decode()
        self.assertEqual(identity(encode("user1:credential-1"),users),"user1")
        self.assertIsNone(identity(encode("user1:incorrect"),users))
        self.assertIsNone(identity("",users))
