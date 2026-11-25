from calendar import monthrange
from datetime import date, timedelta
from random import Random
from stock_demo import inventory_fixture

class Demo:
    def snapshot(self):
        rng = Random(417)
        products = ["Café molido · 500 g", "Arroz blanco · 1 kg", "Aceite vegetal · 1 L",
                    "Harina de maíz · 1 kg", "Azúcar refinada · 1 kg"]
        customers = ["Mercado Los Cedros", "Abastos El Parque", "Comercial Miranda", "Víveres La Colina",
                     "Mercado del Este", "Distribuciones Alba", "Bodega El Sol", "Supermercado Aurora"]
        data = dict(company=[("andina", "Distribuidora Andina", "demo-v1")],
                    product=[(str(i), p) for i,p in enumerate(products)],
                    customer=[(str(i), c) for i,c in enumerate(customers)],
                    document=[], line=[], settlement=[])
        for month in range(1, 11):
            for i in range(1, 31):
                key = f"{month:02}{i:03}"
                issued = date(2026, month, min(i,monthrange(2026,month)[1]))
                due = issued + timedelta(days=rng.choice([15,30,45]))
                credit = i == 20
                number = ("NC" if credit else "FAC") + "-26-" + key
                branch = rng.choices(["Caracas","Valencia","Maracay"],[52,31,17])[0]
                currency = "EUR" if i == 26 else "USD"
                state = {28:"draft",29:"cancelled"}.get(i, "posted")
                data["document"].append((key,number,"credit" if credit else "invoice",state,
                    issued.isoformat(),due.isoformat(),str(rng.randrange(8)),branch,currency))
                gross = 0
                for j, product in enumerate(rng.sample(range(5),2)):
                    units = rng.randrange(4,16) if credit else rng.randrange(12,35) + month
                    net = units * [750,360,490,290,340][product]
                    tax = (net * 16 + 50) // 100
                    gross += net + tax
                    data["line"].append((key+str(j),key,str(product),units,net,tax))
                if state == "posted" and (credit or i % 8):
                    delay = 0 if credit else rng.choice([5,20,35,60])
                    data["settlement"].append(("A"+key,key,(issued+timedelta(days=delay)).isoformat(),
                        gross if credit or i % 6 else gross//2))
        data["seller"] = [("01","Elena Rivas"),("02","Gabriel León"),("03","Marina Suárez")]
        data["assignment"] = [(doc[0], data["seller"][i % 3][0])
                              for i, doc in enumerate(data["document"]) if i % 7]
        data["location"] = [
            ("0","Caracas",10.48,-66.88,"point"), ("1","Valencia",10.18,-68.00,"point"),
            ("2","Caracas",10.50,-66.85,"point"), ("3","Maracay",10.25,-67.60,"city"),
            ("4","Maracay",10.25,-67.60,"city"), ("5","Valencia",10.20,-68.04,"point"),
            ("6","Caracas",10.46,-66.91,"point")]
        contacts = ["Ana Salas", "Luis Pérez", "Marta Díaz", "Raúl Gil",
                    "Iris Soto", "Leo Vera", "Lina Ruiz", "Eva Ríos"]
        data["customer_profile"] = [
            (str(i), f"CLI-{i+1:03}", f"DEMO-J-{10000+i}", contacts[i],
             f"compras{i+1}@andina.example", f"Av. del Comercio, local {i+1}" if i<7 else None)
            for i in range(len(customers))]
        data["credit_line"] = [(str(i),"USD",limit) for i,limit in
                               enumerate([600000,250000,420000,300000,500000,550000,0])]
        data["history_coverage"] = [(1,"2026-01-01","2026-10-31",1,1)]
        data["product_cost"] = [(str(i),"USD",cost) for i,cost in enumerate([560,290,410,215,265])]
        suppliers = ["Molinos del Centro", "Aceitera del Lago", "Tostadora Andina", "Azucarera Valle Verde", "Empaques Litoral"]
        supply = Random(9001)
        data["payable"] = []
        for month in range(1, 11):
            for k in range(6):
                issued = date(2026, month, supply.randrange(1, 28))
                due = issued + timedelta(days=supply.choice([30,45,60]))
                total = supply.randrange(80000, 420000)
                residual = total if month >= 9 or (month == 8 and k % 2) else (total // 3 if k == 5 else 0)
                key = f"{month:02}{k}"
                data["payable"].append(("P"+key, f"FP-26-{key}", suppliers[(month+k) % 5], issued.isoformat(), due.isoformat(),
                                        "USD", total, residual))
        data.update(inventory_fixture())
        return data
