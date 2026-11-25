// ABC classes follow cumulative share of units shipped; items with no outflow are always C.
import assert from 'node:assert/strict';
import {classify} from './web/inventory.js';
import {productName,personName} from './web/metrics.js';
const out = classify([{product:'a',out:80},{product:'b',out:15},{product:'c',out:5},{product:'d',out:0}]);
assert.deepEqual(Object.fromEntries(out.map(p=>[p.product,p.abc])), {a:'A',b:'B',c:'C',d:'C'});
assert.equal(classify([{product:'x',out:0}])[0].abc, 'C');
assert.equal(classify([{product:'big',out:90},{product:'s',out:10}])[0].abc, 'A');
assert.equal(productName('[PAC180PUSGYBL010] KLIP MOCHILA PARA LAPTOP'),'KLIP MOCHILA PARA LAPTOP');
assert.equal(productName('Café molido · 500 g'),'Café molido · 500 g');
assert.equal(personName('EMILI BRICEÑO.'),'Emili Briceño');
assert.equal(personName('Marina Suárez'),'Marina Suárez');
console.log('OK nombres: código de producto fuera, personas en tipo título.');
console.log('OK ABC: clases por participación acumulada y sin salidas en C.');
