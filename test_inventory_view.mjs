// The server-side inventory figures must equal what the browser computed from raw moves and daily rows.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {calculateStock} from './web/inventory.js';
import {suggestions} from './web/restock.js';
// Builds the demo company in a temporary store and returns it raw and as the server now sends it.
const script = `import json, tempfile, pathlib
from demo import Demo
from model import sync, read_model
from inventory_view import slim_inventory
with tempfile.TemporaryDirectory() as d:
    db = pathlib.Path(d) / 'demo.sqlite3'
    sync(db, 'andina', Demo())
    m = read_model(db)
print(json.dumps([m, slim_inventory(m)]))`;
const [full, slim] = JSON.parse(execFileSync('python', ['-c', script], {maxBuffer: 1 << 26}).toString());
const byCut = new Map();
for (const m of full.stock_move) { if (!byCut.has(m.cut)) byCut.set(m.cut, []); byCut.get(m.cut).push(m); }
const days = p => new Date(Date.UTC(+p.slice(0,4), +p.slice(5,7), 0)).getUTCDate();
const slimCuts = new Map(slim.stock_cut.map(c => [c.id, c]));
for (const c of full.stock_cut) {
  const local = calculateStock(c, byCut.get(c.id) ?? [], days(c.period)), server = calculateStock(slimCuts.get(c.id), [], days(c.period));
  assert.deepEqual([server.out, server.sold, server.mean, server.status], [local.out, local.sold, local.mean, local.status], c.id);
}
for (const period of ['2026-08', '2026-10']) for (const months of [1, 3]) {
  const opts = {period, months, lead: 7, safety: 5};
  const plain = rows => rows.map(({out, sold, mean, moves, ...r}) => r);  // per-cut figures ride along on the slim rows
  assert.deepEqual(plain(suggestions(slim, opts)), plain(suggestions(full, opts)), period + ' ' + months);
}
console.log('OK inventario en servidor: mismas existencias, rotación y reposición que el cálculo con movimientos.');
