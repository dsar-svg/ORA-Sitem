import assert from 'node:assert/strict';
import {suggestions,demandEstimate} from './web/restock.js';

const observed=['full','partial','full','out','out'];
const demand=demandEstimate(10+8+0,observed,5);
assert.deepEqual(demand,{rate:6,availableDays:3,outDays:2,partialDays:1,complete:true});
assert.equal(demandEstimate(18,observed.slice(0,4),5).rate,null);
assert.equal(demandEstimate(0,['out','out'],2).rate,null);
assert.equal(demandEstimate(0,['full','partial'],2).rate,0);

const data={
  article:[{product:'p',sku:'P',unit:'ud',category:'Alimentos'}],
  product:[{id:'p',name:'Aceite'}],warehouse:[{id:'w',name:'Caracas'}],
  stock_cut:[{id:'oct',period:'2026-10',product:'p',warehouse:'w',closing:5}],
  stock_policy:[{cut:'oct',reserved:5,lead_days:10,safety:2,sales_complete:1,receipts_complete:1}],
  stock_day:Array.from({length:31},(_,i)=>({cut:'oct',posted:'2026-10-'+String(i+1).padStart(2,'0'),availability:'full'})),
  stock_move:[
    {cut:'oct',kind:'sale',units:-67},{cut:'oct',kind:'return',units:5},
    {cut:'oct',kind:'transfer',units:-20},{cut:'oct',kind:'adjustment',units:3}
  ],
  inbound:[]
};
const options={period:'2026-10',months:1};
const first=(opts={})=>suggestions(data,{...options,...opts})[0];
const sparse=structuredClone(data);
sparse.stock_day.forEach((day,i)=>{day.availability=observed[i]||'out'});
sparse.stock_move=[{cut:'oct',posted:'2026-10-01',kind:'sale',units:-10},
  {cut:'oct',posted:'2026-10-02',kind:'sale',units:-8}];
assert.equal(suggestions(sparse,options)[0].rate,6);
sparse.stock_day.pop();
assert.equal(suggestions(sparse,options)[0].qty,null);
assert.equal(first().rate,2);
assert.deepEqual([first().available,first().point,first().target,first().qty,first().status],[0,22,36,36,'Prioritario']);
data.inbound=[
  {cut:'oct',state:'confirmed',arrival:'2026-11-10',open_units:22},
  {cut:'oct',state:'confirmed',arrival:'2026-11-11',open_units:400},
  {cut:'oct',state:'confirmed',arrival:'2026-10-31',open_units:70},
  {cut:'oct',state:'draft',arrival:'2026-11-05',open_units:300}
];
assert.deepEqual([first().incoming,first().qty,first().status],[22,0,'Revisar pronto']);
assert.equal(first({months:2}).qty,null);
assert.equal(first({warehouse:'other'}),undefined);
assert.equal(first({priority:'Prioritario'}),undefined);
data.stock_policy[0].lead_days=null;
assert.ok(first().missing.includes('plazo'));
assert.equal(first({lead:1,safety:1}).qty,17);
data.stock_move=[];
assert.equal(first({lead:10,safety:0}).status,'Sin urgencia');
data.stock_policy[0].sales_complete=0;
assert.equal(first({lead:10,safety:0}).status,'Datos insuficientes');
console.log('OK reposición: reservas, plazo, recepciones, historial y consumo cero.');
