import assert from 'node:assert/strict';
import {monthRanges,statement} from './web/reports.js';
assert.deepEqual(monthRanges('2026-11','2026-11-22'),{
  first:'2026-11-01',end:'2026-11-22',priorFirst:'2026-10-01',priorEnd:'2026-10-22'
});
assert.equal(monthRanges('2024-03','2024-03-31').priorEnd,'2024-02-29');
const doc={id:'1',number:'F-1',customer:'a',sign:1,issued:'2026-09-02',due:'2026-09-30',
  lines:[{net:10000,tax:1600}],payments:[{id:'p1',posted:'2026-10-04',amount:4500},{id:'p2',posted:'2026-11-01',amount:7100}]};
const nc={...doc,id:'2',number:'NC-2',sign:-1,issued:'2026-10-07',due:'2026-10-07',lines:[{net:1000,tax:160}],payments:[]};
const history={opening:true,start:'2026-01-01',through:'2026-10-31',applications:true};
const s=statement([doc,nc],'a','2026-10-01','2026-10-31',history);
assert.deepEqual([s.opening,s.ending,s.overdue],[11600,5940,5940]);
assert.equal(s.events.length,2);assert.equal(s.missing.length,0);
assert.equal(s.open.reduce((n,r)=>n+r.value,0),s.ending);
assert.equal(statement([doc,nc],'a','2026-10-01','2026-10-31').missing.length,2);
assert.ok(statement([doc,nc],'a','2026-11-01','2026-11-30',history).missing.length);
console.log('OK: períodos equivalentes, parciales, créditos, apertura y cobertura.');
